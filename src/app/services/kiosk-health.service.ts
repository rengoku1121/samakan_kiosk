import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { dispenseLog } from './dispense-log';
import { DispenseResultStatus, KioskApiService } from './kiosk-api.service';

type HealthEnv = {
  heartbeatMs?: number;
};

export type PendingReport = {
  order_code: string;
  status: DispenseResultStatus;
  detail: string | null;
  queued_at: number;
  attempts: number;
};

export const DISPENSE_QUEUE_KEY = 'samakan.kiosk.pending-dispense';
const MAX_QUEUE = 20;
/** Setelah sehari, hasil dispense sudah tidak berguna untuk rekonsiliasi otomatis. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Flush antrean lebih cepat dari heartbeat — jaringan sering singkat hidup. */
const FLUSH_MS = 15_000;

/**
 * Denyut nadi mesin ke Core: heartbeat berkala, laporan crash, dan antrean
 * hasil dispense yang gagal terkirim (jaringan putus / server restart).
 */
@Injectable({ providedIn: 'root' })
export class KioskHealthService implements OnDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private flushing = false;
  private lastCrashAt = 0;

  constructor(
    private readonly api: KioskApiService,
    private readonly zone: NgZone
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    const cfg = ((environment as { health?: HealthEnv }).health || {}) as HealthEnv;
    const intervalMs = Math.max(30_000, cfg.heartbeatMs ?? 60_000);

    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.tick(), intervalMs);
      this.flushTimer = setInterval(() => void this.flushQueue(), FLUSH_MS);
    });
    void this.tick();

    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onRejection);
    window.addEventListener('online', this.onOnline);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.timer = null;
    this.flushTimer = null;
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    window.removeEventListener('online', this.onOnline);
  }

  /**
   * Tulis hasil VMC ke disk sekarang, sebelum / meskipun HTTP ke Core.
   * Restart tidak boleh menjalankan motor lagi untuk order ini.
   */
  recordDispenseOutcome(
    orderCode: string,
    status: DispenseResultStatus,
    detail?: string | null
  ): void {
    const code = String(orderCode || '').trim();
    if (!code) return;

    const existing = this.peekDispenseOutcome(code);
    const queued_at = existing?.queued_at || Date.now();
    const queue = this.readQueue().filter((r) => r.order_code !== code);
    queue.push({
      order_code: code,
      status,
      detail: detail ? String(detail).slice(0, 255) : null,
      queued_at,
      attempts: existing?.attempts || 0,
    });
    this.writeQueue(queue.slice(-MAX_QUEUE));
    dispenseLog('info', 'hasil VMC disimpan ke disk', { code, status });
  }

  /** Alias: laporan HTTP gagal — item sudah harus ada di disk dari recordDispenseOutcome. */
  queueDispenseResult(
    orderCode: string,
    status: DispenseResultStatus,
    detail?: string | null
  ): void {
    this.recordDispenseOutcome(orderCode, status, detail);
  }

  peekDispenseOutcome(orderCode: string): PendingReport | null {
    const code = String(orderCode || '').trim();
    if (!code) return null;
    return this.readQueue().find((r) => r.order_code === code) || null;
  }

  /** Core sudah ACK — hapus dari antrean. */
  acknowledgeDispenseOutcome(orderCode: string): void {
    const code = String(orderCode || '').trim();
    if (!code) return;
    this.writeQueue(this.readQueue().filter((r) => r.order_code !== code));
  }

  get pendingCount(): number {
    return this.readQueue().length;
  }

  async tick(): Promise<void> {
    await this.sendHeartbeat();
    await this.flushQueue();
  }

  async reportCrash(source: string, message: string): Promise<void> {
    // Loop error bisa membanjiri Core; cukup satu laporan per menit.
    if (Date.now() - this.lastCrashAt < 60_000) return;
    this.lastCrashAt = Date.now();
    try {
      await firstValueFrom(this.api.reportCrash(source, message));
    } catch {
      /* offline — logcat tetap punya jejaknya */
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      await firstValueFrom(this.api.sendHeartbeat(environment.appVersion));
    } catch {
      /* mesin offline sementara; percobaan berikutnya ikut interval */
    }
  }

  async flushQueue(): Promise<void> {
    if (this.flushing) return;
    const queue = this.readQueue();
    if (!queue.length) return;

    this.flushing = true;
    const keep: PendingReport[] = [];
    try {
      for (const item of queue) {
        if (Date.now() - item.queued_at > MAX_AGE_MS) {
          dispenseLog('warn', 'dispense-result kedaluwarsa, dibuang', item);
          continue;
        }
        try {
          await firstValueFrom(
            this.api.reportDispenseResult(item.order_code, item.status, item.detail)
          );
          dispenseLog('info', 'dispense-result tertunda berhasil dikirim', {
            order_code: item.order_code,
          });
        } catch {
          keep.push({ ...item, attempts: item.attempts + 1 });
        }
      }
      this.writeQueue(keep);
    } finally {
      this.flushing = false;
    }
  }

  private readQueue(): PendingReport[] {
    try {
      const raw = localStorage.getItem(DISPENSE_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PendingReport[]) : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: PendingReport[]): void {
    try {
      if (!queue.length) localStorage.removeItem(DISPENSE_QUEUE_KEY);
      else localStorage.setItem(DISPENSE_QUEUE_KEY, JSON.stringify(queue));
    } catch {
      /* abaikan */
    }
  }

  private readonly onOnline = (): void => {
    void this.flushQueue();
  };

  private readonly onWindowError = (ev: ErrorEvent): void => {
    void this.reportCrash('webview', `${ev.message} @ ${ev.filename}:${ev.lineno}`);
  };

  private readonly onRejection = (ev: PromiseRejectionEvent): void => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    void this.reportCrash('webview-promise', reason);
  };
}
