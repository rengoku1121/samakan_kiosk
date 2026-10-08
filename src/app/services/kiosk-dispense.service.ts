import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject, Observable, Subject, firstValueFrom, from, timeout } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { LoopbackSerialDriver } from '../hardware/serial/loopback-serial.driver';
import { VmcLoopbackSimulator } from '../hardware/serial/vmc-loopback.simulator';
import { VmcSerialTransport } from '../hardware/serial/vmc-serial.transport';
import {
  buildAckFrame,
  buildCheckSelectionFrame,
  buildDriveSelectionFrame,
  buildJammedSelectionFrame,
  buildRequestMachineStatusFrame,
  bytesToHex,
  DispenseStatus,
  formatSelectionCode,
  isAckFrame,
  isHeatingRelatedStatus,
  isJammedSelectionReply,
  isPickupDoorClosingStatus,
  isPollFrame,
  isTerminalSuccessStatus,
  JammedQueryResult,
  JammedSelectionMenu,
  JammedSelectionOperation,
  parseCheckSelectionResult,
  parseDispenseStatusFrame,
  parseJammedClearReply,
  parseJammedQueryReply,
  VmcCmd,
  VmcFrame,
} from '../hardware/vmc';
import { dispenseLog } from './dispense-log';

export type DispenseRequest = {
  order_code: string;
  slot_code: string;
  heat_requested: boolean;
};

export type DispenseOk = {
  ok: true;
  detail: string;
  mode: DispenseRuntimeMode;
};

export type DispenseFail = {
  ok: false;
  detail: string;
  mode: DispenseRuntimeMode;
};

export type DispenseOutcome = DispenseOk | DispenseFail;

/** @deprecated gunakan DispenseRequest */
export type MockDispenseRequest = DispenseRequest;
/** @deprecated gunakan DispenseOutcome */
export type MockDispenseOutcome = DispenseOutcome;

export type DispenseRuntimeMode = 'mock' | 'loopback-sim' | 'hardware';

/** Frame 0x01/0x02 apa adanya, untuk log Mode Servis. */
export type SlotCheckTrace = {
  sentHex: string;
  ackHex: string | null;
  replyHex: string | null;
  replyCmd: number | null;
  replyLen: number | null;
  packNo: number | null;
  /** Byte hasil 0x02. 0x04 = selection pause. */
  result: number | null;
  resultLabel: string | null;
  selectionNumber: number | null;
  /** Dua byte selection di payload, sebelum diubah jadi nomor. */
  selectionBytes: string | null;
  payloadHex: string | null;
};

export type SlotCheckOutcome = {
  ok: boolean;
  detail: string;
  mode: DispenseRuntimeMode;
  trace?: SlotCheckTrace;
};

/** Riwayat singkat perintah 0x06 di Mode Servis. Bukan log seluruh byte VMC. */
export const DRIVE_HISTORY_KEY = 'samakan.kiosk.drive-history';
const DRIVE_HISTORY_LIMIT = 20;

/**
 * Snapshot frame 0x06 terakhir — dipakai Mode Servis untuk membuktikan
 * "tes dingin" benar-benar mengirim `elevator=0`.
 */
export type LastDriveCommand = {
  at: number;
  hex: string;
  packNo: number;
  slotCode: string;
  heat: boolean;
  elevator: 0 | 1;
  mode: DispenseRuntimeMode;
  /** Status 0x04 terakhir untuk perintah ini; null selagi berjalan. */
  status: number | null;
  statusLabel: string | null;
  ok: boolean | null;
};

/**
 * Hasil probe 0x53. Frame balasan tidak diparse — format reply tidak ada di
 * PDF, jadi hanya hex mentah yang dilaporkan.
 */
export type MachineStatusProbe = {
  ok: boolean;
  mode: DispenseRuntimeMode;
  sentHex: string;
  detail: string;
  replies: { cmd: number; hex: string }[];
};

/** Satu tukar frame 0x70 → ACK → 0x71, hex apa adanya untuk log Mode Servis. */
export type JammedMenuStep = {
  operation: JammedSelectionOperation;
  sentHex: string;
  ackHex: string | null;
  replyHex: string | null;
};

