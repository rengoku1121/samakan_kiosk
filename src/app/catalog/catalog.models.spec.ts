import {
  buildMachineLayout,
  buildMachineLayoutCodes,
  CatalogSlot,
  MACHINE_LAYOUT_COLS,
  MACHINE_LAYOUT_ROWS,
  normalizeSlotCode,
  slotsOutsideLayout,
} from './catalog.models';

const slot = (slot_code: string, over: Partial<CatalogSlot> = {}): CatalogSlot => ({
  slot_code,
  product_code: `SKU-${slot_code}`,
  product_name: `Menu ${slot_code}`,
  price: 15000,
  stock: 2,
  image_url: '',
  desc: '',
  requires_heating: false,
  ...over,
});

describe('Denah slot mesin', () => {
  it('membuat urutan 001-004 sampai 071-074', () => {
    const codes = buildMachineLayoutCodes();
    expect(codes.length).toBe(MACHINE_LAYOUT_ROWS * MACHINE_LAYOUT_COLS);
    expect(codes.slice(0, 4)).toEqual(['001', '002', '003', '004']);
    expect(codes.slice(4, 8)).toEqual(['011', '012', '013', '014']);
    expect(codes.slice(-4)).toEqual(['071', '072', '073', '074']);
  });

  it('menormalkan kode ke 3 digit', () => {
    expect(normalizeSlotCode('13')).toBe('013');
    expect(normalizeSlotCode(74)).toBe('074');
    expect(normalizeSlotCode(' 001 ')).toBe('001');
  });

  it('menempatkan slot 013 di baris 2 kolom 3 dan 074 di baris terakhir', () => {
    const cells = buildMachineLayout([slot('13'), slot('074')]);

    const cell013 = cells.find((c) => c.slot_code === '013');
    expect(cell013?.row).toBe(2);
    expect(cell013?.col).toBe(3);
    expect(cell013?.slot?.slot_code).toBe('13');

    const cell074 = cells.find((c) => c.slot_code === '074');
    expect(cell074?.row).toBe(MACHINE_LAYOUT_ROWS);
    expect(cell074?.col).toBe(MACHINE_LAYOUT_COLS);
    expect(cell074?.slot).toBeTruthy();
  });

  it('posisi tanpa produk tetap ada sebagai placeholder', () => {
    const cells = buildMachineLayout([slot('001')]);
    expect(cells.length).toBe(MACHINE_LAYOUT_ROWS * MACHINE_LAYOUT_COLS);
    expect(cells[0].slot).toBeTruthy();
    expect(cells[1].slot).toBeNull();
  });

  it('slot di luar denah dipisahkan', () => {
    const extras = slotsOutsideLayout([slot('001'), slot('105'), slot('A1')]);
    expect(extras.map((s) => s.slot_code)).toEqual(['105', 'A1']);
  });
});
