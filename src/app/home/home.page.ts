import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { KioskConfigService } from '../services/kiosk-config.service';
import { KioskLockService } from '../services/kiosk-lock.service';
import { KioskServiceAccess } from '../services/kiosk-service-access.service';

/** Ketukan beruntun pada kode mesin untuk membuka halaman servis. */
const SERVICE_TAPS = 5;
const SERVICE_TAP_WINDOW_MS = 3000;

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  readonly machineCode: string;
  readonly appVersion = environment.appVersion;
  /** Tombol tutup hanya di build development — APK rilis tidak merender ini. */
  readonly showDevExit = environment.production !== true;
  readonly showVersion = environment.production !== true;

  started = false;
  closing = false;

  gateOpen = false;
  gatePassword = '';
  gateError = false;

  private taps = 0;
  private firstTapAt = 0;

  constructor(
    private readonly router: Router,
    private readonly lockSvc: KioskLockService,
    private readonly config: KioskConfigService,
    private readonly serviceAccess: KioskServiceAccess
  ) {
    this.machineCode = config.machineCode;
  }

  async closeApp(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    try {
      await this.lockSvc.exitApp();
    } catch {
      this.closing = false;
    }
  }

  onStart(): void {
    if (this.started) return;
    this.started = true;
    void this.router.navigateByUrl('/catalog').finally(() => {
      this.started = false;
    });
  }

  /** 5x ketuk kode mesin dalam 3 detik → minta password mode servis. */
  onMachineTap(): void {
    if (this.gateOpen) return;
    const now = Date.now();
    if (now - this.firstTapAt > SERVICE_TAP_WINDOW_MS) {
      this.taps = 0;
      this.firstTapAt = now;
    }
    this.taps += 1;
    if (this.taps >= SERVICE_TAPS) {
      this.taps = 0;
      this.gatePassword = '';
      this.gateError = false;
      this.gateOpen = true;
    }
  }

  submitGate(): void {
    if (!this.config.checkServicePassword(this.gatePassword)) {
      this.gatePassword = '';
      this.gateError = true;
      return;
    }
    this.gateOpen = false;
    this.gatePassword = '';
    this.gateError = false;
    this.serviceAccess.allowOnce();
    void this.router.navigateByUrl('/service');
  }

  cancelGate(): void {
    this.gateOpen = false;
    this.gatePassword = '';
    this.gateError = false;
  }
}
