import { firstValueFrom, take } from 'rxjs';
import { buildAckFrame, bytesToHex, VmcCmd } from '../vmc';
import { base64ToBytes, bytesToBase64 } from './base64';
import { LoopbackSerialDriver } from './loopback-serial.driver';
import { VmcSerialTransport } from './vmc-serial.transport';

describe('Serial transport (tahap 2)', () => {
  it('base64 roundtrip', () => {
    const src = Uint8Array.from([0xfa, 0xfb, 0x41, 0x00, 0x40]);
    expect(Array.from(base64ToBytes(bytesToBase64(src)))).toEqual(Array.from(src));
  });

  it('loopback inject + auto ACK on POLL', async () => {
    const transport = new VmcSerialTransport();
    const written: string[] = [];

    await transport.open({ forceLoopback: true, autoAckPoll: true });
    const driver = transport.activeDriver as LoopbackSerialDriver;
    expect(driver.name).toBe('loopback');

    const origWrite = driver.write.bind(driver);
    driver.write = async (bytes: Uint8Array) => {
      written.push(bytesToHex(bytes));
      return origWrite(bytes);
    };

    const framePromise = firstValueFrom(transport.frames$.pipe(take(1)));
    // POLL resmi PDF
    driver.injectRx(Uint8Array.from([0xfa, 0xfb, 0x41, 0x00, 0x40]));

    const frame = await framePromise;
    expect(frame.cmd).toBe(VmcCmd.POLL);

    // beri microtask untuk auto ACK
    await new Promise((r) => setTimeout(r, 20));
    expect(written).toContain(bytesToHex(buildAckFrame()));

    await transport.close();
  });

  it('writeFrame melalui loopback', async () => {
    const transport = new VmcSerialTransport();
    await transport.open({ forceLoopback: true, autoAckPoll: false });
    await expectAsync(
      transport.writeFrame(buildAckFrame())
    ).toBeResolved();
    await transport.close();
  });

  it('queueOnPoll terkirim pada POLL berikutnya', async () => {
    const transport = new VmcSerialTransport();
    await transport.open({ forceLoopback: true, autoAckPoll: false });
    const driver = transport.activeDriver as LoopbackSerialDriver;
    const written: string[] = [];
    const origWrite = driver.write.bind(driver);
    driver.write = async (bytes: Uint8Array) => {
      written.push(bytesToHex(bytes));
      return origWrite(bytes);
    };

    transport.queueOnPoll(buildAckFrame());
    expect(transport.hasQueuedCommand()).toBeTrue();
    driver.injectRx(Uint8Array.from([0xfa, 0xfb, 0x41, 0x00, 0x40]));
    await new Promise((r) => setTimeout(r, 30));
    expect(written).toContain(bytesToHex(buildAckFrame()));
    expect(transport.hasQueuedCommand()).toBeFalse();
    await transport.close();
  });

  it('watchdog reconnect saat UART diam (timeout RX)', async () => {
    const transport = new VmcSerialTransport();
    await transport.open({ forceLoopback: true, autoAckPoll: false });
    const closeSpy = spyOn(transport, 'close').and.callThrough();
    transport.startAutoReconnect(20, 10);
    await new Promise((r) => setTimeout(r, 80));
    transport.stopWatchdog();
    expect(closeSpy).toHaveBeenCalled();
    await transport.close();
  });
});
