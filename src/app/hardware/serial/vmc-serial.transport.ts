import { Injectable, OnDestroy } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  buildAckFrame,
  bytesToHex,
  isPollFrame,
  parseFrames,
  VMC_BAUD,
  VmcFrame,
} from '../vmc';
import { CapacitorUsbSerialDriver } from './capacitor-usb-serial.driver';
import { LoopbackSerialDriver } from './loopback-serial.driver';
import { NativeTtySerialDriver } from './native-tty-serial.driver';
import { SerialDeviceInfo, SerialOpenOptions, SerialPortDriver } from './types';
import { dispenseLog } from '../../services/dispense-log';

export type VmcSerialOpenOptions = SerialOpenOptions & {
  /**
   * Auto-balas ACK saat terima POLL (wajib ≤100ms di protokol).
   * Default true.
   */
  autoAckPoll?: boolean;
  /** Paksa loopback meski di Android (untuk debug UI). */
  forceLoopback?: boolean;
  /**
   * Preferensi driver Android: native-tty | usb | auto
   * auto = pakai nativeDevicePath jika di-set, else USB.
   */
  serialBackend?: 'auto' | 'native-tty' | 'usb';
};

/**
 * Transport serial VMC: buka port + stream frame + jawab POLL.
 * Tahap 3: `queueOnPoll()` mengirim command pada POLL berikutnya (bukan ACK).
 */
@Injectable({ providedIn: 'root' })
export class VmcSerialTransport implements OnDestroy {
  private driver: SerialPortDriver | null = null;
  private rxSub?: Subscription;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private autoAckPoll = true;
  /** Frame yang dikirim saat POLL berikutnya (Process 2 di PDF). */
  private pendingOnPoll: Uint8Array | null = null;

  private readonly frameSubject = new Subject<VmcFrame>();
  /** Frame VMC lengkap (sudah lolos XOR). */
  readonly frames$: Observable<VmcFrame> = this.frameSubject.asObservable();

  private readonly rawSubject = new Subject<Uint8Array>();
  /** Chunk byte mentah (debug). */
  readonly rawRx$: Observable<Uint8Array> = this.rawSubject.asObservable();

  private readonly txSubject = new Subject<Uint8Array>();
  /** Frame yang baru di-TX (untuk simulator loopback). */
  readonly tx$: Observable<Uint8Array> = this.txSubject.asObservable();

  /** Counter POLL — log tiap ~25x supaya logcat tidak banjir. */
  private pollCount = 0;

  /** Opsi open terakhir, dipakai saat reconnect otomatis. */
  private lastOpenOptions: VmcSerialOpenOptions | null = null;
  private lastRxAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private closedByUs = false;

  ngOnDestroy(): void {
    this.stopWatchdog();
    void this.close();
  }

  /** Waktu byte terakhir dari VMC; 0 bila belum pernah menerima apa pun. */
  get lastRxTimestamp(): number {
    return this.lastRxAt;
  }

  /** Driver aktif (null jika belum open). */
  get activeDriver(): SerialPortDriver | null {
    return this.driver;
  }

  isOpen(): boolean {
    return !!this.driver?.isOpen();
  }

  async listDevices(forceLoopback = false): Promise<SerialDeviceInfo[]> {
    const envVmc = (environment as { vmc?: { nativeDevicePath?: string; serialBackend?: string } }).vmc;
    const devicePath = (envVmc?.nativeDevicePath || '').trim();
    const backend = (envVmc?.serialBackend as VmcSerialOpenOptions['serialBackend']) || 'auto';
    const drv = this.createDriver(forceLoopback, backend, devicePath);
    return drv.listDevices();
  }

