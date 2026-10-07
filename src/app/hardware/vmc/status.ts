import {
  CHECK_SELECTION_RESULT_LABELS,
  CheckSelectionResultCode,
  DEFAULT_SELECTION_ENDIAN,
  DISPENSE_STATUS_LABELS,
  DispenseStatus,
  JammedSelectionMenu,
  VmcCmd,
} from './constants';
import { bytesToSelectionNumber } from './selection';
import {
  CheckSelectionResult,
  DispenseStatusEvent,
  JammedClearResult,
  JammedQueryResult,
  SelectionEndian,
  VmcFrame,
} from './types';

const SUCCESS_STATUSES = new Set<number>([
  DispenseStatus.SUCCESS,
  DispenseStatus.TAKE_LUNCH_BOX,
]);

/** Status yang menandai siklus pemanas (bukan terminal). */
const HEATING_STATUSES = new Set<number>([
  DispenseStatus.LUNCH_HEATING,
  DispenseStatus.LUNCH_HEATING_REMAINING,
  DispenseStatus.PUSHING_INTO_MICROWAVE,
  DispenseStatus.MW_INLET_DOOR_OPENING,
  DispenseStatus.MW_INLET_DOOR_CLOSING,
  DispenseStatus.MW_DELIVERY_DOOR_OPENING,
]);

/** Pintu pickup/delivery sedang menutup setelah ambil. */
export function isPickupDoorClosingStatus(status: number): boolean {
  return (status & 0xff) === DispenseStatus.MW_DELIVERY_DOOR_CLOSING;
}

export function isHeatingRelatedStatus(status: number): boolean {
  return HEATING_STATUSES.has(status & 0xff);
}

/**
 * Sukses terminal bergantung alur:
 * - tanpa heat → 0x02 SUCCESS cukup
 * - dengan heat → tunggu 0x24 TAKE_LUNCH_BOX; 0x02 sebelum heating = progress
 */
export function isTerminalSuccessStatus(
  status: number,
  opts: { heatRequested: boolean; seenHeating: boolean }
): boolean {
  const s = status & 0xff;
  if (s === DispenseStatus.TAKE_LUNCH_BOX) return true;
  if (s !== DispenseStatus.SUCCESS) return false;
  if (!opts.heatRequested) return true;
  // Heat: 0x02 hanya terminal setelah sudah masuk siklus microwave/heating
  return opts.seenHeating;
}

const FAILURE_STATUSES = new Set<number>([
  DispenseStatus.SELECTION_JAMMED,
  DispenseStatus.MOTOR_NOT_STOP,
  DispenseStatus.MOTOR_NOT_EXIST,
  DispenseStatus.ELEVATOR_ERROR,
  DispenseStatus.ELEVATOR_ASCENDING_ERROR,
  DispenseStatus.ELEVATOR_DESCENDING_ERROR,
  DispenseStatus.MW_DELIVERY_DOOR_CLOSING_ERROR,
  DispenseStatus.MW_INLET_DOOR_OPENING_ERROR,
  DispenseStatus.MW_INLET_DOOR_CLOSING_ERROR,
  DispenseStatus.NO_LUNCH_IN_MICROWAVE,
  DispenseStatus.STAYPOLE_RETURN_ERROR,
  DispenseStatus.STAYPOLE_PUSH_ERROR,
  DispenseStatus.ELEVATOR_ENTER_MW_ERROR,
  DispenseStatus.ELEVATOR_EXIT_MW_ERROR,
  DispenseStatus.PUSHROD_PUSH_ERROR,
  DispenseStatus.PUSHROD_RETURN_ERROR,
  DispenseStatus.PURCHASE_TERMINATED,
]);

/**
 * Parse command 0x04 dispensing status.
 *
 * Varian PDF:
 * - length 5: PackNO + Status + selection(2) + Microwave number(1)
 * - length 3: PackNO + Status… (dokumentasi campur; kita dukung PackNO+Status+sel hi jika ada)
 *
 * Implementasi ketat untuk length >= 4 (PackNO + status + sel2), microwave opsional.
 */
