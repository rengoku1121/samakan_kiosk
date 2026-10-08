import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular';
import { Subject, of } from 'rxjs';
import { KioskApiService } from '../services/kiosk-api.service';
import { KioskConfigService } from '../services/kiosk-config.service';
import { KioskNetworkService, KioskNetworkStatus } from '../services/kiosk-network.service';
import {
  DispenseOutcome,
  DispenseProgress,
  DispenseRequest,
  JammedSelectionReport,
  KioskDispenseService,
  LastDriveCommand,
  MachineStatusProbe,
} from '../services/kiosk-dispense.service';
import { KioskLockService } from '../services/kiosk-lock.service';
import { KioskServiceAccess } from '../services/kiosk-service-access.service';
import { ServicePage } from './service.page';

/** Stub VMC: mencatat request 0x06 dan membalas snapshot seperti service asli. */
class DispenseStub {
  readonly progress$ = new Subject<DispenseProgress>();
  lastRequest: DispenseRequest | null = null;
  statusProbe: MachineStatusProbe = {
    ok: true,
    mode: 'loopback-sim',
    sentHex: 'FA FB 53 01 01 52',
    detail: '1 frame balasan',
    replies: [{ cmd: 0x42, hex: 'FA FB 42 00 43' }],
  };

  getLastMode() {
    return 'loopback-sim' as const;
  }

  run(req: DispenseRequest) {
    this.lastRequest = req;
    const outcome: DispenseOutcome = {
      ok: true,
      detail: 'Dispensed successfully',
      mode: 'loopback-sim',
    };
    return of(outcome);
  }

  getDriveHistory(): LastDriveCommand[] {
    const last = this.getLastDriveCommand();
    return last ? [last] : [];
  }

  getLastDriveCommand(): LastDriveCommand | null {
    const req = this.lastRequest;
    if (!req) return null;
    return {
      at: Date.now(),
      hex: req.heat_requested ? 'FA FB 06 05 01 01 01 00 0D 0E' : 'FA FB 06 05 01 01 00 00 0D 0F',
      packNo: 1,
      slotCode: req.slot_code,
      heat: req.heat_requested,
      elevator: req.heat_requested ? 1 : 0,
      mode: 'loopback-sim',
      status: 0x02,
      statusLabel: 'Dispensed successfully',
      ok: true,
    };
  }

  async requestMachineStatus(): Promise<MachineStatusProbe> {
    return this.statusProbe;
  }

  slotCheck: {
    ok: boolean;
    detail: string;
    mode: 'loopback-sim' | 'hardware';
    trace?: {
      sentHex: string;
      ackHex: string | null;
      replyHex: string | null;
      replyCmd: number | null;
      replyLen: number | null;
      packNo: number | null;
      result: number | null;
      resultLabel: string | null;
      selectionNumber: number | null;
      selectionBytes: string | null;
      payloadHex: string | null;
    };
  } = { ok: true, detail: 'siap', mode: 'loopback-sim' };

  async checkSlotReady() {
    return this.slotCheck;
  }

  jammedCalls: string[] = [];
  jammedQuery: JammedSelectionReport = {
    ok: true,
    mode: 'hardware',
    detail: 'Cek selesai · 1 slot jammed: 013',
    jammed: ['013'],
    beltFailed: [],
    steps: [
      {
        operation: 'query',
        sentHex: 'FA FB 70 03 01 32 00 41',
        ackHex: 'FA FB 42 00 43',
        replyHex: 'FA FB 71 07 01 32 00 01 00 0D 00 48',
      },
    ],
  };
  jammedClear: JammedSelectionReport = {
    ok: true,
    mode: 'hardware',
    detail: 'Clear berhasil · sebelumnya 1 slot jammed: 013',
    jammed: [],
    beltFailed: [],
    steps: [
      { operation: 'query', sentHex: 'FA FB 70 03 02 32 00 42', ackHex: 'FA FB 42 00 43', replyHex: 'q1' },
      { operation: 'clear', sentHex: 'FA FB 70 03 03 32 01 42', ackHex: 'FA FB 42 00 43', replyHex: 'c1' },
      { operation: 'query', sentHex: 'FA FB 70 03 04 32 00 44', ackHex: 'FA FB 42 00 43', replyHex: 'q2' },
    ],
  };

