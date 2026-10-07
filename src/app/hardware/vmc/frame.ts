import { VMC_STX0, VMC_STX1 } from './constants';
import { VmcFrame } from './types';

export function clampByte(n: number): number {
  return n & 0xff;
}

export function clampPackNo(packNo: number): number {
  const n = Number(packNo);
  if (!Number.isInteger(n) || n < 1 || n > 255) {
    throw new Error(`packNo harus 1–255, dapat: ${packNo}`);
  }
  return n;
}

/** XOR semua byte (aturan PDF: dari STX sampai TEXT). */
export function xorBytes(bytes: ArrayLike<number>): number {
  let x = 0;
  for (let i = 0; i < bytes.length; i++) x ^= bytes[i] & 0xff;
  return x;
}

export function bytesToHex(bytes: ArrayLike<number>, sep = ' '): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push((bytes[i] & 0xff).toString(16).toUpperCase().padStart(2, '0'));
  }
  return parts.join(sep);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex length harus genap');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Bangun frame:
 * FA FB | CMD | LEN | PackNO+Text | XOR
 */
export function buildFrame(cmd: number, payload: ArrayLike<number>): Uint8Array {
  const cmdB = clampByte(cmd);
  const len = payload.length;
  if (len > 255) throw new Error('payload PackNO+Text terlalu panjang (>255)');

  const raw = new Uint8Array(4 + len + 1);
  raw[0] = VMC_STX0;
  raw[1] = VMC_STX1;
  raw[2] = cmdB;
  raw[3] = len;
  for (let i = 0; i < len; i++) raw[4 + i] = payload[i] & 0xff;
  raw[4 + len] = xorBytes(raw.subarray(0, 4 + len));
  return raw;
}

/**
 * Validasi 1 frame lengkap dari offset buffer.
 * return null jika belum cukup byte / XOR salah / STX tidak cocok.
 */
export function tryParseFrameAt(buf: ArrayLike<number>, offset = 0): VmcFrame | null {
  if (offset + 5 > buf.length) return null;
  if ((buf[offset] & 0xff) !== VMC_STX0 || (buf[offset + 1] & 0xff) !== VMC_STX1) {
    return null;
  }

  const cmd = buf[offset + 2] & 0xff;
  const length = buf[offset + 3] & 0xff;
  const total = 4 + length + 1;
  if (offset + total > buf.length) return null;

  const body = [];
  for (let i = 0; i < 4 + length; i++) body.push(buf[offset + i] & 0xff);
  const expectedXor = xorBytes(body);
  const xor = buf[offset + 4 + length] & 0xff;
  if (xor !== expectedXor) return null;

  const payload = new Uint8Array(length);
  for (let i = 0; i < length; i++) payload[i] = buf[offset + 4 + i] & 0xff;

  const raw = new Uint8Array(total);
  for (let i = 0; i < total; i++) raw[i] = buf[offset + i] & 0xff;

  return { cmd, length, payload, xor, raw };
}

/**
 * Scan buffer serial: cari semua frame valid (loncati byte sampah).
 * Mengembalikan frames + sisa byte yang belum lengkap.
 */
export function parseFrames(buf: ArrayLike<number>): {
  frames: VmcFrame[];
  rest: Uint8Array;
} {
  const frames: VmcFrame[] = [];
  let i = 0;
  const len = buf.length;

  while (i < len) {
    if ((buf[i] & 0xff) !== VMC_STX0) {
      i += 1;
      continue;
    }
    if (i + 1 >= len) break;
    if ((buf[i + 1] & 0xff) !== VMC_STX1) {
      i += 1;
      continue;
    }

    const frame = tryParseFrameAt(buf, i);
    if (!frame) {
      // Belum lengkap, atau XOR gagal.
      if (i + 4 <= len) {
        const declared = buf[i + 3] & 0xff;
        const need = 4 + declared + 1;
        if (i + need > len) {
          // tunggu byte lagi
          break;
        }
        // XOR/format salah — loncati STX0
        i += 1;
        continue;
      }
      break;
    }

    frames.push(frame);
    i += frame.raw.length;
  }

  const rest = new Uint8Array(Math.max(0, len - i));
  for (let j = 0; j < rest.length; j++) rest[j] = buf[i + j] & 0xff;
  return { frames, rest };
}
