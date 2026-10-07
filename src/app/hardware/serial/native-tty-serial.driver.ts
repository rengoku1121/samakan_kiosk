import { Capacitor, registerPlugin } from '@capacitor/core';
import { Observable, Subject } from 'rxjs';
import { dispenseLog } from '../../services/dispense-log';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { NativeTtySerialPlugin } from './native-tty-serial.definitions';
import { SerialDeviceInfo, SerialOpenOptions, SerialPortDriver } from './types';

const NativeTtySerial = registerPlugin<NativeTtySerialPlugin>('NativeTtySerial');

/**
 * Driver UART native Android (/dev/ttyS2, dll.) untuk VMC di XY5186-E.
 */
export class NativeTtySerialDriver implements SerialPortDriver {
  readonly name = 'native-tty-serial';

  private openFlag = false;
  private path = '';
  private readonly rxSubject = new Subject<Uint8Array>();
  readonly rx$: Observable<Uint8Array> = this.rxSubject.asObservable();
  private dataHandle: { remove: () => Promise<void> } | null = null;
  private errorHandle: { remove: () => Promise<void> } | null = null;

  static isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  async listDevices(): Promise<SerialDeviceInfo[]> {
    this.assertAndroid();
    const { devices } = await NativeTtySerial.listDevices();
    return (devices || []).map((d) => ({
      deviceId: d.deviceId,
      productName: d.path,
      driverType: 'ttyS',
      hasPermission: !!(d.canRead && d.canWrite),
      label: d.label || d.path,
    }));
  }

  async open(options: SerialOpenOptions = {}): Promise<void> {
    this.assertAndroid();
    if (this.openFlag) await this.close();

    const path = (options.devicePath || '').trim();
    if (!path) {
      throw new Error('devicePath kosong (set environment.vmc.nativeDevicePath)');
    }

    const baud = options.baudRate ?? 57600;
    dispenseLog('info', 'NativeTty open', { path, baud });

    await NativeTtySerial.open({ path, baudRate: baud, flags: 0 });
    this.path = path;

    this.dataHandle = await NativeTtySerial.addListener('data', (ev) => {
      try {
        const bytes = base64ToBytes(ev.data);
        if (bytes.length) this.rxSubject.next(bytes);
      } catch (err) {
        dispenseLog('error', 'NativeTty decode RX gagal', err);
      }
    });

    this.errorHandle = await NativeTtySerial.addListener('error', (ev) => {
      dispenseLog('error', 'NativeTty plugin error', ev);
    });

    await NativeTtySerial.startReading();
    this.openFlag = true;
    dispenseLog('info', 'NativeTty startReading OK', { path });
  }

  async close(): Promise<void> {
    this.openFlag = false;
    try {
      await NativeTtySerial.stopReading().catch(() => undefined);
    } catch (_) {
      /* ignore */
    }
    try {
      await NativeTtySerial.close().catch(() => undefined);
    } catch (_) {
      /* ignore */
    }
    await this.dataHandle?.remove().catch(() => undefined);
    await this.errorHandle?.remove().catch(() => undefined);
    this.dataHandle = null;
    this.errorHandle = null;
    this.path = '';
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.openFlag) throw new Error('Native tty serial belum open');
    await NativeTtySerial.write({ data: bytesToBase64(bytes) });
  }

  private assertAndroid(): void {
    if (!NativeTtySerialDriver.isNativeAndroid()) {
      throw new Error('Native tty serial hanya di Android');
    }
  }
}
