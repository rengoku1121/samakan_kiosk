import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type KioskNetworkStatus = {
  online: boolean;
  /** Wi-Fi, Ethernet, Seluler, Browser, atau kosong bila belum terbaca. */
  transport: string;
  ssid: string;
  ip: string;
};

type KioskNetPlugin = {
  status(): Promise<KioskNetworkStatus>;
};

const KioskNet = registerPlugin<KioskNetPlugin>('KioskNet');

/**
 * Status jaringan untuk Mode Servis.
 * Di browser hanya online/offline. Nama Wi-Fi dan IP diisi plugin Android.
 */
@Injectable({ providedIn: 'root' })
export class KioskNetworkService {
  async read(): Promise<KioskNetworkStatus> {
    const browser: KioskNetworkStatus = {
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      transport: 'Browser',
      ssid: '',
      ip: '',
    };
    if (Capacitor.getPlatform() !== 'android') return browser;
    try {
      const native = await KioskNet.status();
      return {
        online: native.online === true,
        transport: String(native.transport || ''),
        ssid: String(native.ssid || ''),
        ip: String(native.ip || ''),
      };
    } catch {
      return { ...browser, transport: '' };
    }
  }
}