/** Hasil cek / bersihkan slot jammed (PDF 4.5.32). */
export type JammedSelectionReport = {
  ok: boolean;
  mode: DispenseRuntimeMode;
  detail: string;
  /** Slot jammed menurut cek terakhir; null jika belum terbaca. */
  jammed: string[] | null;
  /** Belt yang gagal self-test menurut cek terakhir; null jika belum terbaca. */
  beltFailed: string[] | null;
  steps: JammedMenuStep[];
};

/** Progress UI (countdown heating / ambil produk). */
export type DispenseProgress = {
  message: string;
  /** Sisa detik pemanas dari VMC (0x23); null jika tidak relevan. */
  heatingRemainingSec: number | null;
  phase: 'busy' | 'heating' | 'pickup';
};

type VmcEnv = {
  mode?: 'auto' | 'mock' | 'hardware' | 'loopback-sim';
  dispenseTimeoutMs?: number;
  commandAckTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Tunggu pintu delivery menutup setelah TAKE_LUNCH_BOX. */
  pickupDoorTimeoutMs?: number;
  /** Jeda setelah sukses supaya motor/pendorong tray sempat pulang. */
  motorSettleMs?: number;
  /** Lama menunggu balasan probe 0x53 di Mode Servis. */
  machineStatusWindowMs?: number;
};

/**
 * Dispense kiosk (tahap 3):
 * - hardware/Android: serial USB → POLL → 0x06 → status 0x04
 * - browser (auto): loopback simulator VMC
 * - mock: delay lama (fallback)
 *
 * @see ../hardware/README.md
 */
@Injectable({ providedIn: 'root' })
export class KioskDispenseService {
  private readonly progressSubject = new Subject<DispenseProgress>();
  readonly progress$: Observable<DispenseProgress> = this.progressSubject.asObservable();

  private packNo = 1;
  private simulator: VmcLoopbackSimulator | null = null;
  private lastMode: DispenseRuntimeMode = 'mock';
  private lastDrive: LastDriveCommand | null = null;
  private driveHistory: LastDriveCommand[] = [];

  constructor(private readonly serial: VmcSerialTransport) {
    this.driveHistory = readDriveHistory();
    this.lastDrive = this.driveHistory[0] ? { ...this.driveHistory[0] } : null;
  }

  getLastMode(): DispenseRuntimeMode {
    return this.lastMode;
  }

  /** Snapshot frame 0x06 terakhir (Mode Servis saja). */
  getLastDriveCommand(): LastDriveCommand | null {
    return this.lastDrive ? { ...this.lastDrive } : null;
  }

  /** Hingga 20 perintah 0x06 terakhir, yang terbaru di depan. */
  getDriveHistory(): LastDriveCommand[] {
    return this.driveHistory.map((d) => ({ ...d }));
  }

  /**
   * Probe status mesin (0x53) untuk Mode Servis.
   *
   * Gagal-aman: hanya mengumpulkan frame non-POLL selama jendela singkat lalu
   * melaporkan hex-nya. Tidak mengubah alur jual dan tidak menebak isi balasan.
   */
  async requestMachineStatus(): Promise<MachineStatusProbe> {
    const mode = this.resolveMode();
    this.lastMode = mode;

    if (mode === 'mock') {
      return {
        ok: false,
        mode,
        sentHex: '',
        detail: 'Mode mock: tidak ada VMC untuk ditanya',
        replies: [],
      };
    }

    const cfg = (environment as { vmc?: VmcEnv }).vmc || {};
    const windowMs = cfg.machineStatusWindowMs ?? 3000;
    const packNo = this.nextPackNo();
    const frame = buildRequestMachineStatusFrame(packNo);
    const sentHex = bytesToHex(frame);
    const replies: { cmd: number; hex: string }[] = [];

    try {
      await this.ensureSerialReady(mode, cfg.pollIntervalMs ?? 200);

      const sub = this.serial.frames$
        .pipe(filter((f) => !isPollFrame(f.cmd)))
        .subscribe((f) => replies.push({ cmd: f.cmd & 0xff, hex: bytesToHex(f.raw) }));

      dispenseLog('info', '0x53 request machine status queued', { hex: sentHex, packNo });
      this.serial.queueOnPoll(frame);

      try {
        await new Promise((resolve) => setTimeout(resolve, windowMs));
      } finally {
        sub.unsubscribe();
        // Jangan tinggalkan 0x53 menggantung: bisa terkirim di POLL saat order jalan.
        if (this.serial.hasQueuedCommand()) this.serial.clearQueuedCommand();
      }

      if (!replies.length) {
        dispenseLog('warn', '0x53 tidak ada balasan', { windowMs });
        return {
          ok: false,
          mode,
          sentHex,
          detail: `Tidak ada balasan dalam ${windowMs}ms`,
          replies,
        };
      }

      dispenseLog('info', '0x53 balasan', replies);
      return {
        ok: true,
        mode,
        sentHex,
        detail: `${replies.length} frame balasan`,
        replies,
      };
    } catch (err) {
      this.serial.clearQueuedCommand();
      const msg = err instanceof Error ? err.message : String(err);
      dispenseLog('error', '0x53 exception', msg);
      return { ok: false, mode, sentHex, detail: msg, replies };
    }
  }

