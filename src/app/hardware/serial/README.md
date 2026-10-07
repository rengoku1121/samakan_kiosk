# Serial transport

Buka port **native ttyS** / USB–RS232 / loopback, stream byte → frame (`../vmc`).

| File | Isi |
|------|-----|
| `types.ts` | Kontrak driver |
| `loopback-serial.driver.ts` | Serial palsu (browser/test) |
| `capacitor-usb-serial.*` | USB serial Android |
| `native-tty-serial.*` | UART native `/dev/ttyS1` (XY5186-E) |
| `vmc-serial.transport.ts` | Open + POLL/ACK + `queueOnPoll` |
| `vmc-loopback.simulator.ts` | Pura-pura VMC di browser |
| `serial-transport.spec.ts` | Unit test |

Default: **57600 8N1**.

Mesin XY (traffic VMC di `ttyS1`):

```ts
// environment.ts
vmc: {
  nativeDevicePath: '/dev/ttyS1',
  serialBackend: 'native-tty',
}
```

Plugin native ada di `android/app/.../serial/` + JNI `cpp/SerialPort.c`.

```ts
await this.serial.open(); // path dari environment
this.serial.queueOnPoll(driveFrame);
```

Lihat juga: [`../README.md`](../README.md)
