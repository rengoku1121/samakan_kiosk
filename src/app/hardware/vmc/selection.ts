import { DEFAULT_SELECTION_ENDIAN } from './constants';
import { SelectionEndian } from './types';

/**
 * Parse slot_code Samakan / XY ("013", "13", 13) → integer 0..65535.
 */
export function parseSelectionNumber(slotCode: string | number): number {
  if (typeof slotCode === 'number') {
    if (!Number.isInteger(slotCode) || slotCode < 0 || slotCode > 0xffff) {
      throw new Error(`selection number di luar range: ${slotCode}`);
    }
    return slotCode;
  }

  const raw = String(slotCode || '').trim();
  if (!raw) throw new Error('slot_code kosong');

  // Izinkan "013", "13", "0x0D"
  const n = raw.toLowerCase().startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`slot_code tidak valid sebagai selection number: ${slotCode}`);
  }
  return n;
}

/** Format selection number ke label 3 digit seperti portal XY ("013"). */
export function formatSelectionCode(selectionNumber: number): string {
  const n = parseSelectionNumber(selectionNumber);
  return String(n).padStart(3, '0');
}

/**
 * Selection number → 2 byte.
 * BE (default): high byte dulu — 013 → 00 0D
 * LE: 013 → 0D 00
 */
export function selectionToBytes(
  slotCode: string | number,
  endian: SelectionEndian = DEFAULT_SELECTION_ENDIAN
): [number, number] {
  const n = parseSelectionNumber(slotCode);
  const hi = (n >> 8) & 0xff;
  const lo = n & 0xff;
  return endian === 'BE' ? [hi, lo] : [lo, hi];
}

export function bytesToSelectionNumber(
  b0: number,
  b1: number,
  endian: SelectionEndian = DEFAULT_SELECTION_ENDIAN
): number {
  return endian === 'BE' ? ((b0 & 0xff) << 8) | (b1 & 0xff) : ((b1 & 0xff) << 8) | (b0 & 0xff);
}
