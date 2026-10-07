import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { KioskApiService } from './kiosk-api.service';
import { DISPENSE_QUEUE_KEY, KioskHealthService } from './kiosk-health.service';

describe('KioskHealthService', () => {
  let api: { reportDispenseResult: jasmine.Spy };

  beforeEach(() => {
    localStorage.clear();
    api = {
      reportDispenseResult: jasmine.createSpy('reportDispenseResult'),
    };
    TestBed.configureTestingModule({
      providers: [
        KioskHealthService,
        { provide: KioskApiService, useValue: { ...api, sendHeartbeat: () => of(true), reportCrash: () => of(true) } },
      ],
    });
  });

  function svc(): KioskHealthService {
    return TestBed.inject(KioskHealthService);
  }

  it('menyimpan hasil VMC ke disk sebelum HTTP', () => {
    const health = svc();
    health.recordDispenseOutcome('KIOSK-1', 'DISPENSED', 'ok');
    const peeked = health.peekDispenseOutcome('KIOSK-1');
    expect(peeked?.status).toBe('DISPENSED');
    expect(peeked?.detail).toBe('ok');
    const raw = JSON.parse(localStorage.getItem(DISPENSE_QUEUE_KEY) || '[]');
    expect(raw[0].order_code).toBe('KIOSK-1');
  });

  it('acknowledge menghapus antrean setelah Core ACK', () => {
    const health = svc();
    health.recordDispenseOutcome('KIOSK-1', 'DISPENSE_FAILED', 'jam');
    health.acknowledgeDispenseOutcome('KIOSK-1');
    expect(health.peekDispenseOutcome('KIOSK-1')).toBeNull();
    expect(localStorage.getItem(DISPENSE_QUEUE_KEY)).toBeNull();
  });

  it('flush mengirim antrean lalu mengosongkan jika sukses', async () => {
    api.reportDispenseResult.and.returnValue(of({ order_code: 'KIOSK-1', status: 'DISPENSED' }));
    const health = svc();
    health.recordDispenseOutcome('KIOSK-1', 'DISPENSED', null);
    await health.flushQueue();
    expect(api.reportDispenseResult).toHaveBeenCalled();
    expect(health.peekDispenseOutcome('KIOSK-1')).toBeNull();
  });

  it('flush menahan antrean jika HTTP gagal', async () => {
    api.reportDispenseResult.and.returnValue(throwError(() => new Error('offline')));
    const health = svc();
    health.recordDispenseOutcome('KIOSK-1', 'DISPENSED', null);
    await health.flushQueue();
    expect(health.peekDispenseOutcome('KIOSK-1')?.status).toBe('DISPENSED');
  });

  it('antrean tetap ada setelah service baru (reconnect / restart)', async () => {
    svc().recordDispenseOutcome('KIOSK-9', 'DISPENSE_FAILED', 'uart-timeout');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        KioskHealthService,
        { provide: KioskApiService, useValue: { ...api, sendHeartbeat: () => of(true), reportCrash: () => of(true) } },
      ],
    });
    expect(svc().peekDispenseOutcome('KIOSK-9')?.detail).toBe('uart-timeout');
  });
});
