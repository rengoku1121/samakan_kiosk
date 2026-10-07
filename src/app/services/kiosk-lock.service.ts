import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type KioskLockStatus = {
  lockTaskPermitted: boolean;
  lockTaskActive: boolean;
  lockPaused: boolean;
  isDefaultHome: boolean;
};

type KioskLockPlugin = {
  getStatus(): Promise<KioskLockStatus>;
  setLockTask(options: { enabled: boolean }): Promise<KioskLockStatus>;
  applyImmersive(): Promise<void>;
  openSettings(): Promise<void>;
  exitApp(): Promise<void>;
};

const KioskLock = registerPlugin<KioskLockPlugin>('KioskLock');

const unlocked: KioskLockStatus = {
  lockTaskPermitted: false,
  lockTaskActive: false,
  lockPaused: false,
  isDefaultHome: false,
};

/**
 * Jembatan ke penguncian panel Android (immersive + lock task).
 * Di browser semua metode tidak melakukan apa-apa.
 */
@Injectable({ providedIn: 'root' })
export class KioskLockService {
  private get available(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async getStatus(): Promise<KioskLockStatus> {
    if (!this.available) return { ...unlocked };
    try {
      return { ...unlocked, ...(await KioskLock.getStatus()) };
    } catch {
      return { ...unlocked };
    }
  }

  /** Lepas kunci sementara agar teknisi bisa membuka Settings panel. */
  async setLockTask(enabled: boolean): Promise<KioskLockStatus> {
    if (!this.available) return { ...unlocked };
    try {
      return { ...unlocked, ...(await KioskLock.setLockTask({ enabled })) };
    } catch {
      return this.getStatus();
    }
  }

  async applyImmersive(): Promise<void> {
    if (!this.available) return;
    try {
      await KioskLock.applyImmersive();
    } catch {
      /* panel lama tanpa dukungan immersive */
    }
  }

  async openSettings(): Promise<void> {
    if (!this.available) return;
    await KioskLock.openSettings();
  }

  async exitApp(): Promise<void> {
    if (!this.available) return;
    await KioskLock.exitApp();
  }
}