  /**
   * Cek slot ke VMC (0x01) sebelum QRIS.
   * Gagal = jangan lanjut bayar (motor tidak ada / macet / timeout).
   */
  async checkSlotReady(slotCode: string): Promise<SlotCheckOutcome> {
    const mode = this.resolveMode();
    this.lastMode = mode;
    dispenseLog('info', 'checkSlotReady', { slotCode, mode });

    if (mode === 'mock') {
      return { ok: true, detail: 'Mock: cek slot dilewati', mode };
    }

    const cfg = (environment as { vmc?: VmcEnv }).vmc || {};
    const commandAckTimeoutMs = cfg.commandAckTimeoutMs ?? 8000;
    const trace: SlotCheckTrace = {
      sentHex: '',
      ackHex: null,
      replyHex: null,
      replyCmd: null,
      replyLen: null,
      packNo: null,
      result: null,
      resultLabel: null,
      selectionNumber: null,
      selectionBytes: null,
      payloadHex: null,
    };

    try {
      await this.ensureSerialReady(mode, cfg.pollIntervalMs ?? 200);
      const packNo = this.nextPackNo();
      const frame = buildCheckSelectionFrame(packNo, slotCode);
      trace.sentHex = bytesToHex(frame);
      dispenseLog('info', 'check frame queued', { hex: trace.sentHex, slotCode });
      this.serial.queueOnPoll(frame);

      const ack = await this.waitForFrame(
        (f) => isAckFrame(f.cmd),
        commandAckTimeoutMs,
        'Mesin tidak merespons cek slot. Coba lagi.'
      );
      trace.ackHex = bytesToHex(ack.raw);

      const reply = await this.waitForFrame(
        (f) => (f.cmd & 0xff) === VmcCmd.CHECK_SELECTION_RESULT,
        commandAckTimeoutMs,
        'Timeout menunggu hasil cek slot dari mesin.'
      );
      trace.replyHex = bytesToHex(reply.raw);
      trace.replyCmd = reply.cmd & 0xff;
      trace.replyLen = reply.length;
      trace.payloadHex = bytesToHex(reply.payload);
      if (reply.payload.length >= 4) {
        trace.selectionBytes = bytesToHex(reply.payload.subarray(2, 4));
      }
      const parsed = parseCheckSelectionResult(reply);
      if (!parsed) {
        dispenseLog('error', 'checkSlotReady unrecognized', trace);
        return { ok: false, detail: 'Balasan cek slot tidak dikenali', mode, trace };
      }
      trace.packNo = parsed.packNo;
      trace.result = parsed.result;
      trace.resultLabel = parsed.statusLabel;
      trace.selectionNumber = parsed.selectionNumber;
      if (!parsed.ok) {
        const detail = `${parsed.statusLabel} · slot ${slotCode}`;
        dispenseLog('error', 'checkSlotReady FAIL', { detail, ...trace });
        return { ok: false, detail, mode, trace };
      }
      dispenseLog('info', 'checkSlotReady OK', trace);
      return { ok: true, detail: parsed.statusLabel, mode, trace };
    } catch (err) {
      this.serial.clearQueuedCommand();
      const msg = err instanceof Error ? err.message : String(err);
      dispenseLog('error', 'checkSlotReady exception', { msg, ...trace });
      const hasFrame = Boolean(trace.sentHex || trace.ackHex || trace.replyHex);
      return { ok: false, detail: msg, mode, ...(hasFrame ? { trace } : {}) };
    }
  }

