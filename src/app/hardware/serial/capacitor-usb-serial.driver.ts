import { Capacitor, registerPlugin } from '@capacitor/core';
import { Observable, Subject } from 'rxjs';
import { dispenseLog } from '../../services/dispense-log';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { UsbSerialPlugin } from './capacitor-usb-serial.definitions';
import { SerialDeviceInfo, SerialOpenOptions, SerialPortDriver } from './types';

const UsbSerial = registerPlugin<UsbSerialPlugin>('UsbSerial');

/**
 * Adapter Android USB-serial (@leeskies/capacitor-usb-serial).
 * Web/iOS: open() akan throw — pakai LoopbackSerialDriver di browser.
 */
export class CapacitorUsbSerialDriver implements SerialPortDriver {
  readonly name = 'capacitor-usb-serial';

  private portId: string | null = null;
  private openFlag = false;
  private readonly rxSubject = new Subject<Uint8Array>();
  readonly rx$: Observable<Uint8Array> = this.rxSubject.asObservable();
  private dataHandle: { remove: () => Promise<void> } | null = null;
  private errorHandle: { remove: () => Promise<void> } | null = null;
  private detachedHandle: { remove: () => Promise<void> } | null = null;

  static isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  async listDevices(): Promise<SerialDeviceInfo[]> {
    this.assertAndroid();
    const { devices } = await UsbSerial.listDevices();
    return (devices || []).map((d) => ({
      deviceId: d.deviceId,
      productName: d.productName || d.deviceName,
      manufacturerName: d.manufacturerName,
      driverType: d.driverType,
      hasPermission: d.hasPermission,
      label:
        d.productName ||
        d.deviceName ||
        `${d.driverType || 'USB'} #${d.deviceId}`,
    }));
  }

  async open(options: SerialOpenOptions = {}): Promise<void> {
    this.assertAndroid();
    if (this.openFlag) await this.close();

    const devices = await this.listDevices();
    dispenseLog('info', 'USB listDevices', {
      count: devices.length,
      devices: devices.map((d) => ({
        id: d.deviceId,
        label: d.label,
        driver: d.driverType,
        permission: d.hasPermission,
      })),
    });
    if (!devices.length) {
      dispenseLog('error', 'Tidak ada USB serial device');
      throw new Error('Tidak ada USB serial device. Pasang OTG/adapter VMC.');
    }

    const device =
      options.deviceId != null
        ? devices.find((d) => d.deviceId === options.deviceId)
        : devices[0];
    if (!device) throw new Error(`USB deviceId ${options.deviceId} tidak ditemukan`);

    dispenseLog('info', 'USB pilih device', {
      deviceId: device.deviceId,
      label: device.label,
      hasPermission: device.hasPermission,
    });

    if (!device.hasPermission) {
      const { granted } = await UsbSerial.requestPermission({ deviceId: device.deviceId });
      dispenseLog(granted ? 'info' : 'error', 'USB requestPermission', { granted });
      if (!granted) throw new Error('Izin USB ditolak user');
    }

    const { portId } = await UsbSerial.open({
      deviceId: device.deviceId,
      portNum: options.portNum ?? 0,
    });
    this.portId = portId;

    await UsbSerial.setParameters({
      portId,
      baudRate: options.baudRate ?? 57600,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? 'none',
    });
    dispenseLog('info', 'USB port open + params', {
      portId,
      baud: options.baudRate ?? 57600,
    });

    this.dataHandle = await UsbSerial.addListener('data', (ev) => {
      try {
        const bytes = base64ToBytes(ev.data);
        if (bytes.length) this.rxSubject.next(bytes);
      } catch (err) {
        dispenseLog('error', 'decode RX gagal', err);
        console.error('[VmcSerial] decode RX gagal', err);
      }
    });

    this.errorHandle = await UsbSerial.addListener('error', (ev) => {
      dispenseLog('error', 'USB plugin error', { code: ev?.code, message: ev?.message });
      console.error('[VmcSerial] plugin error', ev?.code, ev?.message);
    });

    this.detachedHandle = await UsbSerial.addListener('detached', () => {
      this.openFlag = false;
      this.portId = null;
      dispenseLog('warn', 'USB detached');
      console.warn('[VmcSerial] USB detached');
    });

    await UsbSerial.startReading({ portId });
    this.openFlag = true;
    dispenseLog('info', 'USB startReading OK');
  }

  async close(): Promise<void> {
    const portId = this.portId;
    this.openFlag = false;
    this.portId = null;

    try {
      if (portId) {
        try {
          await UsbSerial.stopReading({ portId });
        } catch (_) {
          /* ignore */
        }
        try {
          await UsbSerial.close({ portId });
        } catch (_) {
          /* ignore */
        }
      }
    } finally {
      await this.dataHandle?.remove().catch(() => undefined);
      await this.errorHandle?.remove().catch(() => undefined);
      await this.detachedHandle?.remove().catch(() => undefined);
      this.dataHandle = null;
      this.errorHandle = null;
      this.detachedHandle = null;
    }
  }

  isOpen(): boolean {
    return this.openFlag && !!this.portId;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.portId || !this.openFlag) {
      throw new Error('USB serial belum open');
    }
    await UsbSerial.write({
      portId: this.portId,
      data: bytesToBase64(bytes),
    });
  }

  private assertAndroid(): void {
    if (!CapacitorUsbSerialDriver.isNativeAndroid()) {
      throw new Error(
        'USB serial hanya di Android native. Di browser pakai loopback (tahap 2 dev).'
      );
    }
  }
}
