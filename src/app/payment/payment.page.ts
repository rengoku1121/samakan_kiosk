import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { CatalogSelection, wantsHeat } from '../catalog/catalog.models';
import { KioskApiService } from '../services/kiosk-api.service';
import { KioskPaymentService, PaymentSession } from '../services/kiosk-payment.service';
import { KioskSelectionService } from '../services/kiosk-selection.service';
import { publicErrorMessage } from '../services/public-error';

/**
 * Uang sudah masuk dan barang boleh dikeluarkan.
 * PAID_STOCK_FAILED sengaja tidak masuk: stok gagal dipotong berarti data slot
 * tidak dapat dipercaya, jadi jangan jalankan motor — arahkan ke petugas.
 */
const PAID_STATUSES = new Set(['PAID', 'PAID_ITEM_MISSING', 'DISPENSED']);

/** Sudah dibayar tapi tidak boleh dispense otomatis. */
const PAID_NEEDS_STAFF = new Set(['PAID_STOCK_FAILED']);

@Component({
  selector: 'app-payment',
  templateUrl: 'payment.page.html',
  styleUrls: ['payment.page.scss'],
  standalone: false,
})
export class PaymentPage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  readonly brand = 'samakan';

  session: PaymentSession | null = null;
  loading = true;
  error = '';
  remainingSec = 0;
  qrBroken = false;

  private selection: CatalogSelection | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private orderSub?: Subscription;
  private statusSub?: Subscription;
  private cancelSub?: Subscription;
  private navigatingSuccess = false;
  cancelling = false;

  constructor(
    private readonly router: Router,
    private readonly selectionSvc: KioskSelectionService,
    private readonly paymentSvc: KioskPaymentService,
    private readonly kioskApi: KioskApiService
  ) {}

  ionViewWillEnter(): void {
    this.stopTick();
    this.stopPoll();
    this.orderSub?.unsubscribe();
    this.statusSub?.unsubscribe();
    this.cancelSub?.unsubscribe();
    this.error = '';
    this.loading = true;
    this.session = null;
    this.qrBroken = false;
    this.navigatingSuccess = false;
    this.cancelling = false;

    this.selection = this.selectionSvc.get();
    if (
      !this.selection ||
      this.selection.heat_requested === null ||
      this.selection.heat_requested === undefined
    ) {
      this.loading = false;
      void this.router.navigateByUrl('/confirm');
      return;
    }

    this.createOrder();
  }

  ionViewWillLeave(): void {
    this.stopTick();
    this.stopPoll();
    this.orderSub?.unsubscribe();
    this.statusSub?.unsubscribe();
    this.cancelSub?.unsubscribe();
  }

  ngOnDestroy(): void {
    this.stopTick();
    this.stopPoll();
    this.orderSub?.unsubscribe();
    this.statusSub?.unsubscribe();
    this.cancelSub?.unsubscribe();
  }

  get heatLabel(): string {
    if (!this.session) return '';
    return this.session.heat_requested ? 'Dipanaskan' : 'Tidak dipanaskan';
  }

  get isExpired(): boolean {
    return this.session?.status === 'EXPIRED' || this.remainingSec <= 0;
  }

  priceFmt(n: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(n);
  }

  timerFmt(sec: number): string {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  retry(): void {
    this.error = '';
    this.loading = true;
    this.session = null;
    this.qrBroken = false;
    this.createOrder();
  }

  cancel(): void {
    if (this.navigatingSuccess || this.cancelling) return;
    this.stopPoll();
    this.stopTick();
    this.orderSub?.unsubscribe();

    const code = this.session?.order_code;
    if (!code) {
      this.goCatalog();
      return;
    }

    this.cancelling = true;
    this.cancelSub?.unsubscribe();
    this.cancelSub = this.kioskApi.cancelOrder(code).subscribe({
      next: (res) => {
        const status = String(res.status || '').toUpperCase();
        if (PAID_STATUSES.has(status)) {
          this.cancelling = false;
          this.goSuccess();
          return;
        }
        if (PAID_NEEDS_STAFF.has(status)) {
          this.cancelling = false;
          this.paymentSvc.markPaid();
          this.session = this.paymentSvc.get();
          this.error =
            'Pembayaran diterima, tetapi stok slot tidak sinkron. Hubungi petugas dengan kode order ' +
            code +
            '.';
          return;
        }
        this.goCatalog();
      },
      error: () => {
        this.goCatalog();
      },
    });
  }

  private goCatalog(): void {
    this.cancelling = false;
    this.paymentSvc.markCancelled();
    this.paymentSvc.clear();
    void this.router.navigateByUrl('/catalog');
  }

  onQrError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;
    this.qrBroken = true;
    img.style.visibility = 'hidden';
  }

  private createOrder(): void {
    if (!this.selection) return;

    this.stopPoll();
    this.orderSub?.unsubscribe();
    this.orderSub = this.kioskApi
      .createOrder({
        slot_code: this.selection.slot_code,
        qty: 1,
        heat_requested: wantsHeat(this.selection.heat_requested),
      })
      .subscribe({
        next: (order) => {
          this.session = this.paymentSvc.setFromOrder(this.selection!, order);
          this.loading = false;
          this.startTick();
          this.startPoll();
        },
        error: (err: unknown) => {
          this.loading = false;
          this.session = null;
          this.error = publicErrorMessage(err, 'Gagal membuat QRIS. Coba lagi.');
        },
      });
  }

  private startTick(): void {
    this.updateRemaining();
    this.tickTimer = setInterval(() => this.updateRemaining(), 1000);
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private startPoll(): void {
    this.stopPoll();
    this.pollStatusOnce();
    this.pollTimer = setInterval(() => this.pollStatusOnce(), 2500);
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.statusSub?.unsubscribe();
  }

  private pollStatusOnce(): void {
    if (!this.session || this.navigatingSuccess) return;
    const local = this.session.status;
    if (local !== 'PENDING' && local !== 'EXPIRED' && local !== 'CANCELLED') {
      return;
    }

    const code = this.session.order_code;
    this.statusSub?.unsubscribe();
    this.statusSub = this.kioskApi.getOrderStatus(code).subscribe({
      next: (st) => {
        if (!this.session || this.session.order_code !== code) return;
        const status = String(st.status || '').toUpperCase();
        if (PAID_STATUSES.has(status)) {
          this.goSuccess();
          return;
        }
        if (PAID_NEEDS_STAFF.has(status)) {
          this.paymentSvc.markPaid();
          this.session = this.paymentSvc.get();
          this.stopPoll();
          this.stopTick();
          this.error =
            'Pembayaran diterima, tetapi stok slot tidak sinkron. Hubungi petugas dengan kode order ' +
            code +
            '.';
          return;
        }
        if (status === 'EXPIRED' || status === 'CANCELLED' || status === 'FAILED') {
          if (status === 'EXPIRED') this.paymentSvc.markExpired();
          else this.paymentSvc.markCancelled();
          this.session = this.paymentSvc.get();
          // Tetap poll: settlement telat bisa jadi PAID setelah Core expire.
        }
      },
      error: () => {
        /* ignore transient poll errors */
      },
    });
  }

  private goSuccess(): void {
    if (this.navigatingSuccess) return;
    this.navigatingSuccess = true;
    this.paymentSvc.markPaid();
    this.session = this.paymentSvc.get();
    this.stopPoll();
    this.stopTick();
    void this.router.navigateByUrl('/dispense');
  }

  private updateRemaining(): void {
    if (!this.session) return;
    const end = new Date(this.session.expires_at).getTime();
    const sec = Math.floor((end - Date.now()) / 1000);
    this.remainingSec = sec;
    if (sec <= 0 && this.session.status === 'PENDING') {
      this.paymentSvc.markExpired();
      this.session = this.paymentSvc.get();
      this.stopTick();
    }
  }
}
