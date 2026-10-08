import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Subscription, fromEvent, merge } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { KioskSelectionService } from './kiosk-selection.service';

type ScreensaverEnv = {
  enabled?: boolean;
  idleMs?: number;
};

/**
 * Attract-mode kiosk: idle → screensaver. Tidak aktif di payment/dispense.
 * Dismiss hanya lewat overlay (bukan pointerdown dokumen) supaya klik tidak
 * tembus ke tombol “Mulai Pesan”.
 */
@Injectable({ providedIn: 'root' })
export class KioskIdleService implements OnDestroy {
  readonly active$ = new BehaviorSubject<boolean>(false);

  private readonly idleMs: number;
  private readonly enabled: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subs: Subscription[] = [];
  private ignoreNav = false;
  private started = false;

  constructor(
    private readonly router: Router,
    private readonly zone: NgZone,
    private readonly selection: KioskSelectionService
  ) {
    const cfg = ((environment as { screensaver?: ScreensaverEnv }).screensaver || {}) as ScreensaverEnv;
    this.enabled = cfg.enabled !== false;
    this.idleMs = Math.max(1_000, cfg.idleMs ?? 30_000);
  }

  get isActive(): boolean {
    return this.active$.value;
  }

  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;

    this.zone.runOutsideAngular(() => {
      const activity$ = merge(
        fromEvent(document, 'pointerdown', { capture: true }),
        fromEvent(document, 'touchstart', { capture: true, passive: true }),
        fromEvent(document, 'keydown', { capture: true })
      );
      this.subs.push(
        activity$.subscribe(() => {
          if (this.active$.value) return;
          this.zone.run(() => this.arm());
        })
      );
    });

    this.subs.push(
      this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
        if (this.ignoreNav) return;
        if (this.isBusyRoute()) {
          this.hide();
          this.clearTimer();
          return;
        }
        this.arm();
      })
    );

    this.arm();
  }

  show(): void {
    if (!this.enabled || this.active$.value || this.isBusyRoute()) return;
    this.clearTimer();
    this.selection.clear();
    this.active$.next(true);
    if (!this.router.url.startsWith('/home')) {
      this.ignoreNav = true;
      void this.router.navigateByUrl('/home').finally(() => {
        this.ignoreNav = false;
      });
    }
  }

  hide(): void {
    if (!this.active$.value) return;
    this.active$.next(false);
    this.arm();
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];
  }

  private arm(): void {
    this.clearTimer();
    if (!this.enabled || this.active$.value || this.isBusyRoute()) return;
    this.timer = setTimeout(() => {
      this.zone.run(() => this.show());
    }, this.idleMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** QRIS / motor jalan / teknisi bekerja — jangan tutup layar dengan attract. */
  private isBusyRoute(): boolean {
    const url = this.router.url.split('?')[0];
    return url === '/payment' || url === '/dispense' || url === '/service';
  }
}