  /** Tanya VMC slot mana yang tercatat jammed (0x70 · 0x32 · 0x00). */
  async queryJammedSelections(): Promise<JammedSelectionReport> {
    return this.runJammedMenu(async (steps) => {
      const found = await this.readJammed(steps);
      return { ok: true, detail: `Cek selesai · ${describeJammed(found)}`, ...jammedCodes(found) };
    });
  }

  /**
   * Bersihkan tanda jammed di VMC (0x70 · 0x32 · 0x01), sesuai urutan PDF:
   * cek dulu, bersihkan, lalu cek ulang untuk memastikan.
   * Motor tidak digerakkan — jalur tetap harus dibersihkan secara fisik.
   */
  async clearJammedSelections(): Promise<JammedSelectionReport> {
    return this.runJammedMenu(async (steps) => {
      const before = await this.readJammed(steps);

      const cleared = parseJammedClearReply(await this.exchangeJammedMenu('clear', steps));
      if (!cleared) throw new Error('Balasan clear jammed tidak dikenali');
      if (!cleared.ok) {
        return { ok: false, detail: 'Mesin menolak clear jammed', ...jammedCodes(before) };
      }

      const after = await this.readJammed(steps);
      const stillJammed = after.jammed.length > 0;
      return {
        ok: !stillJammed,
        detail: stillJammed
          ? `Clear terkirim, tapi ${describeJammed(after)}`
          : `Clear berhasil · sebelumnya ${describeJammed(before)}`,
        ...jammedCodes(after),
      };
    });
  }

  /**
   * Jalankan perintah menu jammed dengan penanganan error yang sama:
   * mock ditolak, serial disiapkan, antrean dibersihkan bila gagal.
   */
  private async runJammedMenu(
    work: (
      steps: JammedMenuStep[]
    ) => Promise<Pick<JammedSelectionReport, 'ok' | 'detail' | 'jammed' | 'beltFailed'>>
  ): Promise<JammedSelectionReport> {
    const mode = this.resolveMode();
    this.lastMode = mode;
    const steps: JammedMenuStep[] = [];

    if (mode === 'mock') {
      return {
        ok: false,
        mode,
        detail: 'Mode mock: tidak ada VMC',
        jammed: null,
        beltFailed: null,
        steps,
      };
    }

    try {
      const cfg = (environment as { vmc?: VmcEnv }).vmc || {};
      await this.ensureSerialReady(mode, cfg.pollIntervalMs ?? 200);
      const result = await work(steps);
      dispenseLog(result.ok ? 'info' : 'warn', 'jammed menu', { ...result, steps });
      return { ...result, mode, steps };
    } catch (err) {
      this.serial.clearQueuedCommand();
      const msg = err instanceof Error ? err.message : String(err);
      dispenseLog('error', 'jammed menu exception', { msg, steps });
      return { ok: false, mode, detail: msg, jammed: null, beltFailed: null, steps };
    }
  }

  private async readJammed(steps: JammedMenuStep[]): Promise<JammedQueryResult> {
    const found = parseJammedQueryReply(await this.exchangeJammedMenu('query', steps));
    if (!found) throw new Error('Balasan cek jammed tidak dikenali');
    return found;
  }

  /** Kirim 0x70 saat POLL, tunggu ACK + reply 0x71, lalu ACK reply tersebut. */
  private async exchangeJammedMenu(
    operation: JammedSelectionOperation,
    steps: JammedMenuStep[]
  ): Promise<VmcFrame> {
    const cfg = (environment as { vmc?: VmcEnv }).vmc || {};
    const waitMs = cfg.commandAckTimeoutMs ?? 8000;
    const opByte = operation === 'clear' ? JammedSelectionMenu.CLEAR : JammedSelectionMenu.QUERY;
    const frame = buildJammedSelectionFrame(this.nextPackNo(), operation);
    const step: JammedMenuStep = {
      operation,
      sentHex: bytesToHex(frame),
      ackHex: null,
      replyHex: null,
    };
    steps.push(step);

    // Dengarkan sebelum antre: reply bisa tiba hanya beberapa ms setelah ACK.
    const ack = this.waitForFrame(
      (f) => isAckFrame(f.cmd),
      waitMs,
      'Mesin tidak merespons perintah jammed. Coba lagi.'
    );
    const reply = this.waitForFrame(
      (f) => isJammedSelectionReply(f, opByte),
      waitMs,
      'Timeout menunggu balasan 0x71 dari mesin.'
    );
    reply.catch(() => undefined);

    this.serial.queueOnPoll(frame);
    step.ackHex = bytesToHex((await ack).raw);
    const replyFrame = await reply;
    step.replyHex = bytesToHex(replyFrame.raw);

    // PDF bab 2: data dari VMC wajib di-ACK, kalau tidak VMC mengirim ulang sampai 5x.
    await this.serial.writeFrame(buildAckFrame());
    return replyFrame;
  }