  async open(options: VmcSerialOpenOptions = {}): Promise<SerialPortDriver> {
    await this.close();

    this.lastOpenOptions = { ...options };
    this.closedByUs = false;
    this.autoAckPoll = options.autoAckPoll !== false;
    const envVmc = (environment as { vmc?: { nativeDevicePath?: string; serialBackend?: string } }).vmc;
    const devicePath = (options.devicePath || envVmc?.nativeDevicePath || '').trim();
    const backend =
      options.serialBackend ||
      (envVmc?.serialBackend as VmcSerialOpenOptions['serialBackend']) ||
      'auto';

    const driver = this.createDriver(!!options.forceLoopback, backend, devicePath);
    this.driver = driver;

    await driver.open({
      baudRate: options.baudRate ?? VMC_BAUD,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? 'none',
      deviceId: options.deviceId,
      portNum: options.portNum,
      devicePath: devicePath || undefined,
    });

    this.rxBuffer = new Uint8Array(0);
    this.pollCount = 0;
    this.lastRxAt = Date.now();
    this.rxSub = driver.rx$.subscribe({
      next: (chunk) => this.onRx(chunk),
      error: (err) => {
        dispenseLog('error', 'stream serial error — jadwalkan reconnect', err);
        this.scheduleReconnect();
      },
      complete: () => {
        if (this.closedByUs) return;
        dispenseLog('warn', 'stream serial tertutup sendiri — jadwalkan reconnect');
        this.scheduleReconnect();
      },
    });

    console.info(
      `[VmcSerial] open via ${driver.name} baud=${options.baudRate ?? VMC_BAUD}` +
        (devicePath ? ` path=${devicePath}` : '')
    );
    dispenseLog('info', 'VmcSerialTransport.open', {
      driver: driver.name,
      baud: options.baudRate ?? VMC_BAUD,
      forceLoopback: !!options.forceLoopback,
      devicePath: devicePath || null,
      backend,
    });
    return driver;
  }

  async close(): Promise<void> {
    this.closedByUs = true;
    this.rxSub?.unsubscribe();
    this.rxSub = undefined;
    this.rxBuffer = new Uint8Array(0);
    this.pendingOnPoll = null;
    const drv = this.driver;
    this.driver = null;
    if (drv?.isOpen()) await drv.close();
  }

