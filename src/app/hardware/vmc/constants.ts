/** Baud rate resmi PDF VMC ↔ upper computer. */
export const VMC_BAUD = 57600;

/** STX 2 byte. */
export const VMC_STX0 = 0xfa;
export const VMC_STX1 = 0xfb;

/** Command codes (VMC-Upper computer V3.0). */
export const VmcCmd = {
  /** 4.3.1 check selection — upper → VMC */
  CHECK_SELECTION: 0x01,
  /** 4.3.1 reply — VMC → upper */
  CHECK_SELECTION_RESULT: 0x02,
  /** 4.3.2 select to buy — upper → VMC */
  SELECT_TO_BUY: 0x03,
  /** 4.3.3 dispensing status — VMC → upper */
  DISPENSE_STATUS: 0x04,
  /** 4.3.4 select / cancel selection */
  SELECT_OR_CANCEL: 0x05,
  /** 4.3.5 drive selection directly — upper → VMC */
  DRIVE_SELECTION: 0x06,
  /** POLL — VMC → upper */
  POLL: 0x41,
  /** ACK */
  ACK: 0x42,
  /** Request machine status — upper → VMC */
  REQUEST_MACHINE_STATUS: 0x53,
  /** 4.5 menu command — upper → VMC */
  MENU_COMMAND: 0x70,
  /** 4.5 menu reply — VMC → upper */
  MENU_REPLY: 0x71,
} as const;

/** 4.5.32 Clear jammed selection: command type + byte operasi. */
export const JammedSelectionMenu = {
  TYPE: 0x32,
  QUERY: 0x00,
  CLEAR: 0x01,
} as const;

export type VmcCmdCode = (typeof VmcCmd)[keyof typeof VmcCmd];

/**
 * Byte hasil 4.3.1 reply (0x02).
 * PDF V3.0: 0x01 = Normal (siap). 0x00 BUKAN OK.
 */
export const CheckSelectionResultCode = {
  OK: 0x01,
  OUT_OF_STOCK: 0x02,
  SELECTION_NOT_EXIST: 0x03,
  SELECTION_PAUSE: 0x04,
  PRODUCT_IN_ELEVATOR: 0x05,
  DELIVERY_DOOR_UNLOCKED: 0x06,
  ELEVATOR_ERROR: 0x07,
  ELEVATOR_SELF_CHECK: 0x08,
  MW_DELIVERY_DOOR_CLOSING_ERROR: 0x09,
  MW_INLET_DOOR_OPENING_ERROR: 0x10,
  MW_INLET_DOOR_CLOSING_ERROR: 0x11,
  NO_LUNCH_IN_MICROWAVE: 0x12,
  LUNCH_HEATING: 0x13,
  MW_DELIVERY_DOOR_OPENING_ERROR: 0x14,
  TAKE_LUNCH_IN_MICROWAVE: 0x15,
  STAYPOLE_RETURN_ERROR: 0x16,
  MAIN_MOTOR_FAULT: 0x17,
  TRANSLATION_MOTOR_FAULT: 0x18,
  STAYPOLE_PUSH_ERROR: 0x19,
  ELEVATOR_ENTER_MW_ERROR: 0x20,
  ELEVATOR_EXIT_MW_ERROR: 0x21,
  PUSHROD_PUSH_ERROR: 0x22,
  PUSHROD_RETURN_ERROR: 0x23,
} as const;