  /**
   * Jalankan dispense fisik / simulasi.
   * API reportDispenseResult tetap dipanggil dari halaman dispense.
   */
  run(req: DispenseRequest): Observable<DispenseOutcome> {
    const mode = this.resolveMode();
    this.lastMode = mode;
    dispenseLog('info', 'run()', {
      mode,
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform(),
      order_code: req.order_code,
      slot_code: req.slot_code,
      heat_requested: req.heat_requested,
      envMode: (environment as { vmc?: VmcEnv }).vmc?.mode || 'auto',
    });

    if (mode === 'mock') {
      return this.runMock(req);
    }

    return from(this.runVmc(req, mode));
  }

  /** Alias kompatibilitas halaman lama. */
  runMock(req: DispenseRequest): Observable<DispenseOutcome> {
    this.lastMode = 'mock';
    this.emitProgress({
      message: 'Mode mock…',
      heatingRemainingSec: null,
      phase: 'busy',
    });
    return new Observable((sub) => {
      const t = setTimeout(() => {
        sub.next({
          ok: true,
          detail: `Mock OK (${req.heat_requested ? 'heat+drop' : 'drop'}) slot ${req.slot_code}`,
          mode: 'mock',
        });
        sub.complete();
      }, 2800);
      return () => clearTimeout(t);
    });
  }