  async queryJammedSelections() {
    this.jammedCalls.push('query');
    return this.jammedQuery;
  }

  async clearJammedSelections() {
    this.jammedCalls.push('clear');
    return this.jammedClear;
  }
}

class LockStub {
  async getStatus() {
    return {
      lockTaskPermitted: false,
      lockTaskActive: false,
      lockPaused: false,
      isDefaultHome: false,
    };
  }
}

describe('ServicePage (Mode Servis internal)', () => {
  let fixture: ComponentFixture<ServicePage>;
  let page: ServicePage;
  let dispense: DispenseStub;

  const text = (sel: string): string =>
    (fixture.nativeElement as HTMLElement).querySelector(sel)?.textContent?.trim() ?? '';

  const buttonByLabel = (label: string): HTMLButtonElement => {
    const all = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ) as HTMLButtonElement[];
    const found = all.find((b) => (b.textContent || '').trim() === label);
    if (!found) throw new Error(`tombol "${label}" tidak ada di Mode Servis`);
    return found;
  };

  const logLines = (): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.log li')).map(
      (li) => li.textContent?.trim() ?? ''
    );

  async function confirmDrop(): Promise<void> {
    fixture.detectChanges();
    buttonByLabel('Jatuhkan').click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dispense = new DispenseStub();
    await TestBed.configureTestingModule({
      declarations: [ServicePage],
      imports: [IonicModule.forRoot(), FormsModule, RouterTestingModule],
      providers: [
        KioskConfigService,
        { provide: KioskDispenseService, useValue: dispense },
        { provide: KioskLockService, useValue: new LockStub() },
        { provide: KioskApiService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServicePage);
    page = fixture.componentInstance;
    TestBed.inject(KioskServiceAccess).allowOnce();
    page.ionViewWillEnter();
    fixture.detectChanges();
  });

  afterEach(() => {
    page.ionViewWillLeave();
    fixture.destroy();
    localStorage.removeItem('samakan.kiosk.config');
  });

  it('mulai tanpa snapshot perintah', () => {
    expect(text('.card:nth-of-type(2)')).toContain('Belum ada perintah 0x06');
  });

  it('kartu mode servis dibuka dan ditutup dari header', () => {
    const panels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.card details')
    ) as HTMLDetailsElement[];
    expect(panels.length).toBe(9);
    expect(panels.every((panel) => !panel.open)).toBeTrue();

    const body = panels[0].querySelector('.panel-body') as HTMLElement;
    panels[0].querySelector('summary')?.click();
    expect(panels[0].open).toBeTrue();
    expect(parseFloat(body.style.height)).toBeGreaterThan(0);

    panels[0].querySelector('summary')?.click();
    expect(panels[0].open).toBeFalse();
    expect(body.style.height).toBe('0px');
  });

  it('selalu menampilkan tombol tutup aplikasi', () => {
    expect(buttonByLabel('Tutup aplikasi').disabled).toBeFalse();
  });

  it('dispense uji menunggu konfirmasi dan batal tidak menjalankan motor', () => {
    buttonByLabel('Dispense dingin').click();
    fixture.detectChanges();
    expect(text('.confirm')).toContain('slot 013');
    expect(text('.confirm')).toContain('dingin');
    expect(dispense.lastRequest).toBeNull();
    buttonByLabel('Batal').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm')).toBeNull();
    expect(dispense.lastRequest).toBeNull();
  });

  it('menampilkan status jaringan dan jam panel', () => {
    const card = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.card')
    ).find((el) => (el.textContent || '').includes('Jaringan'));
    expect(card?.textContent).toContain('Jam panel');
    expect(card?.textContent).toMatch(/Terhubung|Tidak terhubung/);
    expect(page.clockLabel).not.toBe('');
  });

  it('perbarui di browser menjelaskan bahwa Wi-Fi tidak tersedia', async () => {
    buttonByLabel('Perbarui').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.networkNote).toContain('aplikasi Android');
    expect(page.networkSsidLabel).toBe('Tidak tersedia di browser');
    expect(page.networkIpLabel).toBe('Tidak tersedia di browser');
  });

  it('perbarui menampilkan loader dan menyalakan tombol lagi setelah selesai', async () => {
    const net = TestBed.inject(KioskNetworkService);
    let release: (value: KioskNetworkStatus) => void = () => undefined;
    spyOn(net, 'read').and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const btn = buttonByLabel('Perbarui');
    btn.click();
    fixture.detectChanges();
    expect(btn.disabled).toBeTrue();
    expect(btn.classList.contains('is-loading')).toBeTrue();
    release({ online: true, transport: 'Browser', ssid: '', ip: '' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(btn.disabled).toBeFalse();
    expect(btn.classList.contains('is-loading')).toBeFalse();
  });

  it('muat ulang aplikasi menyegarkan halaman tanpa menutup aplikasi', () => {
    spyOn(page, 'reloadDocument');
    buttonByLabel('Muat ulang aplikasi').click();
    expect(page.reloadDocument).toHaveBeenCalledTimes(1);
    expect(page.logs.some((l) => l.text.includes('memuat ulang aplikasi'))).toBeTrue();
  });

  it('masuk ulang tanpa password kembali ke beranda', () => {
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl');
    page.ionViewWillLeave();
    page.ionViewWillEnter();
    expect(nav).toHaveBeenCalledWith('/home');
  });

  it('menyimpan password khusus mesin ini', () => {
    const config = TestBed.inject(KioskConfigService);
    page.newPassword = 'mesin-1';
    page.newPasswordAgain = 'beda';
    page.saveServicePassword();
    expect(config.checkServicePassword('mesin-1')).toBeFalse();

    page.newPasswordAgain = 'mesin-1';
    page.saveServicePassword();
    expect(config.checkServicePassword('mesin-1')).toBeTrue();
    expect(page.passwordNote).toContain('tersimpan');
    localStorage.removeItem('samakan.kiosk.config');
  });

  it('tes dingin menampilkan elevator=0 di kartu Perintah terakhir', async () => {
    buttonByLabel('Dispense dingin').click();
    await confirmDrop();

    expect(dispense.lastRequest?.heat_requested).toBeFalse();

    const card = text('.card:nth-of-type(2)');
    expect(card).toContain('dingin');
    expect(card).toContain('elevator=0');
    expect(card).toContain('FA FB 06 05 01 01 00 00 0D 0F');
    expect(card).toContain('Dispensed successfully');

    const fold = (fixture.nativeElement as HTMLElement).querySelector(
      '.card:nth-of-type(2) details'
    ) as HTMLDetailsElement;
    expect(fold.open).toBeFalse();
    fold.querySelector('summary')?.click();
    expect(fold.open).toBeTrue();
    expect(fold.textContent).toContain('elevator=0');

    expect(logLines().some((l) => l.includes('dingin') && l.includes('OK'))).toBeTrue();
  });

  it('tes dingin dibatalkan kalau cek 0x01 tidak siap, motor tidak dijalankan', async () => {
    dispense.slotCheck = {
      ok: false,
      detail: 'Stok slot habis · slot 013',
      mode: 'hardware',
    };

    buttonByLabel('Dispense dingin').click();
    await confirmDrop();

    expect(dispense.lastRequest).toBeNull();
    expect(text('.card:nth-of-type(2)')).toContain('Belum ada perintah 0x06');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.card:nth-of-type(2) .hist')
    ).toBeNull();
    expect(
      logLines().some((l) => l.includes('DIBATALKAN') && l.includes('motor tidak dijalankan'))
    ).toBeTrue();
    expect(page.busy).toBeFalse();
  });

  it('tes panas menampilkan elevator=1', async () => {
    buttonByLabel('Dispense panas').click();
    await confirmDrop();

    expect(dispense.lastRequest?.heat_requested).toBeTrue();
    const card = text('.card:nth-of-type(2)');
    expect(card).toContain('panas');
    expect(card).toContain('elevator=1');
  });

  it('Cek 0x01 menulis frame balasan lengkap, termasuk result 0x04', async () => {
    dispense.slotCheck = {
      ok: false,
      detail: 'Slot sedang dinonaktifkan · slot 001',
      mode: 'hardware',
      trace: {
        sentHex: 'FA FB 01 04 01 00 01 00 05',
        ackHex: 'FA FB 42 00 43',
        replyHex: 'FA FB 02 04 01 04 00 01 02',
        replyCmd: 0x02,
        replyLen: 4,
        packNo: 1,
        result: 0x04,
        resultLabel: 'Slot sedang dinonaktifkan',
        selectionNumber: 1,
        selectionBytes: '00 01',
        payloadHex: '01 04 00 01',
      },
    };
    page.slotCode = '001';
    buttonByLabel('Cek 0x01').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const lines = logLines();
    expect(lines.some((l) => l.includes('0x01 kirim') && l.includes('FA FB 01 04'))).toBeTrue();
    expect(lines.some((l) => l.includes('0x02 balasan') && l.includes('FA FB 02 04'))).toBeTrue();
    expect(lines.some((l) => l.includes('result 0x04') && l.includes('00 01 → 001'))).toBeTrue();

    const card = text('.card:nth-of-type(1)');
    expect(card).toContain('FA FB 02 04 01 04 00 01 02');
    expect(card).toContain('0x04');
    expect(card).toContain('00 01 → 001');
  });

  it('Cek status VMC menulis hex balasan ke log', async () => {
    buttonByLabel('Cek status VMC').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const lines = logLines();
    expect(lines.some((l) => l.includes('0x53 kirim') && l.includes('FA FB 53 01 01 52'))).toBeTrue();
    expect(lines.some((l) => l.includes('0x53 balasan') && l.includes('FA FB 42 00 43'))).toBeTrue();
  });

  it('probe 0x53 tanpa balasan hanya menandai log, tidak melempar', async () => {
    dispense.statusProbe = {
      ok: false,
      mode: 'hardware',
      sentHex: 'FA FB 53 01 01 52',
      detail: 'Tidak ada balasan dalam 3000ms',
      replies: [],
    };

    buttonByLabel('Cek status VMC').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(logLines().some((l) => l.includes('Tidak ada balasan'))).toBeTrue();
    expect(page.busy).toBeFalse();
  });

  describe('kartu Slot jammed', () => {
    const jammedCard = () => text('.card:nth-of-type(3)');

    it('Cek jammed menampilkan slot macet dan hex 0x70/0x71 di log', async () => {
      expect(jammedCard()).toContain('Belum dicek');

      buttonByLabel('Cek jammed').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(dispense.jammedCalls).toEqual(['query']);
      expect(jammedCard()).toContain('013');
      const lines = logLines();
      expect(lines.some((l) => l.includes('0x70 tanya kirim') && l.includes('FA FB 70 03 01 32 00 41'))).toBeTrue();
      expect(lines.some((l) => l.includes('0x71 tanya balasan') && l.includes('FA FB 71 07'))).toBeTrue();
      expect(lines.some((l) => l.includes('cek jammed · OK'))).toBeTrue();
    });

    it('Bersihkan jammed mencatat cek → clear → cek ulang', async () => {
      buttonByLabel('Bersihkan jammed').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(dispense.jammedCalls).toEqual(['clear']);
      expect(jammedCard()).toContain('Clear berhasil');
      expect(jammedCard()).toContain('tidak ada');
      const lines = logLines();
      expect(lines.filter((l) => l.includes('kirim') && l.includes('0x70')).length).toBe(3);
      expect(lines.some((l) => l.includes('0x70 clear kirim') && l.includes('32 01'))).toBeTrue();
      expect(page.busy).toBeFalse();
    });

    it('hasil gagal ditandai merah', async () => {
      dispense.jammedClear = {
        ok: false,
        mode: 'hardware',
        detail: 'Timeout menunggu balasan 0x71 dari mesin.',
        jammed: null,
        beltFailed: null,
        steps: [
          { operation: 'query', sentHex: 'FA FB 70 03 01 32 00 41', ackHex: null, replyHex: null },
        ],
      };

      buttonByLabel('Bersihkan jammed').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(jammedCard()).toContain('GAGAL');
      expect(jammedCard()).toContain('—');
      const bad = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.log li.bad')
      ).map((li) => li.textContent || '');
      expect(bad.some((l) => l.includes('ACK · tidak ada'))).toBeTrue();
      expect(bad.some((l) => l.includes('bersihkan jammed · GAGAL'))).toBeTrue();
    });
  });
});