export const CHECK_SELECTION_RESULT_LABELS: Record<number, string> = {
  [CheckSelectionResultCode.OK]: 'Slot siap',
  [CheckSelectionResultCode.OUT_OF_STOCK]: 'Stok slot habis',
  [CheckSelectionResultCode.SELECTION_NOT_EXIST]: 'Slot tidak ada di mesin',
  [CheckSelectionResultCode.SELECTION_PAUSE]: 'Slot sedang dinonaktifkan',
  [CheckSelectionResultCode.PRODUCT_IN_ELEVATOR]: 'Masih ada produk di elevator',
  [CheckSelectionResultCode.DELIVERY_DOOR_UNLOCKED]: 'Pintu ambil belum terkunci',
  [CheckSelectionResultCode.ELEVATOR_ERROR]: 'Error elevator',
  [CheckSelectionResultCode.ELEVATOR_SELF_CHECK]: 'Self-check elevator gagal',
  [CheckSelectionResultCode.MW_DELIVERY_DOOR_CLOSING_ERROR]: 'Pintu microwave gagal menutup',
  [CheckSelectionResultCode.MW_INLET_DOOR_OPENING_ERROR]: 'Pintu masuk microwave gagal buka',
  [CheckSelectionResultCode.MW_INLET_DOOR_CLOSING_ERROR]: 'Pintu masuk microwave gagal tutup',
  [CheckSelectionResultCode.NO_LUNCH_IN_MICROWAVE]: 'Kotak tidak terdeteksi di pemanas',
  [CheckSelectionResultCode.LUNCH_HEATING]: 'Masih ada proses pemanas',
  [CheckSelectionResultCode.MW_DELIVERY_DOOR_OPENING_ERROR]: 'Pintu microwave gagal buka',
  [CheckSelectionResultCode.TAKE_LUNCH_IN_MICROWAVE]: 'Ambil dulu kotak di pemanas',
  [CheckSelectionResultCode.STAYPOLE_RETURN_ERROR]: 'Staypole gagal kembali',
  [CheckSelectionResultCode.MAIN_MOTOR_FAULT]: 'Motor utama error',
  [CheckSelectionResultCode.TRANSLATION_MOTOR_FAULT]: 'Motor geser error',
  [CheckSelectionResultCode.STAYPOLE_PUSH_ERROR]: 'Staypole gagal mendorong',
  [CheckSelectionResultCode.ELEVATOR_ENTER_MW_ERROR]: 'Elevator gagal masuk pemanas',
  [CheckSelectionResultCode.ELEVATOR_EXIT_MW_ERROR]: 'Elevator gagal keluar pemanas',
  [CheckSelectionResultCode.PUSHROD_PUSH_ERROR]: 'Pendorong di pemanas error',
  [CheckSelectionResultCode.PUSHROD_RETURN_ERROR]: 'Pendorong pemanas gagal kembali',
};

/**
 * Status byte pada command 0x04 (dispensing).
 * Tidak semua kode di-list; yang tidak dikenal tetap di-parse numeric.
 */
export const DispenseStatus = {
  DISPENSING: 0x01,
  SUCCESS: 0x02,
  SELECTION_JAMMED: 0x03,
  MOTOR_NOT_STOP: 0x04,
  MOTOR_NOT_EXIST: 0x06,
  ELEVATOR_ERROR: 0x07,
  ELEVATOR_ASCENDING: 0x10,
  ELEVATOR_DESCENDING: 0x11,
  ELEVATOR_ASCENDING_ERROR: 0x12,
  ELEVATOR_DESCENDING_ERROR: 0x13,
  MW_DELIVERY_DOOR_CLOSING: 0x14,
  MW_DELIVERY_DOOR_CLOSING_ERROR: 0x15,
  MW_INLET_DOOR_OPENING: 0x16,
  MW_INLET_DOOR_OPENING_ERROR: 0x17,
  PUSHING_INTO_MICROWAVE: 0x18,
  MW_INLET_DOOR_CLOSING: 0x19,
  MW_INLET_DOOR_CLOSING_ERROR: 0x20,
  NO_LUNCH_IN_MICROWAVE: 0x21,
  LUNCH_HEATING: 0x22,
  /** Sisa detik heating — nilai detik biasanya di field microwave number. */
  LUNCH_HEATING_REMAINING: 0x23,
  /** Ambil lunch box — pembelian sukses */
  TAKE_LUNCH_BOX: 0x24,
  STAYPOLE_RETURN_ERROR: 0x25,
  MW_DELIVERY_DOOR_OPENING: 0x26,
  STAYPOLE_PUSH_ERROR: 0x28,
  ELEVATOR_ENTER_MW_ERROR: 0x29,
  ELEVATOR_EXIT_MW_ERROR: 0x30,
  PUSHROD_PUSH_ERROR: 0x31,
  PUSHROD_RETURN_ERROR: 0x32,
  PURCHASE_TERMINATED: 0xff,
} as const;