  private resolveMode(): DispenseRuntimeMode {
    const cfg = (environment as { vmc?: VmcEnv }).vmc;
    const mode = cfg?.mode || 'auto';
    if (mode === 'mock' || mode === 'hardware' || mode === 'loopback-sim') return mode;
    // auto
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      return 'hardware';
    }
    return 'loopback-sim';
  }

  private nextPackNo(): number {
    const n = this.packNo;
    this.packNo = n >= 255 ? 1 : n + 1;
    return n;
  }

  /** Lengkapi snapshot 0x06 dengan hasil akhirnya; abaikan bila sudah tertimpa run lain. */
  private noteDriveStatus(
    packNo: number,
    status: number | null,
    statusLabel: string | null,
    ok: boolean
  ): void {
    if (!this.lastDrive || this.lastDrive.packNo !== packNo) return;
    this.commitDrive({ ...this.lastDrive, status, statusLabel, ok });
  }

  /** Simpan perintah 0x06 terbaru dan geser riwayat, termasuk setelah status akhir masuk. */
  private commitDrive(cmd: LastDriveCommand): void {
    this.lastDrive = cmd;
    const rest = this.driveHistory.filter((d) => !(d.at === cmd.at && d.packNo === cmd.packNo));
    this.driveHistory = [cmd, ...rest].slice(0, DRIVE_HISTORY_LIMIT);
    try {
      localStorage.setItem(DRIVE_HISTORY_KEY, JSON.stringify(this.driveHistory));
    } catch {
      // Kuota penuh atau mode privat: kartu tetap memakai memori sesi ini.
    }
  }

  private async runVmc(req: DispenseRequest, mode: DispenseRuntimeMode): Promise<DispenseOutcome> {
    const cfg = (environment as { vmc?: VmcEnv }).vmc || {};
    const dispenseTimeoutMs = cfg.dispenseTimeoutMs ?? 5 * 60 * 1000;
    const commandAckTimeoutMs = cfg.commandAckTimeoutMs ?? 8000;
    const pollIntervalMs = cfg.pollIntervalMs ?? 200;
    const pickupDoorTimeoutMs = cfg.pickupDoorTimeoutMs ?? 90_000;
    this.pickupWatch += 1;
    this.setPickupDoorOpen(false);
    this.lastProgress = null;

    this.emitProgress({
      message: 'Menyambung ke VMC…',
      heatingRemainingSec: null,
      phase: 'busy',
    });
    dispenseLog('info', 'runVmc open serial', {
      mode,
      alreadyOpen: this.serial.isOpen(),
      ackTimeoutMs: commandAckTimeoutMs,
      dispenseTimeoutMs,
      pickupDoorTimeoutMs,
    });

    let packNo = 0;
    try {
      await this.ensureSerialReady(mode, pollIntervalMs);

      packNo = this.nextPackNo();
      const drive = buildDriveSelectionFrame({
        packNo,
        slotCode: req.slot_code,
        heatRequested: req.heat_requested,
        enableDropSensor: true,
      });
      this.commitDrive({
        at: Date.now(),
        hex: bytesToHex(drive),
        packNo,
        slotCode: req.slot_code,
        heat: req.heat_requested === true,
        elevator: req.heat_requested === true ? 1 : 0,
        mode,
        status: null,
        statusLabel: null,
        ok: null,
      });
      dispenseLog('info', 'drive frame queued for POLL', {
        packNo,
        slot_code: req.slot_code,
        heat: req.heat_requested === true,
        elevator: req.heat_requested === true ? 1 : 0,
        hex: bytesToHex(drive),
      });

      this.emitProgress({
        message: req.heat_requested
          ? 'Menunggu POLL / memanaskan…'
          : 'Menunggu POLL / mengeluarkan…',
        heatingRemainingSec: null,
        phase: 'busy',
      });

      // Listener status dulu agar tidak miss frame cepat dari simulator/mesin
      const statusPromise = this.waitForTerminalStatus(req.slot_code, dispenseTimeoutMs, {
        heatRequested: req.heat_requested,
        pickupDoorTimeoutMs,
      });

      // Antre command; dikirim saat POLL berikutnya
      this.serial.queueOnPoll(drive);

      // Tunggu ACK dari VMC atas command kita
      dispenseLog('info', `menunggu ACK (timeout ${commandAckTimeoutMs}ms)`);
      const ackFrame = await this.waitForFrame(
        (f) => isAckFrame(f.cmd),
        commandAckTimeoutMs,
        'Timeout menunggu ACK dari VMC (command tidak direspons)'
      );
      dispenseLog('info', 'ACK diterima', { hex: bytesToHex(ackFrame.raw) });

      this.emitProgress({
        message: 'Perintah diterima, menunggu status dispense…',
        heatingRemainingSec: null,
        phase: 'busy',
      });

      const statusEvent = await statusPromise;
      this.noteDriveStatus(packNo, statusEvent.status, statusEvent.statusLabel, statusEvent.isSuccess);

      if (statusEvent.isSuccess) {
        const detail = `${statusEvent.statusLabel} · slot ${formatSelectionCode(statusEvent.selectionNumber)} · ${mode}`;
        dispenseLog('info', 'dispense SUCCESS', detail);
        return {
          ok: true,
          detail,
          mode,
        };
      }

      const failDetail = `${statusEvent.statusLabel} (0x${statusEvent.status.toString(16)}) · slot ${req.slot_code}`;
      dispenseLog('error', 'dispense FAIL status VMC', failDetail);
      return {
        ok: false,
        detail: failDetail,
        mode,
      };
    } catch (err) {
      this.serial.clearQueuedCommand();
      const msg = err instanceof Error ? err.message : String(err);
      this.noteDriveStatus(packNo, null, msg, false);
      dispenseLog('error', 'runVmc exception', msg);
      return { ok: false, detail: msg, mode };
    } finally {
      // Simulator boleh tetap hidup antar-order di browser; dihentikan saat transport close.
      if (!this.serial.isOpen()) this.stopSimulator();
    }
  }

  private async ensureSerialReady(mode: DispenseRuntimeMode, pollIntervalMs: number): Promise<void> {
    if (!this.serial.isOpen()) {
      await this.serial.open({
        forceLoopback: mode === 'loopback-sim',
        autoAckPoll: true,
      });
      dispenseLog('info', 'serial open OK', {
        driver: this.serial.activeDriver?.name,
      });
    }

    if (mode === 'loopback-sim') {
      this.ensureSimulator(pollIntervalMs);
      dispenseLog('info', 'loopback simulator started', { pollIntervalMs });
    } else {
      this.stopSimulator();
      // Hanya UART fisik: simulator selalu "hidup", jadi watchdog tidak relevan.
      this.serial.startAutoReconnect();
    }
  }

  private ensureSimulator(pollIntervalMs: number): void {
    const drv = this.serial.activeDriver;
    if (!(drv instanceof LoopbackSerialDriver)) return;
    if (!this.simulator) this.simulator = new VmcLoopbackSimulator();
    this.simulator.stop();
    this.simulator.start(drv, pollIntervalMs);
  }

  private stopSimulator(): void {
    this.simulator?.stop();
    this.simulator = null;
  }

  private lastProgress: DispenseProgress | null = null;
  private pickupWatch = 0;
  private readonly pickupDoorOpenSubject = new BehaviorSubject(false);

  /** Lubang pengambilan masih terbuka setelah dispense berhasil. */
  readonly pickupDoorOpen$ = this.pickupDoorOpenSubject.asObservable();

  get isPickupDoorOpen(): boolean {
    return this.pickupDoorOpenSubject.value;
  }

  private setPickupDoorOpen(open: boolean): void {
    if (this.pickupDoorOpenSubject.value === open) return;
    this.pickupDoorOpenSubject.next(open);
  }

  private emitProgress(p: DispenseProgress): void {
    if (
      this.lastProgress &&
      this.lastProgress.phase === p.phase &&
      this.lastProgress.message === p.message
    ) {
      return;
    }
    this.lastProgress = p;
    this.progressSubject.next(p);
  }

  private async waitForFrame(
    predicate: (f: VmcFrame) => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<VmcFrame> {
    try {
      return await firstValueFrom(
        this.serial.frames$.pipe(
          filter(predicate),
          take(1),
          timeout({ each: timeoutMs })
        )
      );
    } catch {
      throw new Error(timeoutMessage);
    }
  }

  private async waitForTerminalStatus(
    slotCode: string,
    timeoutMs: number,
    opts: { heatRequested: boolean; pickupDoorTimeoutMs: number }
  ) {
    const started = Date.now();
    let seenHeating = false;

    while (Date.now() - started < timeoutMs) {
      const remain = timeoutMs - (Date.now() - started);
      let frame: VmcFrame;
      try {
        frame = await firstValueFrom(
          this.serial.frames$.pipe(
            filter((f) => (f.cmd & 0xff) === VmcCmd.DISPENSE_STATUS),
            take(1),
            timeout({ each: Math.min(remain, 30_000) })
          )
        );
      } catch {
        throw new Error('Timeout menunggu status dispense dari VMC');
      }

      const ev = parseDispenseStatusFrame(frame);
      if (!ev) continue;

      if (isHeatingRelatedStatus(ev.status)) {
        seenHeating = true;
      }

      const terminalOk = isTerminalSuccessStatus(ev.status, {
        heatRequested: opts.heatRequested,
        seenHeating,
      });

      if (ev.isFailure) {
        dispenseLog('error', 'status terminal', {
          hex: bytesToHex(frame.raw),
          label: ev.statusLabel,
          status: `0x${ev.status.toString(16)}`,
        });
        return ev;
      }

      if (terminalOk) {
        dispenseLog('info', 'status terminal sukses', {
          hex: bytesToHex(frame.raw),
          label: ev.statusLabel,
          status: `0x${ev.status.toString(16)}`,
          heat: opts.heatRequested,
          seenHeating,
        });

        this.emitProgress({
          message: 'Silakan ambil produk di lubang pengambilan',
          heatingRemainingSec: null,
          phase: 'pickup',
        });

        // Lubang sering masih terbuka. Jangan tahan layar sukses —
        // POLL tetap di-ACK di background sampai pintu menutup atau timeout.
        this.watchPickupDoorClose(opts.pickupDoorTimeoutMs);

        return { ...ev, isSuccess: true, isFailure: false, isProgress: false };
      }

      // 0x02 sebelum heating pada alur heat → masih progress
      if (opts.heatRequested && ev.isSuccess && !seenHeating) {
        this.emitProgress({
          message: 'Produk keluar, menunggu pemanas…',
          heatingRemainingSec: null,
          phase: 'busy',
        });
        dispenseLog('info', 'status progress (SUCCESS early, heat)', {
          hex: bytesToHex(frame.raw),
        });
        continue;
      }

      const heatingSec = ev.heatingRemainingSec;
      const phase: DispenseProgress['phase'] =
        heatingSec != null ||
        ev.status === DispenseStatus.LUNCH_HEATING ||
        ev.status === DispenseStatus.LUNCH_HEATING_REMAINING
          ? 'heating'
          : 'busy';
      this.emitProgress({
        message: phase === 'heating' ? 'Makanan sedang dipanaskan' : ev.statusLabel,
        heatingRemainingSec: heatingSec,
        phase,
      });
      dispenseLog('info', 'status progress', {
        hex: bytesToHex(frame.raw),
        label: ev.statusLabel,
        status: `0x${ev.status.toString(16)}`,
        heatingRemainingSec: heatingSec,
      });
    }
    throw new Error(`Timeout dispense slot ${slotCode}`);
  }

  /**
   * Setelah produk siap diambil, VMC masih mengirim status (0x24 berulang, lalu
   * 0x14 pintu menutup). Jangan ubah UI — POLL tetap di-ACK oleh transport.
   */
  private watchPickupDoorClose(pickupDoorTimeoutMs: number): void {
    const gen = ++this.pickupWatch;
    const waitMs = Math.max(5_000, pickupDoorTimeoutMs);
    this.setPickupDoorOpen(true);
    void this.ackUntilPickupDoorClose(waitMs, gen);
  }

  private async ackUntilPickupDoorClose(waitMs: number, gen: number): Promise<void> {
    const until = Date.now() + waitMs;
    dispenseLog('info', 'watch pintu pickup (tanpa tahan UI)', { waitMs });

    while (Date.now() < until && gen === this.pickupWatch) {
      const remain = until - Date.now();
      let frame: VmcFrame;
      try {
        frame = await firstValueFrom(
          this.serial.frames$.pipe(
            filter((f) => (f.cmd & 0xff) === VmcCmd.DISPENSE_STATUS),
            take(1),
            timeout({ each: Math.min(remain, 15_000) })
          )
        );
      } catch {
        continue;
      }
      if (gen !== this.pickupWatch) return;

      const ev = parseDispenseStatusFrame(frame);
      if (!ev) continue;

      if (isPickupDoorClosingStatus(ev.status)) {
        dispenseLog('info', 'pickup door closing', { hex: bytesToHex(frame.raw) });
        if (gen === this.pickupWatch) this.setPickupDoorOpen(false);
        return;
      }

      if (ev.isFailure) {
        dispenseLog('warn', 'status setelah pickup (abaikan untuk order OK)', {
          label: ev.statusLabel,
          status: `0x${ev.status.toString(16)}`,
        });
      }
    }

    if (gen === this.pickupWatch) {
      this.setPickupDoorOpen(false);
      dispenseLog('warn', 'timeout watch pintu menutup — UI sudah di success');
    }
  }
}

