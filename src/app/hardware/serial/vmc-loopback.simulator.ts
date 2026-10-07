import {
  buildAckFrame,
  buildCheckSelectionResultFrame,
  buildDispenseStatusFrame,
  buildJammedClearReplyFrame,
  buildJammedQueryReplyFrame,
  buildPollFrame,
  CheckSelectionResultCode,
  DispenseStatus,
  JammedSelectionMenu,
  tryParseFrameAt,
  VmcCmd,
} from '../vmc';
import { LoopbackSerialDriver } from './loopback-serial.driver';

/**
 * Mensimulasikan VMC di browser:
 * - POLL tiap ~200ms
 * - 0x01 check selection → ACK + 0x02 OK
 * - 0x06 / 0x03 → ACK + status dispense
 * - 0x70 tipe 0x32 → ACK + 0x71 daftar jammed / hasil clear
 * - Heat (elevator=1): heating countdown → TAKE_LUNCH_BOX → pintu menutup
 */
export class VmcLoopbackSimulator {
  /** Selection yang dianggap jammed; dikosongkan oleh clear 0x32. */
  jammedSelections: number[] = [];

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private driver: LoopbackSerialDriver | null = null;
  private prevOnWrite: LoopbackSerialDriver['onWrite'] = null;

  start(driver: LoopbackSerialDriver, pollIntervalMs = 200): void {
    this.stop();
    this.driver = driver;
    this.prevOnWrite = driver.onWrite;

    driver.onWrite = (bytes) => {
      this.prevOnWrite?.(bytes);
      this.onHostWrite(bytes);
    };

    this.pollTimer = setInterval(() => {
      if (this.driver?.isOpen()) {
        this.driver.injectRx(buildPollFrame());
      }
    }, pollIntervalMs);

    setTimeout(() => {
      if (this.driver?.isOpen()) this.driver.injectRx(buildPollFrame());
    }, 20);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.driver) {
      this.driver.onWrite = this.prevOnWrite;
      this.driver = null;
    }
    this.prevOnWrite = null;
  }

  private onHostWrite(bytes: Uint8Array): void {
    const frame = tryParseFrameAt(bytes);
    if (!frame || !this.driver) return;

    const cmd = frame.cmd & 0xff;
    const packNo = frame.payload[0] ?? 1;
    const drv = this.driver;

    if (cmd === VmcCmd.CHECK_SELECTION) {
      const slotHi = frame.payload[1] ?? 0;
      const slotLo = frame.payload[2] ?? 0;
      const selection = (slotHi << 8) | slotLo;
      setTimeout(() => drv.isOpen() && drv.injectRx(buildAckFrame()), 20);
      setTimeout(() => {
        if (!drv.isOpen()) return;
        drv.injectRx(
          buildCheckSelectionResultFrame({
            packNo,
            result: CheckSelectionResultCode.OK,
            slotCode: selection,
          })
        );
      }, 60);
      return;
    }

    if (cmd === VmcCmd.REQUEST_MACHINE_STATUS) {
      // Hanya ACK: format balasan 0x53 tidak ada di PDF, jangan mengarang payload.
      setTimeout(() => drv.isOpen() && drv.injectRx(buildAckFrame()), 30);
      return;
    }

    if (cmd === VmcCmd.MENU_COMMAND && frame.payload[1] === JammedSelectionMenu.TYPE) {
      const clear = frame.payload[2] === JammedSelectionMenu.CLEAR;
      const reply = clear
        ? buildJammedClearReplyFrame({ packNo, ok: true })
        : buildJammedQueryReplyFrame({ packNo, jammed: this.jammedSelections });
      if (clear) this.jammedSelections = [];
      setTimeout(() => drv.isOpen() && drv.injectRx(buildAckFrame()), 20);
      setTimeout(() => drv.isOpen() && drv.injectRx(reply), 60);
      return;
    }

    if (cmd !== VmcCmd.DRIVE_SELECTION && cmd !== VmcCmd.SELECT_TO_BUY) return;

    const heat = cmd === VmcCmd.DRIVE_SELECTION ? (frame.payload[2] & 0xff) === 1 : false;
    const slotHi = frame.payload[frame.payload.length - 2] ?? 0;
    const slotLo = frame.payload[frame.payload.length - 1] ?? 0;
    const selection = (slotHi << 8) | slotLo;

    const inject = (status: number, mw: number, delayMs: number) => {
      setTimeout(() => {
        if (!drv.isOpen()) return;
        drv.injectRx(
          buildDispenseStatusFrame({
            packNo,
            status,
            slotCode: selection,
            microwaveNumber: mw,
          })
        );
      }, delayMs);
    };

    setTimeout(() => drv.isOpen() && drv.injectRx(buildAckFrame()), 25);
    inject(DispenseStatus.DISPENSING, 0, 80);

    if (heat) {
      inject(DispenseStatus.SUCCESS, 0, 200);
      inject(DispenseStatus.LUNCH_HEATING, 0, 400);
      inject(DispenseStatus.LUNCH_HEATING_REMAINING, 3, 700);
      inject(DispenseStatus.LUNCH_HEATING_REMAINING, 1, 1400);
      inject(DispenseStatus.TAKE_LUNCH_BOX, 0, 1800);
      inject(DispenseStatus.MW_DELIVERY_DOOR_CLOSING, 0, 2400);
    } else {
      inject(DispenseStatus.SUCCESS, 0, 350);
    }
  }
}