export const DISPENSE_STATUS_LABELS: Record<number, string> = {
  [DispenseStatus.DISPENSING]: 'Dispensing',
  [DispenseStatus.SUCCESS]: 'Dispensing successfully',
  [DispenseStatus.SELECTION_JAMMED]: 'Selection jammed',
  [DispenseStatus.MOTOR_NOT_STOP]: "Motor doesn't stop normally",
  [DispenseStatus.MOTOR_NOT_EXIST]: "Motor doesn't exist",
  [DispenseStatus.ELEVATOR_ERROR]: 'Elevator error',
  [DispenseStatus.ELEVATOR_ASCENDING]: 'Elevator is ascending',
  [DispenseStatus.ELEVATOR_DESCENDING]: 'Elevator is descending',
  [DispenseStatus.ELEVATOR_ASCENDING_ERROR]: 'Elevator ascending error',
  [DispenseStatus.ELEVATOR_DESCENDING_ERROR]: 'Elevator descending error',
  [DispenseStatus.MW_DELIVERY_DOOR_CLOSING]: 'Microwave delivery door is closing',
  [DispenseStatus.MW_DELIVERY_DOOR_CLOSING_ERROR]: 'Microwave delivery door closing error',
  [DispenseStatus.MW_INLET_DOOR_OPENING]: 'Microwave inlet door is opening',
  [DispenseStatus.MW_INLET_DOOR_OPENING_ERROR]: 'Microwave inlet door opening error',
  [DispenseStatus.PUSHING_INTO_MICROWAVE]: 'Pushing lunch box into microwave',
  [DispenseStatus.MW_INLET_DOOR_CLOSING]: 'Microwave inlet door is closing',
  [DispenseStatus.MW_INLET_DOOR_CLOSING_ERROR]: 'Microwave inlet door closing error',
  [DispenseStatus.NO_LUNCH_IN_MICROWAVE]: "Don't detect lunch box in microwave",
  [DispenseStatus.LUNCH_HEATING]: 'Lunch box is heating',
  [DispenseStatus.LUNCH_HEATING_REMAINING]: 'Lunch box heating remaining time (sec)',
  [DispenseStatus.TAKE_LUNCH_BOX]: 'Please take out the lunch box (success)',
  [DispenseStatus.STAYPOLE_RETURN_ERROR]: 'Staypole return error',
  [DispenseStatus.MW_DELIVERY_DOOR_OPENING]: 'Microwave delivery door is opening',
  [DispenseStatus.STAYPOLE_PUSH_ERROR]: 'Staypole push error',
  [DispenseStatus.ELEVATOR_ENTER_MW_ERROR]: 'Elevator entering microwave oven error',
  [DispenseStatus.ELEVATOR_EXIT_MW_ERROR]: 'Elevator exiting microwave oven error',
  [DispenseStatus.PUSHROD_PUSH_ERROR]: 'Pushrod pushing error in microwave oven',
  [DispenseStatus.PUSHROD_RETURN_ERROR]: 'Pushrod returning error in microwave oven',
  [DispenseStatus.PURCHASE_TERMINATED]: 'Purchase terminated',
};

/** Default endian selection number (asumsi PDF/XY; bisa dibalik saat uji). */
export const DEFAULT_SELECTION_ENDIAN: 'BE' | 'LE' = 'BE';
