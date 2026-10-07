export const environment = {
  production: true,
  appVersion: '1.1.0',
  /** HTTPS wajib: build rilis menolak cleartext (network_security_config.xml). */
  apiBaseUrl: 'https://core.samakan.id',
  /**
   * Nilai pabrik. Per mesin diisi lewat Mode Servis di kiosk
   * (ketuk kode mesin 5× di beranda) supaya tidak perlu satu APK per mesin.
   */
  machineCode: 'MER-000001-M1',
  /** Harus diganti token produksi (KIOSK_API_INTERNAL_TOKEN di Core). */
  kioskToken: '8f4c1e6b2d7a93f015bc68e2419d5a7c6e0f43b92da8175c3e69f1b48a2d7c05e91f6a34bc7280df',
  vmc: {
    mode: 'auto' as 'auto' | 'mock' | 'hardware' | 'loopback-sim',
    nativeDevicePath: '/dev/ttyS1',
    serialBackend: 'native-tty' as 'auto' | 'native-tty' | 'usb',
    dispenseTimeoutMs: 5 * 60 * 1000,
    commandAckTimeoutMs: 8000,
    pollIntervalMs: 200,
    pickupDoorTimeoutMs: 90_000,
    motorSettleMs: 2500,
    machineStatusWindowMs: 3000,
  },
  screensaver: {
    enabled: true,
    idleMs: 60_000,
  },
  health: {
    heartbeatMs: 60_000,
  },
};
