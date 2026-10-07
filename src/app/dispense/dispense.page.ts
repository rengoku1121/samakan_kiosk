import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { Subscription, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { wantsHeat } from '../catalog/catalog.models';
import { KioskApiService } from '../services/kiosk-api.service';
import { dispenseLog } from '../services/dispense-log';
import {
  DispenseProgress,
  KioskDispenseService,
} from '../services/kiosk-dispense.service';
import { KioskHealthService } from '../services/kiosk-health.service';
import { KioskPaymentService, PaymentSession } from '../services/kiosk-payment.service';
import { KioskSelectionService } from '../services/kiosk-selection.service';
import { publicDispenseFailureMessage, publicErrorMessage } from '../services/public-error';

type Phase = 'running' | 'failed' | 'report_error';

@Component({
  selector: 'app-dispense',
  templateUrl: 'dispense.page.html',
  styleUrls: ['dispense.page.scss'],
  standalone: false,
})
export class DispensePage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  readonly brand = 'samakan';

  session: PaymentSession | null = null;
  phase: Phase = 'running';
  stepLabel = 'Menyiapkan mesin…';
  /** Phase progress dari VMC service. */
  uiPhase: DispenseProgress['phase'] = 'busy';
  error = '';

  private sub?: Subscription;
  private progressSub?: Subscription;
  private inFlight = false;

  constructor(
    private readonly router: Router,
    private readonly paymentSvc: KioskPaymentService,
    private readonly selectionSvc: KioskSelectionService,
    private readonly dispenseSvc: KioskDispenseService,
    private readonly kioskApi: KioskApiService,
    private readonly health: KioskHealthService
  ) {}

  ionViewWillEnter(): void {
    this.session = this.paymentSvc.get();
    this.error = '';

    if (!this.session) {
      void this.router.navigateByUrl('/home');
      return;
    }

    if (this.applyLocalOutcomeIfAny()) return;

    if (this.session.status === 'DISPENSED') {
      void this.health.flushQueue();
      void this.router.navigateByUrl('/success');
      return;
    }

    if (this.session.status === 'DISPENSE_FAILED') {
      void this.health.flushQueue();
      this.phase = 'failed';
      this.error = publicDispenseFailureMessage(this.session.dispense_detail);
      return;
    }

    if (this.session.status !== 'PAID' && this.session.status !== 'DISPENSING') {
      void this.router.navigateByUrl('/home');
      return;
    }

    if (this.inFlight) {
      this.phase = 'running';
      return;
    }

    this.phase = 'running';
    this.stepLabel = 'Menyiapkan mesin…';
    this.uiPhase = 'busy';
    this.beginDispense();
  }

  ionViewWillLeave(): void {
    /* biarkan in-flight selesai */
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.progressSub?.unsubscribe();
    this.sub = undefined;
    this.progressSub = undefined;
    this.inFlight = false;
  }

  get heatLabel(): string {
    if (!this.session) return '';
    return this.session.heat_requested ? 'Dipanaskan' : 'Tidak dipanaskan';
  }

  done(): void {
    this.paymentSvc.clear();
    this.selectionSvc.clear();
    this.inFlight = false;
    void this.router.navigateByUrl('/home');
  }

  /** Hasil VMC sudah di disk: jangan jalankan motor lagi, hanya laporkan ke Core. */
  private applyLocalOutcomeIfAny(): boolean {
    if (!this.session) return false;
    const queued = this.health.peekDispenseOutcome(this.session.order_code);
    if (!queued) return false;

    dispenseLog('warn', 'hasil VMC sudah di disk — skip motor', {
      order_code: queued.order_code,
      status: queued.status,
    });
    void this.health.flushQueue();

    if (queued.status === 'DISPENSED') {
      this.paymentSvc.markDispensed(queued.detail);
      this.session = this.paymentSvc.get();
      void this.router.navigateByUrl('/success');
      return true;
    }

    this.paymentSvc.markDispenseFailed(queued.detail);
    this.session = this.paymentSvc.get();
    this.phase = 'failed';
    this.error = publicDispenseFailureMessage(queued.detail);
    return true;
  }

  private persistVmcOutcome(
    orderCode: string,
    status: 'DISPENSED' | 'DISPENSE_FAILED',
    detail?: string | null
  ): void {
    this.health.recordDispenseOutcome(orderCode, status, detail);
    if (status === 'DISPENSED') this.paymentSvc.markDispensed(detail);
    else this.paymentSvc.markDispenseFailed(detail);
    this.session = this.paymentSvc.get();
  }

  private beginDispense(): void {
    if (!this.session || this.inFlight) return;
    this.inFlight = true;

    this.paymentSvc.markDispensing();
    this.session = this.paymentSvc.get();

    this.progressSub?.unsubscribe();
    this.progressSub = this.dispenseSvc.progress$.subscribe((p) => {
      dispenseLog('info', `progress: ${p.message}`, {
        phase: p.phase,
        heatingRemainingSec: p.heatingRemainingSec,
      });
      if (this.phase !== 'running') return;
      // Setelah produk siap, jangan timpa layar lagi (status pintu VMC berulang).
      if (this.uiPhase === 'pickup') return;
      this.stepLabel = p.message;
      this.uiPhase = p.phase;
    });

    const orderCode = this.session!.order_code;
    const slot = this.session!.slot_code;
    const heat = wantsHeat(this.session!.heat_requested);

    dispenseLog('info', 'beginDispense', {
      order_code: orderCode,
      slot_code: slot,
      heat_requested: heat,
      session_status: this.session!.status,
    });

    this.sub?.unsubscribe();
    this.sub = this.dispenseSvc
      .run({
        order_code: orderCode,
        slot_code: slot,
        heat_requested: heat,
      })
      .pipe(
        switchMap((outcome) => {
          dispenseLog(outcome.ok ? 'info' : 'error', 'VMC outcome', {
            ok: outcome.ok,
            mode: outcome.mode,
            detail: outcome.detail,
          });
          const apiStatus = outcome.ok ? ('DISPENSED' as const) : ('DISPENSE_FAILED' as const);
          this.persistVmcOutcome(orderCode, apiStatus, outcome.detail);
          dispenseLog('info', `POST dispense-result status=${apiStatus}`);
          return this.kioskApi.reportDispenseResult(orderCode, apiStatus, outcome.detail).pipe(
            switchMap((res) => {
              dispenseLog('info', 'dispense-result OK', res);
              this.health.acknowledgeDispenseOutcome(orderCode);
              if (outcome.ok) {
                return of({ kind: 'ok' as const, detail: outcome.detail, res });
              }
              return of({ kind: 'failed' as const, detail: outcome.detail, res });
            }),
            catchError((err: Error) => {
              dispenseLog('error', 'dispense-result HTTP gagal', err?.message || err);
              return of({
                kind: 'report_error' as const,
                ok: outcome.ok,
                detail: outcome.detail,
                message: err?.message || 'Gagal kirim hasil dispense',
              });
            })
          );
        })
      )
      .subscribe({
        next: (result) => {
          this.inFlight = false;
          if (result.kind === 'ok') {
            dispenseLog('info', 'UI → /success');
            void this.router.navigateByUrl('/success');
            return;
          }

          if (result.kind === 'failed') {
            dispenseLog('error', 'UI phase=failed', result.detail);
            this.phase = 'failed';
            this.error = publicDispenseFailureMessage(result.detail);
            return;
          }

          if (result.kind === 'report_error') {
            dispenseLog('error', 'UI phase=report_error', result.message);
            if (result.ok) {
              void this.router.navigateByUrl('/success');
              return;
            }
            this.phase = 'report_error';
            this.error = publicErrorMessage(
              new Error(result.message),
              'Konfirmasi ke server tertunda. Hubungi petugas dengan kode order di bawah.'
            );
          }
        },
        error: (err: unknown) => {
          this.inFlight = false;
          const detail = err instanceof Error ? err.message : 'Dispense gagal';
          dispenseLog('error', 'subscribe error', err);
          this.persistVmcOutcome(orderCode, 'DISPENSE_FAILED', detail);
          this.phase = 'failed';
          this.error = publicDispenseFailureMessage(err instanceof Error ? err.message : null);
        },
      });
  }
}
