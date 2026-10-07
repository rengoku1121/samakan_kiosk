/** Endian untuk selection number 2-byte di frame VMC. */
export type SelectionEndian = 'BE' | 'LE';

/** Frame VMC yang sudah di-parse. */
export type VmcFrame = {
  /** Command byte (mis. 0x06). */
  cmd: number;
  /** Panjang PackNO+Text. */
  length: number;
  /** Isi PackNO+Text (tanpa STX/CMD/LEN/XOR). */
  payload: Uint8Array;
  /** Byte XOR di akhir paket. */
  xor: number;
  /** Seluruh paket termasuk STX…XOR. */
  raw: Uint8Array;
};

export type DriveSelectionOptions = {
  packNo: number;
  /** Selection / slot_code Samakan, mis. "013" atau 13. */
  slotCode: string | number;
  /**
   * true  → enable elevator (jalur lift/microwave, asumsi heat)
   * false → elevator off (kandidat skip heat — perlu uji mesin)
   */
  heatRequested: boolean;
  /** Default true (PDF: enable drop sensor). */
  enableDropSensor?: boolean;
  endian?: SelectionEndian;
};

export type SelectToBuyOptions = {
  packNo: number;
  slotCode: string | number;
  endian?: SelectionEndian;
};

export type DispenseStatusEvent = {
  /** Status byte dari command 0x04. */
  status: number;
  /** Label human-readable jika dikenal. */
  statusLabel: string;
  selectionNumber: number;
  /** Ada di varian length=5; null jika frame length=3. */
  microwaveNumber: number | null;
  /** true jika status dianggap sukses akhir. */
  isSuccess: boolean;
  /** true jika status dianggap gagal terminal. */
  isFailure: boolean;
  /** true jika masih proses (heating, elevator, …). */
  isProgress: boolean;
  /** Untuk status 0x23: sisa detik heating (di byte microwave / field terkait). */
  heatingRemainingSec: number | null;
};

/** Operasi 4.5.32: tanya daftar slot jammed, atau bersihkan. */
export type JammedSelectionOperation = 'query' | 'clear';

/** Balasan 0x71 untuk tanya jammed (operasi 0x00). */
export type JammedQueryResult = {
  packNo: number;
  /** Selection number yang tercatat jammed. */
  jammed: number[];
  /** Selection belt yang gagal self-test. */
  beltFailed: number[];
};

/** Balasan 0x71 untuk clear jammed (operasi 0x01). */
export type JammedClearResult = {
  packNo: number;
  /** Status 0x00 = berhasil, 0x01 = gagal. */
  ok: boolean;
};

/** Hasil 4.3.1 reply (command 0x02). */
export type CheckSelectionResult = {
  packNo: number;
  result: number;
  selectionNumber: number | null;
  ok: boolean;
  statusLabel: string;
};