export function parseDispenseStatusFrame(
  frame: VmcFrame,
  endian: SelectionEndian = DEFAULT_SELECTION_ENDIAN
): DispenseStatusEvent | null {
  if ((frame.cmd & 0xff) !== VmcCmd.DISPENSE_STATUS) return null;
  const p = frame.payload;
  if (p.length < 4) return null;

  const status = p[1] & 0xff;
  const selectionNumber = bytesToSelectionNumber(p[2], p[3], endian);
  const microwaveNumber = p.length >= 5 ? p[4] & 0xff : null;

  const isSuccess = SUCCESS_STATUSES.has(status);
  const isFailure = FAILURE_STATUSES.has(status);
  const isProgress = !isSuccess && !isFailure;

  const heatingRemainingSec =
    status === DispenseStatus.LUNCH_HEATING_REMAINING && microwaveNumber != null
      ? microwaveNumber
      : null;

  return {
    status,
    statusLabel: DISPENSE_STATUS_LABELS[status] || `Unknown status 0x${status.toString(16)}`,
    selectionNumber,
    microwaveNumber,
    isSuccess,
    isFailure,
    isProgress,
    heatingRemainingSec,
  };
}

export function dispenseStatusLabel(status: number): string {
  return DISPENSE_STATUS_LABELS[status] || `Unknown status 0x${(status & 0xff).toString(16)}`;
}

/** true jika frame adalah reply 0x71 tipe 0x32 untuk operasi tertentu. */
export function isJammedSelectionReply(frame: VmcFrame, operation: number): boolean {
  const p = frame.payload;
  return (
    (frame.cmd & 0xff) === VmcCmd.MENU_REPLY &&
    p.length >= 3 &&
    p[1] === JammedSelectionMenu.TYPE &&
    p[2] === (operation & 0xff)
  );
}

/**
 * Parse reply 4.5.32 tanya jammed (0x71, operasi 0x00).
 * Payload: PackNO + 0x32 + 0x00 + jumlah + selection(2)… + jumlah belt + selection(2)…
 * Bagian belt boleh tidak ada. null jika jumlah tidak cocok dengan panjang payload.
 */
export function parseJammedQueryReply(
  frame: VmcFrame,
  endian: SelectionEndian = DEFAULT_SELECTION_ENDIAN
): JammedQueryResult | null {
  if (!isJammedSelectionReply(frame, JammedSelectionMenu.QUERY)) return null;
  const p = frame.payload;

  const jammed = readSelectionList(p, 3, endian);
  if (!jammed) return null;
  const belt =
    jammed.next < p.length ? readSelectionList(p, jammed.next, endian) : { codes: [], next: p.length };
  if (!belt) return null;

  return { packNo: p[0] & 0xff, jammed: jammed.codes, beltFailed: belt.codes };
}

/** Parse reply 4.5.32 clear jammed (0x71, operasi 0x01). Status 0x00 = berhasil. */
export function parseJammedClearReply(frame: VmcFrame): JammedClearResult | null {
  if (!isJammedSelectionReply(frame, JammedSelectionMenu.CLEAR)) return null;
  const p = frame.payload;
  if (p.length < 4) return null;
  return { packNo: p[0] & 0xff, ok: p[3] === 0x00 };
}

/** Baca "jumlah(1) + selection(2)…" mulai offset `at`. */
function readSelectionList(
  p: Uint8Array,
  at: number,
  endian: SelectionEndian
): { codes: number[]; next: number } | null {
  if (at >= p.length) return null;
  const count = p[at] & 0xff;
  const next = at + 1 + count * 2;
  if (next > p.length) return null;

  const codes: number[] = [];
  for (let i = at + 1; i < next; i += 2) {
    codes.push(bytesToSelectionNumber(p[i], p[i + 1], endian));
  }
  return { codes, next };
}

/**
 * Parse reply 4.3.1 (command 0x02).
 * Payload: PackNO + result + selection(2). Length PDF = 4.
 * result 0x01 = Normal (siap); 0x02 habis; 0x03 slot tidak ada; dst.
 */
export function parseCheckSelectionResult(
  frame: VmcFrame,
  endian: SelectionEndian = DEFAULT_SELECTION_ENDIAN
): CheckSelectionResult | null {
  if ((frame.cmd & 0xff) !== VmcCmd.CHECK_SELECTION_RESULT) return null;
  const p = frame.payload;
  if (p.length < 2) return null;

  const packNo = p[0] & 0xff;
  const result = p[1] & 0xff;
  const selectionNumber =
    p.length >= 4 ? bytesToSelectionNumber(p[2], p[3], endian) : null;

  return {
    packNo,
    result,
    selectionNumber,
    ok: result === CheckSelectionResultCode.OK,
    statusLabel:
      CHECK_SELECTION_RESULT_LABELS[result] ||
      `Slot tidak siap (kode 0x${result.toString(16)})`,
  };
}
