import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { dispenseLog } from './services/dispense-log';
import { KioskHealthService } from './services/kiosk-health.service';
import { KioskIdleService } from './services/kiosk-idle.service';
import { KioskPaymentService } from './services/kiosk-payment.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(
    private readonly router: Router,
    private readonly idle: KioskIdleService,
    private readonly health: KioskHealthService,
    private readonly payment: KioskPaymentService
  ) {}

  ngOnInit(): void {
    this.health.start();
    this.resumePaidSession();
    this.idle.start();
  }

  /**
   * Aplikasi mati setelah pelanggan bayar (crash / listrik padam). Uang sudah
   * masuk, jadi kiosk harus kembali ke layar dispense, bukan ke beranda.
   */
  private resumePaidSession(): void {
    const current = this.payment.get();
    const queued = current ? this.health.peekDispenseOutcome(current.order_code) : null;
    if (queued) {
      dispenseLog('warn', 'hasil VMC di disk setelah restart — skip motor', {
        order_code: queued.order_code,
        status: queued.status,
      });
      void this.health.flushQueue();
      void this.router.navigateByUrl(queued.status === 'DISPENSED' ? '/success' : '/dispense');
      return;
    }

    const session = this.payment.resumable;
    if (!session) return;
    dispenseLog('warn', 'sesi PAID dipulihkan setelah restart', {
      order_code: session.order_code,
      slot_code: session.slot_code,
      status: session.status,
    });
    void this.router.navigateByUrl('/dispense');
  }
}
