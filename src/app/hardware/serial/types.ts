import { Observable } from 'rxjs';

export type SerialParity = 'none' | 'odd' | 'even' | 'mark' | 'space';

export type SerialOpenOptions = {
  /** Default dari VMC: 57600 */
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: SerialParity;
  /**
   * deviceId dari listDevices() (USB).
   * Kosong = pilih device pertama yang tersedia.
   */
  deviceId?: number;
  portNum?: number;
  /**
   * Path UART native Android, mis. /dev/ttyS2 (XY5186-E).
   * Dipakai NativeTtySerialDriver.
   */
  devicePath?: string;
};

export type SerialDeviceInfo = {
  deviceId: number;
  productName?: string;
  manufacturerName?: string;
  driverType?: string;
  hasPermission?: boolean;
  /** Label untuk UI / log */
  label: string;
};

/**
 * Driver rendah: buka/tutup port + kirim/terima byte.
 * Implementasi: loopback (web) atau Capacitor USB serial (Android).
 */
export interface SerialPortDriver {
  readonly name: string;
  listDevices(): Promise<SerialDeviceInfo[]>;
  open(options?: SerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  write(bytes: Uint8Array): Promise<void>;
  /** Stream byte mentah dari port (chunk). */
  readonly rx$: Observable<Uint8Array>;
}
