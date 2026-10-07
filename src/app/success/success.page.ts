import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { KioskPaymentService, PaymentSession } from '../services/kiosk-payment.service';
import { KioskSelectionService } from '../services/kiosk-selection.service';

@Component({
  selector: 'app-success',
  templateUrl: 'success.page.html',
  styleUrls: ['success.page.scss'],
  standalone: false,
})
export class SuccessPage implements ViewWillEnter, ViewWillLeave {
  readonly brand = 'samakan';
  session: PaymentSession | null = null;
  private homeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly router: Router,
    private readonly paymentSvc: KioskPaymentService,
    private readonly selectionSvc: KioskSelectionService
  ) {}

  ionViewWillEnter(): void {
    this.clearHomeTimer();
    this.session = this.paymentSvc.get();
    if (!this.session || this.session.status !== 'DISPENSED') {
      void this.router.navigateByUrl('/home');
      return;
    }
    // Lebih lama agar pelanggan sempat ambil produk sebelum layar beranda
    this.homeTimer = setTimeout(() => this.done(), 20000);
  }

  ionViewWillLeave(): void {
    this.clearHomeTimer();
  }

  priceFmt(n: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(n);
  }

  done(): void {
    this.clearHomeTimer();
    this.paymentSvc.clear();
    this.selectionSvc.clear();
    void this.router.navigateByUrl('/home');
  }

  private clearHomeTimer(): void {
    if (this.homeTimer) {
      clearTimeout(this.homeTimer);
      this.homeTimer = null;
    }
  }
}
