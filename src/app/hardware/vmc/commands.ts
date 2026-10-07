import { DEFAULT_SELECTION_ENDIAN, JammedSelectionMenu, VmcCmd } from './constants';
import { buildFrame, clampPackNo } from './frame';
import { selectionToBytes } from './selection';
import {
  DriveSelectionOptions,
  JammedSelectionOperation,
  SelectToBuyOptions,
  SelectionEndian,
} from './types';

/** ACK resmi PDF: FA FB 42 00 43 */
export function buildAckFrame(): Uint8Array {
  return buildFrame(VmcCmd.ACK, []);
}

/**
 * 4.3.2 Upper computer selects to buy (0x03)
 * PackNO(1) + selection(2)
 */
export function buildSelectToBuyFrame(opts: SelectToBuyOptions): Uint8Array {
  const packNo = clampPackNo(opts.packNo);
  const [b0, b1] = selectionToBytes(opts.slotCode, opts.endian ?? DEFAULT_SELECTION_ENDIAN);
  return buildFrame(VmcCmd.SELECT_TO_BUY, [packNo, b0, b1]);
}

/**
 * 4.3.5 Upper computer drives selection directly (0x06)
 * PackNO(1) + enableDrop(1) + enableElevator(1) + selection(2)
 *
 * Mapping sementara heatRequested → enableElevator:
 * - true  → elevator 1 (jalur microwave/lift)
 * - false → elevator 0 (kandidat tanpa heat; wajib diuji di mesin)
 */
export function buildDriveSelectionFrame(opts: DriveSelectionOptions): Uint8Array {
  const packNo = clampPackNo(opts.packNo);
  const drop = opts.enableDropSensor === false ? 0 : 1;
  const elevator = opts.heatRequested === true ? 1 : 0;
  const [b0, b1] = selectionToBytes(opts.slotCode, opts.endian ?? DEFAULT_SELECTION_ENDIAN);
  return buildFrame(VmcCmd.DRIVE_SELECTION, [packNo, drop, elevator, b0, b1]);
}

/**
 * 4.3.4 Select / cancel — selection 0 = cancel.
 */
export function buildSelectOrCancelFrame(
  packNo: number,
  slotCode: string | number = 0,
  endian = DEFAULT_SELECTION_ENDIAN
): Uint8Array {
  const pn = clampPackNo(packNo);
  const [b0, b1] = selectionToBytes(slotCode, endian);
  return buildFrame(VmcCmd.SELECT_OR_CANCEL, [pn, b0, b1]);
}

/**
 * 4.3.1 check selection working (0x01).
 * PDF LEN=4: PackNO + selection(2) + reserved 0.
 */
export function buildCheckSelectionFrame(
  packNo: number,
  slotCode: string | number,
  endian = DEFAULT_SELECTION_ENDIAN
): Uint8Array {
  const pn = clampPackNo(packNo);
  const [b0, b1] = selectionToBytes(slotCode, endian);
  return buildFrame(VmcCmd.CHECK_SELECTION, [pn, b0, b1, 0]);
}

/** Helper tes / loopback: reply 0x02 PackNO + result + selection(2). */
export function buildCheckSelectionResultFrame(opts: {
  packNo: number;
  result: number;
  slotCode: string | number;
  endian?: SelectionEndian;
}): Uint8Array {
  const pn = clampPackNo(opts.packNo);
  const [b0, b1] = selectionToBytes(opts.slotCode, opts.endian ?? DEFAULT_SELECTION_ENDIAN);
  return buildFrame(VmcCmd.CHECK_SELECTION_RESULT, [pn, opts.result & 0xff, b0, b1]);
}

/**
 * Request machine status (0x53) — PackNO(1).
 *
 * Balasan VMC tidak diparse: format reply tidak tercantum di PDF yang dipakai
 * kiosk, jadi Mode Servis hanya menampilkan hex apa adanya.
 */
export function buildRequestMachineStatusFrame(packNo: number): Uint8Array {
  const pn = clampPackNo(packNo);
  return buildFrame(VmcCmd.REQUEST_MACHINE_STATUS, [pn]);
}

/**
 * 4.5.32 Clear jammed selection lewat menu command (0x70).
 * PackNO + type 0x32 + operasi (0x00 tanya, 0x01 bersihkan).
 * Hanya menghapus tanda macet di VMC — motor tidak digerakkan.
 */
export function buildJammedSelectionFrame(
  packNo: number,
  operation: JammedSelectionOperation
): Uint8Array {
  const pn = clampPackNo(packNo);
  const op = operation === 'clear' ? JammedSelectionMenu.CLEAR : JammedSelectionMenu.QUERY;
  return buildFrame(VmcCmd.MENU_COMMAND, [pn, JammedSelectionMenu.TYPE, op]);
}

/**
 * Helper tes / loopback: reply 0x71 untuk tanya jammed.
 * PackNO + 0x32 + 0x00 + jumlah + selection(2)… + jumlah belt + selection(2)…
 */
export function buildJammedQueryReplyFrame(opts: {
  packNo: number;
  jammed: number[];
  beltFailed?: number[];
  endian?: SelectionEndian;
}): Uint8Array {
  const endian = opts.endian ?? DEFAULT_SELECTION_ENDIAN;
  const list = (codes: number[]) => {
    const bytes = [codes.length];
    for (const code of codes) bytes.push(...selectionToBytes(code, endian));
    return bytes;
  };
  return buildFrame(VmcCmd.MENU_REPLY, [
    clampPackNo(opts.packNo),
    JammedSelectionMenu.TYPE,
    JammedSelectionMenu.QUERY,
    ...list(opts.jammed),
    ...list(opts.beltFailed ?? []),
  ]);
}

/** Helper tes / loopback: reply 0x71 untuk clear jammed (status 0x00 = berhasil). */
export function buildJammedClearReplyFrame(opts: { packNo: number; ok: boolean }): Uint8Array {
  return buildFrame(VmcCmd.MENU_REPLY, [
    clampPackNo(opts.packNo),
    JammedSelectionMenu.TYPE,
    JammedSelectionMenu.CLEAR,
    opts.ok ? 0x00 : 0x01,
  ]);
}

export function isPollFrame(cmd: number): boolean {
  return (cmd & 0xff) === VmcCmd.POLL;
}

export function isAckFrame(cmd: number): boolean {
  return (cmd & 0xff) === VmcCmd.ACK;
}

/** POLL resmi PDF: FA FB 41 00 40 */
export function buildPollFrame(): Uint8Array {
  return buildFrame(VmcCmd.POLL, []);
}

/**
 * 4.3.3 VMC dispensing status (0x04) — biasanya dikirim VMC;
 * helper ini untuk test / loopback simulator.
 */
export function buildDispenseStatusFrame(opts: {
  packNo: number;
  status: number;
  slotCode: string | number;
  microwaveNumber?: number;
  endian?: SelectionEndian;
}): Uint8Array {
  const packNo = clampPackNo(opts.packNo);
  const [b0, b1] = selectionToBytes(opts.slotCode, opts.endian ?? DEFAULT_SELECTION_ENDIAN);
  const mw = (opts.microwaveNumber ?? 0) & 0xff;
  return buildFrame(VmcCmd.DISPENSE_STATUS, [packNo, opts.status & 0xff, b0, b1, mw]);
}