function jammedCodes(found: JammedQueryResult): Pick<JammedSelectionReport, 'jammed' | 'beltFailed'> {
  return {
    jammed: found.jammed.map(formatSelectionCode),
    beltFailed: found.beltFailed.map(formatSelectionCode),
  };
}

function describeJammed(found: JammedQueryResult): string {
  const codes = found.jammed.map(formatSelectionCode);
  return codes.length ? `${codes.length} slot jammed: ${codes.join(', ')}` : 'tidak ada slot jammed';
}

function readDriveHistory(): LastDriveCommand[] {
  try {
    const raw = localStorage.getItem(DRIVE_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDriveRecord).slice(0, DRIVE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function isDriveRecord(v: unknown): v is LastDriveCommand {
  if (!v || typeof v !== 'object') return false;
  const d = v as LastDriveCommand;
  return (
    typeof d.at === 'number' &&
    typeof d.hex === 'string' &&
    typeof d.packNo === 'number' &&
    typeof d.slotCode === 'string' &&
    typeof d.heat === 'boolean' &&
    (d.elevator === 0 || d.elevator === 1) &&
    (d.mode === 'mock' || d.mode === 'hardware' || d.mode === 'loopback-sim') &&
    (d.status === null || typeof d.status === 'number') &&
    (d.statusLabel === null || typeof d.statusLabel === 'string') &&
    (d.ok === null || typeof d.ok === 'boolean')
  );
}
