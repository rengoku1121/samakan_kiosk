import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { VmcLoopbackSimulator } from '../hardware/serial/vmc-loopback.simulator';
import { VmcSerialTransport } from '../hardware/serial/vmc-serial.transport';
import { bytesToHex } from '../hardware/vmc';
import { DRIVE_HISTORY_KEY, KioskDispenseService } from './kiosk-dispense.service';

describe('KioskDispenseService (tahap 3)', () => {
  let svc: KioskDispenseService;

  beforeEach(() => {
    localStorage.removeItem(DRIVE_HISTORY_KEY);
    TestBed.configureTestingModule({
      providers: [KioskDispenseService, VmcSerialTransport],
    });
    svc = TestBed.inject(KioskDispenseService);
  });

  afterEach(async () => {
    const serial = TestBed.inject(VmcSerialTransport);
    await serial.close();
    localStorage.removeItem(DRIVE_HISTORY_KEY);
  });

  it('loopback-sim: drive selection → DISPENSED ok', async () => {
    // Paksa mode via spy pada resolve lewat environment sudah auto→loopback di browser
    const outcome = await firstValueFrom(
      svc.run({
        order_code: 'TEST-1',
        slot_code: '013',
        heat_requested: true,
      })
    );

    expect(outcome.ok).toBeTrue();
    if (outcome.ok) {
      expect(outcome.mode).toBe('loopback-sim');
      expect(outcome.detail.toLowerCase()).toContain('lunch');
    }
  }, 15000);

  it('loopback-sim: checkSlotReady OK sebelum bayar', async () => {
    const check = await svc.checkSlotReady('004');
    expect(check.ok).toBeTrue();
    expect(check.mode).toBe('loopback-sim');
    expect(check.trace?.result).toBe(0x01);
    expect(check.trace?.selectionNumber).toBe(4);
    expect(check.trace?.replyHex).toContain('FA FB 02');
    expect(check.trace?.sentHex).toContain('FA FB 01');
    expect(check.trace?.ackHex).toBe('FA FB 42 00 43');
  }, 10000);

  it('menyimpan snapshot 0x06 terakhir dengan elevator=0 saat tanpa heat', async () => {
    expect(svc.getLastDriveCommand()).toBeNull();

    const outcome = await firstValueFrom(
      svc.run({ order_code: 'TEST-COLD', slot_code: '013', heat_requested: false })
    );
    expect(outcome.ok).toBeTrue();

    const drive = svc.getLastDriveCommand();
    expect(drive).toBeTruthy();
    expect(drive!.slotCode).toBe('013');
    expect(drive!.heat).toBeFalse();
    expect(drive!.elevator).toBe(0);
    expect(drive!.hex).toBe('FA FB 06 05 01 01 00 00 0D 0F');
    expect(drive!.ok).toBeTrue();
    expect(drive!.statusLabel).toBeTruthy();
  }, 15000);

  it('snapshot 0x06 memakai elevator=1 saat heat', async () => {
    await firstValueFrom(
      svc.run({ order_code: 'TEST-HOT', slot_code: '013', heat_requested: true })
    );
    const drive = svc.getLastDriveCommand();
    expect(drive!.heat).toBeTrue();
    expect(drive!.elevator).toBe(1);
  }, 15000);

  it('menyimpan 20 perintah 0x06 terakhir dan memulihkannya setelah dimuat ulang', async () => {
    await firstValueFrom(
      svc.run({ order_code: 'TEST-COLD', slot_code: '013', heat_requested: false })
    );
    await firstValueFrom(
      svc.run({ order_code: 'TEST-HOT', slot_code: '014', heat_requested: true })
    );

    const history = svc.getDriveHistory();
    expect(history.length).toBe(2);
    expect(history[0].slotCode).toBe('014');
    expect(history[0].elevator).toBe(1);
    expect(history[0].ok).toBeTrue();
    expect(history[1].elevator).toBe(0);

    const serial = TestBed.inject(VmcSerialTransport);
    await serial.close();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [KioskDispenseService, VmcSerialTransport],
    });
    const again = TestBed.inject(KioskDispenseService);
    expect(again.getDriveHistory().map((d) => d.slotCode)).toEqual(['014', '013']);
    expect(again.getLastDriveCommand()?.elevator).toBe(1);
    await TestBed.inject(VmcSerialTransport).close();
  }, 20000);

  it('probe 0x53 melaporkan hex balasan dan tidak meninggalkan command antre', async () => {
    const probe = await svc.requestMachineStatus();

    expect(probe.mode).toBe('loopback-sim');
    expect(probe.sentHex).toBe('FA FB 53 01 01 52');
    expect(probe.ok).toBeTrue();
    expect(probe.replies.length).toBeGreaterThan(0);
    expect(probe.replies[0].hex).toBe('FA FB 42 00 43');

    expect(TestBed.inject(VmcSerialTransport).hasQueuedCommand()).toBeFalse();
  }, 15000);

  describe('slot jammed (0x70 · 0x32)', () => {
    /** Simulator dibuat service saat serial pertama kali disiapkan. */
    const simulator = () =>
      (svc as unknown as { simulator: VmcLoopbackSimulator | null }).simulator!;

    it('cek jammed: kirim 0x70 tanya, terima ACK + 0x71, lalu ACK balasan', async () => {
      const serial = TestBed.inject(VmcSerialTransport);
      // Tanpa auto-ACK POLL, satu-satunya ACK yang terkirim adalah ACK untuk 0x71.
      await serial.open({ forceLoopback: true, autoAckPoll: false });
      const sent: string[] = [];
      const txSub = serial.tx$.subscribe((b) => sent.push(bytesToHex(b)));

      const report = await svc.queryJammedSelections();
      txSub.unsubscribe();

      expect(report.ok).toBeTrue();
      expect(report.mode).toBe('loopback-sim');
      expect(report.jammed).toEqual([]);
      expect(report.detail).toContain('tidak ada slot jammed');
      expect(report.steps.length).toBe(1);
      expect(report.steps[0].sentHex).toMatch(/^FA FB 70 03 [0-9A-F]{2} 32 00/);
      expect(report.steps[0].ackHex).toBe('FA FB 42 00 43');
      expect(report.steps[0].replyHex).toContain('FA FB 71');

      expect(sent).toEqual([report.steps[0].sentHex, 'FA FB 42 00 43']);
      expect(serial.hasQueuedCommand()).toBeFalse();
    }, 15000);

    it('bersihkan jammed: cek → clear → cek ulang, daftar jadi kosong', async () => {
      await svc.queryJammedSelections();
      simulator().jammedSelections = [1, 21];

      const report = await svc.clearJammedSelections();

      expect(report.ok).toBeTrue();
      expect(report.steps.map((s) => s.operation)).toEqual(['query', 'clear', 'query']);
      expect(report.steps[1].sentHex).toMatch(/^FA FB 70 03 [0-9A-F]{2} 32 01/);
      expect(report.detail).toContain('Clear berhasil');
      expect(report.detail).toContain('001, 021');
      expect(report.jammed).toEqual([]);
      expect(simulator().jammedSelections).toEqual([]);
    }, 15000);

    it('cek jammed melaporkan slot yang macet', async () => {
      await svc.queryJammedSelections();
      simulator().jammedSelections = [13];

      const report = await svc.queryJammedSelections();

      expect(report.ok).toBeTrue();
      expect(report.jammed).toEqual(['013']);
      expect(report.detail).toContain('1 slot jammed: 013');
    }, 15000);
  });
});
