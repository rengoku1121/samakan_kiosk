import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { Subscription, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { buildMachineLayoutCodes } from '../catalog/catalog.models';
import { KioskApiService } from '../services/kiosk-api.service';
import { KioskConfigService, KioskRuntimeConfig } from '../services/kiosk-config.service';
import {
  JammedSelectionReport,
  KioskDispenseService,
  LastDriveCommand,
  SlotCheckOutcome,
  SlotCheckTrace,
} from '../services/kiosk-dispense.service';
import { KioskLockService, KioskLockStatus } from '../services/kiosk-lock.service';
import { KioskNetworkService, KioskNetworkStatus } from '../services/kiosk-network.service';
import { KioskServiceAccess } from '../services/kiosk-service-access.service';

export type SlotProbe = {
  slot_code: string;
  state: 'pending' | 'ok' | 'fail';
  detail: string;
};

type LogLine = { at: string; text: string; bad: boolean };

/**
 * Halaman teknisi (tidak ada link dari UI pelanggan — 5x ketuk kode mesin di beranda).
 * Dipakai untuk uji lapangan VMC tanpa transaksi: cek slot 0x01, scan denah,
 * dan test dispense 0x06 dingin/panas.
 */
@Component({
  selector: 'app-service',
  templateUrl: 'service.page.html',
  styleUrls: ['service.page.scss'],
  standalone: false,
})
export class ServicePage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  readonly appVersion = environment.appVersion;
  readonly layoutCodes = buildMachineLayoutCodes();

  slotCode = '013';
  heat = false;
  lastCheck: SlotCheckOutcome | null = null;

  busy = false;
  busyLabel = '';
  /** Tombol VMC yang sedang berjalan. Tombol lain di grup yang sama ikut nonaktif. */
  busyAction = '';
  netBusy = false;
  lockBusy = false;
  lockAction = '';
  reloading = false;
  scanning = false;
  scanDone = 0;
  probes: SlotProbe[] = [];

  form: KioskRuntimeConfig;
  savedNote = '';
  newPassword = '';
  newPasswordAgain = '';
  passwordNote = '';

  lock: KioskLockStatus = {
    lockTaskPermitted: false,
    lockTaskActive: false,
    lockPaused: false,
    isDefaultHome: false,
  };

  closing = false;

  /** Konfirmasi sebelum motor uji benar-benar dijalankan. */
  confirmOpen = false;
  confirmHeat = false;
  confirmSlot = '';

  network: KioskNetworkStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    transport: '',
    ssid: '',
    ip: '',
  };
  networkNote = '';
  clockLabel = '';

  /** Snapshot frame 0x06 terakhir — bukti "tes dingin" mengirim elevator=0. */
  lastDrive: LastDriveCommand | null = null;
  /** Hingga 20 perintah 0x06, yang terbaru di depan. */
  driveHistory: LastDriveCommand[] = [];

  /** Hasil cek / bersihkan jammed terakhir (0x70 · 0x32). */
  jammedReport: JammedSelectionReport | null = null;

  logs: LogLine[] = [];

  private progressSub?: Subscription;
  private readonly panelMotion = new WeakMap<HTMLElement, number>();
  private cancelScan = false;
  private admitted = false;
  private viewGen = 0;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly router: Router,
    private readonly config: KioskConfigService,
    private readonly dispenseSvc: KioskDispenseService,
    private readonly kioskApi: KioskApiService,
    private readonly lockSvc: KioskLockService,
    private readonly serviceAccess: KioskServiceAccess,
    private readonly networkSvc: KioskNetworkService
  ) {
    this.form = config.get();
  }

  ionViewWillEnter(): void {
    if (!this.admitted) {
      if (!this.serviceAccess.take()) {
        void this.router.navigateByUrl('/home');
        return;
      }
      this.admitted = true;
    }
    this.form = this.config.get();
    this.loadDriveLog();
    const gen = ++this.viewGen;
    this.startClock();
    void this.refreshNetwork(gen);
    void this.refreshLock();
    this.progressSub = this.dispenseSvc.progress$.subscribe((p) => {
      this.busyLabel = p.message;
      this.log(p.message, false);
    });
  }

  ionViewWillLeave(): void {
    this.admitted = false;
    this.viewGen += 1;
    this.stopClock();
    this.cancelScan = true;
    this.progressSub?.unsubscribe();
    this.progressSub = undefined;
  }

  ngOnDestroy(): void {
    this.viewGen += 1;
    this.stopClock();
    this.cancelScan = true;
    this.progressSub?.unsubscribe();
  }

  get usesDefaultServicePassword(): boolean {
    return this.config.usesDefaultServicePassword;
  }

  get isDevToken(): boolean {
    return this.config.isDevToken;
  }

  get runtimeMode(): string {
    return this.dispenseSvc.getLastMode();
  }

  get okCount(): number {
    return this.probes.filter((p) => p.state === 'ok').length;
  }

  get failCount(): number {
    return this.probes.filter((p) => p.state === 'fail').length;
  }

  exit(): void {
    void this.router.navigateByUrl('/home');
  }

  /** Buka/tutup panel. Tinggi dianimasikan supaya tidak meloncat. */
  togglePanel(event: Event): void {
    event.preventDefault();
    const details = (event.currentTarget as HTMLElement | null)?.parentElement as HTMLDetailsElement | null;
    const body = details?.querySelector('.panel-body') as HTMLElement | null;
    if (!details || !body) return;

    const opening = !details.open;
    const gen = (this.panelMotion.get(body) ?? 0) + 1;
    this.panelMotion.set(body, gen);

    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      details.open = opening;
      body.style.height = opening ? 'auto' : '';
      return;
    }

    if (opening) {
      details.open = true;
      const target = body.scrollHeight;
      body.style.height = '0px';
      void body.offsetHeight;
      body.style.height = `${target}px`;
    } else {
      const laidOut = body.getBoundingClientRect().height;
      const parsed = parseFloat(body.style.height);
      const current = laidOut > 0 ? laidOut : Number.isFinite(parsed) ? parsed : body.scrollHeight;
      body.style.height = `${current}px`;
      void body.offsetHeight;
      details.open = false;
      body.style.height = '0px';
    }

    const onEnd = (ev: TransitionEvent) => {
      if (ev.target !== body || ev.propertyName !== 'height') return;
      if (this.panelMotion.get(body) !== gen) return;
      body.removeEventListener('transitionend', onEnd);
      body.style.height = details.open ? 'auto' : '';
    };
    body.addEventListener('transitionend', onEnd);
  }

  /** Lepas kunci panel lalu tutup aplikasi supaya Settings Android bisa dibuka. */
  isLoading(action: string): boolean {
    return this.busy && this.busyAction === action;
  }

  async closeApp(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.log('menutup aplikasi — lepas kunci panel', false);
    try {
      await this.lockSvc.exitApp();
    } catch (err) {
      this.log(`gagal menutup aplikasi: ${this.msg(err)}`, true);
      this.closing = false;
    }
  }

  async openAndroidSettings(): Promise<void> {
    if (this.lockBusy) return;
    this.lockBusy = true;
    this.lockAction = 'settings';
    this.log('membuka Settings Android', false);
    try {
      await this.lockSvc.openSettings();
      this.lock = await this.lockSvc.getStatus();
    } catch (err) {
      this.log(`gagal buka Settings: ${this.msg(err)}`, true);
    } finally {
      this.lockBusy = false;
      this.lockAction = '';
    }
  }

  clearLog(): void {
    this.logs = [];
  }

  async checkOne(): Promise<void> {
    const code = this.normalize(this.slotCode);
    if (!code || this.busy) return;
    this.busy = true;
    this.busyAction = 'check';
    this.busyLabel = `Cek slot ${code}…`;
    this.log(`0x01 cek slot ${code} · kirim`, false);
    try {
      const res = await this.dispenseSvc.checkSlotReady(code);
      this.lastCheck = res;
      this.logSlotCheck(code, res);
    } catch (err) {
      this.log(`0x01 slot ${code} · ERROR · ${this.msg(err)}`, true);
    } finally {
      this.busy = false;
      this.busyAction = '';
      this.busyLabel = '';
    }
  }

  /**
   * Probe 0x53. Hanya menambah baris log berisi hex balasan — tidak menyentuh
   * alur jual dan tidak menebak arti byte-nya.
   */
  async checkVmcStatus(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.busyAction = 'vmc';
    this.busyLabel = 'Cek status VMC…';
    try {
      const res = await this.dispenseSvc.requestMachineStatus();
      this.log(`0x53 kirim · ${res.sentHex || '—'} · ${res.mode}`, false);
      for (const r of res.replies) {
        this.log(`0x53 balasan · cmd 0x${this.hex2(r.cmd)} · ${r.hex}`, false);
      }
      this.log(`0x53 hasil · ${res.detail}`, !res.ok);
    } catch (err) {
      this.log(`0x53 gagal · ${this.msg(err)}`, true);
    } finally {
      this.busy = false;
      this.busyAction = '';
      this.busyLabel = '';
    }
  }

  /** Tanya VMC slot mana yang tercatat jammed. Tidak mengubah apa pun di mesin. */
  async checkJammed(): Promise<void> {
    await this.runJammed('Cek jammed…', 'cek jammed', 'jam-check', () =>
      this.dispenseSvc.queryJammedSelections()
    );
  }

  /** Hapus tanda jammed di VMC. Jalur harus sudah dibersihkan secara fisik. */
  async clearJammed(): Promise<void> {
    await this.runJammed('Bersihkan jammed…', 'bersihkan jammed', 'jam-clear', () =>
      this.dispenseSvc.clearJammedSelections()
    );
  }

  codeList(codes: string[] | null): string {
    if (codes == null) return '—';
    return codes.length ? codes.join(', ') : 'tidak ada';
  }

  /** Scan seluruh denah 8x4 dengan 0x01 — memetakan rak yang benar-benar terpasang. */
  async scanAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.busyAction = 'scan';
    this.scanning = true;
    this.cancelScan = false;
    this.scanDone = 0;
    this.probes = this.layoutCodes.map((slot_code) => ({
      slot_code,
      state: 'pending' as const,
      detail: '',
    }));
    this.log(`Scan ${this.probes.length} slot dimulai`, false);

    for (const probe of this.probes) {
      if (this.cancelScan) break;
      this.busyLabel = `Scan ${probe.slot_code}…`;
      try {
        const res = await this.dispenseSvc.checkSlotReady(probe.slot_code);
        probe.state = res.ok ? 'ok' : 'fail';
        probe.detail = this.scanDetail(res);
      } catch (err) {
        probe.state = 'fail';
        probe.detail = this.msg(err);
      }
      this.scanDone += 1;
    }

    this.log(`Scan selesai: ${this.okCount} siap, ${this.failCount} tidak`, this.failCount > 0);
    this.scanning = false;
    this.busy = false;
    this.busyAction = '';
    this.busyLabel = '';
  }

  stopScan(): void {
    this.cancelScan = true;
  }

  /** Buka konfirmasi. Motor belum dijalankan. */
  askTestDispense(heat: boolean): void {
    if (this.busy || this.confirmOpen) return;
    const code = this.normalize(this.slotCode);
    if (!code) return;
    this.confirmHeat = heat;
    this.confirmSlot = code;
    this.confirmOpen = true;
  }

  cancelTestDispense(): void {
    this.confirmOpen = false;
  }

  runTestDispense(): void {
    if (!this.confirmOpen || this.busy) return;
    const heat = this.confirmHeat;
    this.confirmOpen = false;
    void this.testDispense(heat);
  }

  /**
   * Dispense uji tanpa order/pembayaran. Hasil TIDAK dilaporkan ke backend.
   * Cek 0x01 dulu, sama seperti alur jual: motor tidak dijalankan kalau slot tidak siap.
   */
  async testDispense(heat: boolean): Promise<void> {
    const code = this.normalize(this.slotCode);
    if (!code || this.busy) return;
    this.busy = true;
    this.busyAction = heat ? 'hot' : 'cold';
    this.heat = heat;
    const label = `slot ${code} · ${heat ? 'panas' : 'dingin'} · elevator=${heat ? 1 : 0}`;
    try {
      this.busyLabel = `Cek slot ${code}…`;
      const check = await this.dispenseSvc.checkSlotReady(code);
      this.lastCheck = check;
      this.logSlotCheck(code, check);
      if (!check.ok) {
        this.log(`0x06 ${label} · DIBATALKAN · slot tidak siap, motor tidak dijalankan`, true);
        return;
      }

      this.busyLabel = `Dispense uji ${code}…`;
      this.log(`0x06 ${label} · kirim (tanpa bayar)`, false);
      const outcome = await firstValueFrom(
        this.dispenseSvc.run({
          order_code: `SERVICE-${Date.now()}`,
          slot_code: code,
          heat_requested: heat,
        })
      );
      this.log(`0x06 ${label} · ${outcome.ok ? 'OK' : 'GAGAL'} · ${outcome.detail}`, !outcome.ok);
    } catch (err) {
      this.log(`0x06 ${label} · ERROR · ${this.msg(err)}`, true);
    } finally {
      this.loadDriveLog();
      this.busy = false;
      this.busyAction = '';
      this.busyLabel = '';
    }
  }

  async pingBackend(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.busyAction = 'ping';
    this.busyLabel = 'Cek backend…';
    try {
      const cat = await firstValueFrom(this.kioskApi.getCatalog());
      this.log(`backend OK — ${cat.slots.length} slot aktif (${cat.machine.machine_code})`, false);
      await firstValueFrom(this.kioskApi.sendHeartbeat(this.appVersion));
      this.log('heartbeat terkirim', false);
    } catch (err) {
      this.log(`backend gagal: ${this.msg(err)}`, true);
    } finally {
      this.busy = false;
      this.busyAction = '';
      this.busyLabel = '';
    }
  }

  async refreshLock(): Promise<void> {
    this.lock = await this.lockSvc.getStatus();
  }

  async reloadLock(): Promise<void> {
    if (this.lockBusy) return;
    this.lockBusy = true;
    this.lockAction = 'refresh';
    try {
      await this.refreshLock();
    } finally {
      this.lockBusy = false;
      this.lockAction = '';
    }
  }

  get networkSsidLabel(): string {
    if (this.network.ssid) return this.network.ssid;
    if (this.network.transport === 'Browser') return 'Tidak tersedia di browser';
    return '—';
  }

  get networkIpLabel(): string {
    if (this.network.ip) return this.network.ip;
    if (this.network.transport === 'Browser') return 'Tidak tersedia di browser';
    return '—';
  }

  refreshNetwork(gen = this.viewGen, manual = false): Promise<void> {
    if (manual) {
      if (this.netBusy) return Promise.resolve();
      this.netBusy = true;
    }
    return this.networkSvc
      .read()
      .then((status) => {
        if (gen !== this.viewGen) return;
        this.network = status;
        if (!manual) return;
        this.networkNote =
          status.transport === 'Browser'
            ? 'Dibaca ulang. Nama Wi-Fi dan IP hanya terbaca di aplikasi Android.'
            : `Dibaca ulang${status.ssid ? ' · ' + status.ssid : ''}${status.ip ? ' · ' + status.ip : ''}.`;
      })
      .finally(() => {
        if (manual) this.netBusy = false;
      });
  }

  reloadNetwork(): void {
    void this.refreshNetwork(this.viewGen, true);
  }

  /** Segarkan halaman. Tidak melepas kunci panel dan tidak menutup aplikasi. */
  reloadApp(): void {
    if (this.reloading) return;
    this.reloading = true;
    this.log('memuat ulang aplikasi', false);
    this.reloadDocument();
  }

  reloadDocument(): void {
    window.location.reload();
  }

  /** Lepas kunci sementara supaya teknisi bisa membuka Settings panel. */
  async toggleLockTask(enabled: boolean): Promise<void> {
    if (this.lockBusy) return;
    this.lockBusy = true;
    this.lockAction = enabled ? 'on' : 'off';
    try {
      this.lock = await this.lockSvc.setLockTask(enabled);
    } finally {
      this.lockBusy = false;
      this.lockAction = '';
    }
    this.log(
      `lock task ${enabled ? 'dikunci' : 'dilepas'} — aktif=${this.lock.lockTaskActive}`,
      enabled && !this.lock.lockTaskActive
    );
  }

  saveConfig(): void {
    const saved = this.config.save(this.form);
    this.form = saved;
    this.savedNote = 'Tersimpan di perangkat ini.';
    this.log(`config disimpan: ${saved.machineCode} @ ${saved.apiBaseUrl}`, false);
    setTimeout(() => (this.savedNote = ''), 4000);
  }

  resetConfig(): void {
    this.form = this.config.reset();
    this.savedNote = 'Kembali ke bawaan APK.';
    this.log('config direset ke bawaan APK', false);
    setTimeout(() => (this.savedNote = ''), 4000);
  }

  saveServicePassword(): void {
    const next = this.newPassword.trim();
    if (next.length < 4) {
      this.passwordNote = 'Password minimal 4 karakter.';
      return;
    }
    if (next !== this.newPasswordAgain.trim()) {
      this.passwordNote = 'Password tidak sama. Ketik ulang.';
      return;
    }
    if (!this.config.setServicePassword(next)) {
      this.passwordNote = 'Password tidak bisa disimpan.';
      return;
    }
    this.newPassword = '';
    this.newPasswordAgain = '';
    this.passwordNote = 'Password mesin ini tersimpan.';
    this.log('password mode servis diganti', false);
    setTimeout(() => {
      if (this.passwordNote === 'Password mesin ini tersimpan.') this.passwordNote = '';
    }, 4000);
  }

  /** Waktu perintah 0x06 terakhir, jam lokal. */
  get lastDriveAt(): string {
    return this.driveAt(this.lastDrive);
  }

  driveAt(d: LastDriveCommand | null): string {
    if (!d) return '';
    return new Date(d.at).toLocaleTimeString('id-ID', { hour12: false });
  }

  driveStatus(d: LastDriveCommand): string {
    if (d.statusLabel === null) return 'menunggu status…';
    if (d.status === null) return d.statusLabel;
    return `${d.statusLabel} (0x${this.hex2(d.status)})`;
  }

  private loadDriveLog(): void {
    this.lastDrive = this.dispenseSvc.getLastDriveCommand();
    this.driveHistory = this.dispenseSvc.getDriveHistory();
  }

  /** Status 0x04 terakhir untuk perintah itu; kosong selagi berjalan. */
  get lastDriveStatus(): string {
    return this.lastDrive ? this.driveStatus(this.lastDrive) : '';
  }

  /** Ringkasan di header panel, tetap terbaca saat panel ditutup. */
  get slotPanelStatus(): string {
    if (!this.lastCheck) return `Slot ${this.slotCode}`;
    return this.lastCheck.ok ? 'Siap' : 'Tidak siap';
  }

  get drivePanelStatus(): string {
    if (!this.lastDrive) return 'Belum ada';
    return `Slot ${this.lastDrive.slotCode} · ${this.lastDrive.heat ? 'panas' : 'dingin'}`;
  }

  get jammedPanelStatus(): string {
    if (!this.jammedReport) return 'Belum dicek';
    if (!this.jammedReport.ok) return 'Gagal';
    const n = this.jammedReport.jammed?.length ?? 0;
    return n ? `${n} jammed` : 'Tidak ada jammed';
  }

  get scanPanelStatus(): string {
    if (!this.probes.length) return 'Belum discan';
    return `${this.scanDone}/${this.probes.length} · ${this.okCount} siap`;
  }

  get identityPanelStatus(): string {
    return this.form.machineCode || 'Belum diisi';
  }

  get passwordPanelStatus(): string {
    return this.usesDefaultServicePassword ? 'Password bawaan' : 'Password khusus';
  }

  get networkPanelStatus(): string {
    return this.network.online ? 'Terhubung' : 'Tidak terhubung';
  }

  get lockPanelStatus(): string {
    if (this.lock.lockPaused) return 'Kunci dilepas';
    return this.lock.lockTaskActive ? 'Terkunci' : 'Terbuka';
  }

  get logPanelStatus(): string {
    if (this.busy) return 'Memproses…';
    return this.logs.length ? `${this.logs.length} baris` : 'Kosong';
  }

  byteHex(n: number | null | undefined): string {
    if (n == null) return '—';
    return `0x${this.hex2(n)}`;
  }

  selectionEcho(t: SlotCheckTrace): string {
    const bytes = t.selectionBytes || '—';
    if (t.selectionNumber == null) return bytes;
    return `${bytes} → ${String(t.selectionNumber).padStart(3, '0')}`;
  }

  private logSlotCheck(code: string, res: SlotCheckOutcome): void {
    const t = res.trace;
    if (!t) {
      this.log(
        `0x01 slot ${code} · ${res.ok ? 'SIAP' : 'TIDAK SIAP'} · ${res.detail} · ${res.mode}`,
        !res.ok
      );
      return;
    }
    this.log(`0x01 kirim · ${t.sentHex || '—'}`, false);
    this.log(`0x01 ACK · ${t.ackHex || 'tidak ada'}`, !t.ackHex);
    this.log(`0x02 balasan · ${t.replyHex || 'tidak ada'}`, !t.replyHex);
    if (t.replyHex) {
      this.log(
        `0x02 parse · cmd ${this.byteHex(t.replyCmd)} · LEN ${t.replyLen ?? '—'} · PackNO ${t.packNo ?? '—'} · result ${this.byteHex(t.result)} ${t.resultLabel || ''} · selection ${this.selectionEcho(t)} · payload ${t.payloadHex || '—'}`,
        !res.ok
      );
    }
    this.log(
      `0x01 hasil · ${res.ok ? 'SIAP' : 'TIDAK SIAP'} · ${res.detail} · ${res.mode}`,
      !res.ok
    );
  }

  private async runJammed(
    busyLabel: string,
    label: string,
    action: string,
    run: () => Promise<JammedSelectionReport>
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.busyAction = action;
    this.busyLabel = busyLabel;
    try {
      const report = await run();
      this.jammedReport = report;
      for (const s of report.steps) {
        const op = s.operation === 'clear' ? 'clear' : 'tanya';
        this.log(`0x70 ${op} kirim · ${s.sentHex}`, false);
        this.log(`0x70 ${op} ACK · ${s.ackHex || 'tidak ada'}`, !s.ackHex);
        this.log(`0x71 ${op} balasan · ${s.replyHex || 'tidak ada'}`, !s.replyHex);
      }
      this.log(`${label} · ${report.ok ? 'OK' : 'GAGAL'} · ${report.detail} · ${report.mode}`, !report.ok);
    } catch (err) {
      this.log(`${label} · ERROR · ${this.msg(err)}`, true);
    } finally {
      this.busy = false;
      this.busyAction = '';
      this.busyLabel = '';
    }
  }

  private scanDetail(res: SlotCheckOutcome): string {
    const code = res.trace?.result;
    if (code == null) return res.detail;
    return `${res.detail} · ${this.byteHex(code)}`;
  }

  private hex2(n: number): string {
    return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
  }

  private normalize(raw: string): string {
    const t = String(raw || '').trim();
    if (!/^\d{1,5}$/.test(t)) {
      this.log(`nomor slot tidak valid: "${raw}"`, true);
      return '';
    }
    return String(Number.parseInt(t, 10)).padStart(3, '0');
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private startClock(): void {
    this.stopClock();
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
  }

  private stopClock(): void {
    if (!this.clockTimer) return;
    clearInterval(this.clockTimer);
    this.clockTimer = null;
  }

  private tickClock(): void {
    this.clockLabel = new Date().toLocaleTimeString('id-ID', { hour12: false });
  }

  private log(text: string, bad: boolean): void {
    const at = new Date().toLocaleTimeString('id-ID', { hour12: false });
    this.logs = [{ at, text, bad }, ...this.logs].slice(0, 120);
  }
}
