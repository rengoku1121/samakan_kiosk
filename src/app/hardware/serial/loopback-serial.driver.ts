import { Observable, Subject } from 'rxjs';
import { SerialDeviceInfo, SerialOpenOptions, SerialPortDriver } from './types';

/**
 * Driver loopback untuk web / unit test.
 * Byte yang di-write muncul lagi di rx$ (echo),
 * dan bisa injectRx() untuk mensimulasikan POLL dari VMC.
 */
export class LoopbackSerialDriver implements SerialPortDriver {
  readonly name = 'loopback';

  private openFlag = false;
  private readonly rxSubject = new Subject<Uint8Array>();
  readonly rx$: Observable<Uint8Array> = this.rxSubject.asObservable();

  /** Jika true, write() juga di-echo ke rx$ (default false — VMC tidak echo). */
  echoWrites = false;

  /** Hook untuk simulator VMC (tahap 3). */
  onWrite: ((bytes: Uint8Array) => void) | null = null;

  async listDevices(): Promise<SerialDeviceInfo[]> {
    return [
      {
        deviceId: 1,
        label: 'Loopback VMC (simulasi)',
        productName: 'loopback',
        driverType: 'loopback',
        hasPermission: true,
      },
    ];
  }

  async open(_options?: SerialOpenOptions): Promise<void> {
    this.openFlag = true;
  }

  async close(): Promise<void> {
    this.openFlag = false;
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.openFlag) throw new Error('Loopback port belum open');
    this.onWrite?.(bytes.slice());
    if (this.echoWrites) {
      this.rxSubject.next(bytes.slice());
    }
  }

  /** Simulasikan data masuk dari VMC (mis. frame POLL). */
  injectRx(bytes: Uint8Array): void {
    if (!this.openFlag) throw new Error('Loopback port belum open');
    this.rxSubject.next(bytes.slice());
  }
}
