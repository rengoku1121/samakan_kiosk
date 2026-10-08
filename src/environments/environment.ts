// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  appVersion: '1.1.0',
  /** Base URL samakan_core_backend (tanpa trailing slash) */
  apiBaseUrl: 'http://192.168.1.12:4000',
  /** Kode mesin di core (machines.code) */
  machineCode: 'MER-000001-M1',
  /** Harus sama dengan KIOSK_API_INTERNAL_TOKEN di core */
  kioskToken: 'dev-kiosk-token',
  /**
   * VMC dispense (tahap 3)
   * - auto: Android → hardware USB; browser → loopback-sim
   * - hardware | loopback-sim | mock
   */
  vmc: {
    mode: 'auto' as 'auto' | 'mock' | 'hardware' | 'loopback-sim',
    /**
     * Android XY5186-E: UART onboard (bukan USB).
     * Live traffic VMC di /dev/ttyS1 (ttyS2/S3 diam). Kosongkan untuk fallback USB.
     */
    nativeDevicePath: '/dev/ttyS1',
    /** auto | native-tty | usb */
    serialBackend: 'native-tty' as 'auto' | 'native-tty' | 'usb',
    dispenseTimeoutMs: 5 * 60 * 1000,
    commandAckTimeoutMs: 8000,
    pollIntervalMs: 200,
    /** Tunggu pintu delivery menutup setelah ambil (heat). */
    pickupDoorTimeoutMs: 90_000,
    motorSettleMs: 2500,
    /** Jendela balasan probe 0x53 di Mode Servis. */
    machineStatusWindowMs: 3000,
  },
  /** Attract-mode: tampil setelah diam 30 detik, kecuali saat bayar/dispense. */
  screensaver: {
    enabled: true,
    idleMs: 30_000,
  },
  /** Heartbeat + antrean laporan dispense yang gagal terkirim. */
  health: {
    heartbeatMs: 60_000,
  },
};
