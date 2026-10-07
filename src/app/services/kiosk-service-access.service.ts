import { Injectable } from '@angular/core';

/**
 * Izin sekali pakai untuk membuka /service.
 * Beranda memberi izin setelah password benar; halaman servis memakainya
 * saat masuk. Tanpa izin, membuka /service langsung dikembalikan ke beranda.
 */
@Injectable({ providedIn: 'root' })
export class KioskServiceAccess {
  private allowed = false;

  allowOnce(): void {
    this.allowed = true;
  }

  /** true hanya untuk satu kali masuk berikutnya. */
  take(): boolean {
    const ok = this.allowed;
    this.allowed = false;
    return ok;
  }
}