  /**
   * VMC mengirim POLL terus-menerus. Kalau tidak ada byte sama sekali selama
   * `staleMs`, port sudah mati diam-diam (kabel lepas, panel tidur, driver
   * kernel reset) — buka ulang dengan opsi yang sama.
   */
  startAutoReconnect(staleMs = 15_000, checkMs = 5_000): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (!this.lastOpenOptions || this.reconnecting) return;
      if (!this.driver) return;
      if (!this.driver.isOpen()) {
        this.scheduleReconnect();
        return;
      }
      if (Date.now() - this.lastRxAt > staleMs) {
        dispenseLog('warn', 'tidak ada POLL dari VMC — reconnect serial', {
          idleMs: Date.now() - this.lastRxAt,
        });
        this.scheduleReconnect();
      }
    }, checkMs);
  }

  stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || !this.lastOpenOptions) return;
    this.reconnecting = true;
    const options = this.lastOpenOptions;

    void (async () => {
      try {
        await this.close();
        await new Promise((r) => setTimeout(r, 1000));
        await this.open(options);
        dispenseLog('info', 'reconnect serial berhasil', {
          driver: this.activeDriver?.name,
        });
      } catch (err) {
        dispenseLog('error', 'reconnect serial gagal, akan dicoba lagi', err);
        // Biarkan watchdog yang mencoba lagi pada siklus berikutnya.
        this.lastOpenOptions = options;
      } finally {
        this.reconnecting = false;
      }
    })();
  }

  /**
   * Antre command untuk POLL berikutnya (bukan ACK).
   * Dipakai dispense: tunggu POLL → kirim 0x06 → VMC ACK → status 0x04.
   */
  queueOnPoll(frame: Uint8Array): void {
    this.pendingOnPoll = frame.slice();
    dispenseLog('info', 'queueOnPoll', { hex: bytesToHex(frame), bytes: frame.length });
  }

  clearQueuedCommand(): void {
    if (this.pendingOnPoll) {
      dispenseLog('warn', 'clearQueuedCommand (command dibatalkan sebelum POLL)');
    }
    this.pendingOnPoll = null;
  }

  hasQueuedCommand(): boolean {
    return !!this.pendingOnPoll;
  }

  async writeBytes(bytes: Uint8Array): Promise<void> {
    if (!this.driver?.isOpen()) throw new Error('VmcSerialTransport belum open');
    await this.driver.write(bytes);
  }

  async writeFrame(frame: Uint8Array): Promise<void> {
    dispenseLog('info', 'TX frame', bytesToHex(frame));
    this.txSubject.next(frame.slice());
    await this.writeBytes(frame);
  }

  /** Hanya tersedia jika driver = LoopbackSerialDriver. */
  injectLoopbackRx(bytes: Uint8Array): void {
    const drv = this.driver;
    if (!(drv instanceof LoopbackSerialDriver)) {
      throw new Error('injectLoopbackRx hanya untuk loopback driver');
    }
    drv.injectRx(bytes);
  }

  private createDriver(
    forceLoopback: boolean,
    backend: 'auto' | 'native-tty' | 'usb' = 'auto',
    devicePath = ''
  ): SerialPortDriver {
    if (forceLoopback) return new LoopbackSerialDriver();
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return new LoopbackSerialDriver();
    }

    const useNative =
      backend === 'native-tty' || (backend === 'auto' && !!devicePath);

    if (useNative && NativeTtySerialDriver.isNativeAndroid()) {
      dispenseLog('info', 'createDriver → native-tty-serial', { devicePath, backend });
      return new NativeTtySerialDriver();
    }

    if (CapacitorUsbSerialDriver.isNativeAndroid()) {
      dispenseLog('info', 'createDriver → capacitor-usb-serial', { backend });
      return new CapacitorUsbSerialDriver();
    }

    return new LoopbackSerialDriver();
  }

  private onRx(chunk: Uint8Array): void {
    this.lastRxAt = Date.now();
    this.rawSubject.next(chunk);
    this.rxBuffer = concatUint8(this.rxBuffer, chunk);
    const { frames, rest } = parseFrames(this.rxBuffer);
    this.rxBuffer = new Uint8Array(rest);

    for (const frame of frames) {
      const cmd = frame.cmd & 0xff;
      const isPoll = isPollFrame(frame.cmd);
      if (isPoll) {
        this.pollCount += 1;
        if (this.pendingOnPoll || this.pollCount === 1 || this.pollCount % 25 === 0) {
          dispenseLog('info', 'RX POLL', {
            n: this.pollCount,
            hasQueued: !!this.pendingOnPoll,
          });
        }
      } else {
        dispenseLog('info', 'RX frame', { cmd: `0x${cmd.toString(16)}`, hex: bytesToHex(frame.raw) });
      }
      this.frameSubject.next(frame);

      if (isPoll) {
        const queued = this.pendingOnPoll;
        if (queued) {
          this.pendingOnPoll = null;
          dispenseLog('info', 'POLL → kirim command antrean', bytesToHex(queued));
          void this.writeFrame(queued).catch((err) => {
            dispenseLog('error', 'kirim command on POLL gagal', err);
            console.error('[VmcSerial] kirim command on POLL gagal', err);
          });
        } else if (this.autoAckPoll) {
          void this.writeFrame(buildAckFrame()).catch((err) => {
            dispenseLog('error', 'auto ACK POLL gagal', err);
            console.error('[VmcSerial] auto ACK POLL gagal', err);
          });
        }
      }
    }
  }
}

function concatUint8(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return new Uint8Array(b);
  if (!b.length) return new Uint8Array(a);
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Helper kecil untuk log platform. */
export function serialRuntimeLabel(): string {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return 'android-usb';
  }
  return 'loopback';
}
