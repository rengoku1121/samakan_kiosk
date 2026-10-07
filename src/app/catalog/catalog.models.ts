/** Slot mentah dari mesin / mock — satu kompartemen fisik */
export type CatalogSlot = {
  slot_code: string;
  product_code: string;
  product_name: string;
  price: number;
  stock: number;
  tag?: string;
  image_url: string;
  desc: string;
  /** true = kiosk wajib pilih dipanaskan */
  requires_heating: boolean;
};

/** Satu kartu di UI: produk unik, stok digabung dari beberapa slot */
export type CatalogProduct = {
  product_code: string;
  product_name: string;
  price: number;
  /** Total stok semua slot untuk SKU ini */
  stock: number;
  tag?: string;
  image_url: string;
  desc: string;
  requires_heating: boolean;
  /** Slot fisik yang masih ada stok (urut slot_code) */
  available_slots: string[];
  /** Semua slot yang memuat SKU ini */
  slot_codes: string[];
};

export type CatalogMode = 'product' | 'slot';

/**
 * Denah fisik mesin XY: 8 baris × 4 kolom.
 * Baris 1 = 001–004, baris 2 = 011–014, … baris 8 = 071–074.
 */
export const MACHINE_LAYOUT_ROWS = 8;
export const MACHINE_LAYOUT_COLS = 4;

/** Satu posisi di denah mesin; `slot` null = posisi tanpa produk aktif. */
export type MachineLayoutCell = {
  slot_code: string;
  /** 1-based, sesuai baris rak dari atas. */
  row: number;
  /** 1-based, sesuai kolom dari kiri. */
  col: number;
  slot: CatalogSlot | null;
};

/** "13" / "0013" → "013" agar cocok dengan nomor di mesin. */
export function normalizeSlotCode(code: string | number): string {
  const raw = String(code ?? '').trim();
  if (!/^\d+$/.test(raw)) return raw.toUpperCase();
  return String(Number.parseInt(raw, 10)).padStart(3, '0');
}

/** Urutan nomor slot mengikuti posisi fisik, kiri-atas ke kanan-bawah. */
export function buildMachineLayoutCodes(
  rows = MACHINE_LAYOUT_ROWS,
  cols = MACHINE_LAYOUT_COLS
): string[] {
  const codes: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= cols; c++) {
      codes.push(normalizeSlotCode(r * 10 + c));
    }
  }
  return codes;
}

/**
 * Petakan slot API ke denah fisik. Posisi tanpa slot tetap dibuat
 * supaya susunan di layar tidak bergeser dari mesin.
 */
export function buildMachineLayout(
  slots: CatalogSlot[],
  rows = MACHINE_LAYOUT_ROWS,
  cols = MACHINE_LAYOUT_COLS
): MachineLayoutCell[] {
  const byCode = new Map<string, CatalogSlot>();
  for (const slot of slots) {
    byCode.set(normalizeSlotCode(slot.slot_code), slot);
  }

  const cells: MachineLayoutCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const slot_code = normalizeSlotCode(r * 10 + c);
      cells.push({
        slot_code,
        row: r + 1,
        col: c,
        slot: byCode.get(slot_code) || null,
      });
    }
  }
  return cells;
}

/** Slot yang nomornya di luar denah 8×4 — tetap ditampilkan terpisah. */
export function slotsOutsideLayout(
  slots: CatalogSlot[],
  rows = MACHINE_LAYOUT_ROWS,
  cols = MACHINE_LAYOUT_COLS
): CatalogSlot[] {
  const layout = new Set(buildMachineLayoutCodes(rows, cols));
  return sortSlots(slots.filter((s) => !layout.has(normalizeSlotCode(s.slot_code))));
}

/** Pilihan user untuk checkout / dispense */
export type CatalogSelection = {
  product_code: string;
  product_name: string;
  price: number;
  /** Stok yang ditampilkan di dock (agregat atau per-slot) */
  stock: number;
  image_url: string;
  desc: string;
  /** Slot konkret untuk order/dispense */
  slot_code: string;
  catalog_mode: CatalogMode;
  requires_heating: boolean;
  /** Diisi di halaman confirm; dikirim ke API order */
  heat_requested?: boolean | null;
};

export function normalizeCatalogMode(v: unknown): CatalogMode {
  return String(v || '').trim().toLowerCase() === 'slot' ? 'slot' : 'product';
}

export function sortSlots(slots: CatalogSlot[]): CatalogSlot[] {
  return [...slots].sort((a, b) =>
    a.slot_code.localeCompare(b.slot_code, undefined, { numeric: true })
  );
}

/**
 * Gabung slot dengan product_code sama jadi satu kartu produk.
 * Slot assign: slot pertama yang stok > 0 (urut kode).
 */
export function groupSlotsByProduct(slots: CatalogSlot[]): CatalogProduct[] {
  const map = new Map<string, CatalogSlot[]>();

  for (const slot of slots) {
    const key = String(slot.product_code || '').trim() || slot.product_name;
    const list = map.get(key) || [];
    list.push(slot);
    map.set(key, list);
  }

  const products: CatalogProduct[] = [];

  for (const [product_code, group] of map) {
    const sorted = [...group].sort((a, b) =>
      a.slot_code.localeCompare(b.slot_code, undefined, { numeric: true })
    );
    const head = sorted[0];
    const stock = sorted.reduce((sum, s) => sum + Math.max(0, Number(s.stock) || 0), 0);
    const available_slots = sorted
      .filter((s) => Number(s.stock) > 0)
      .map((s) => s.slot_code);
    const withTag = sorted.find((s) => s.tag && Number(s.stock) > 0) || sorted.find((s) => s.tag);
    // Harga: pakai harga slot yang masih ada stok (atau slot pertama)
    const priced =
      sorted.find((s) => Number(s.stock) > 0) || head;

    products.push({
      product_code,
      product_name: head.product_name,
      price: Number(priced.price) || 0,
      stock,
      tag: stock <= 0 ? 'Habis' : withTag?.tag,
      image_url: head.image_url,
      desc: head.desc,
      requires_heating: sorted.some((s) => Boolean(s.requires_heating)),
      available_slots,
      slot_codes: sorted.map((s) => s.slot_code),
    });
  }

  // Habis di belakang, lalu nama A–Z
  products.sort((a, b) => {
    if ((a.stock > 0) !== (b.stock > 0)) return a.stock > 0 ? -1 : 1;
    return a.product_name.localeCompare(b.product_name, 'id');
  });

  return products;
}

/** Pilih slot dispense untuk produk (slot tersedia pertama). */
export function pickSlotForProduct(product: CatalogProduct): string | null {
  return product.available_slots[0] || null;
}

/**
 * Hanya true/1 yang berarti panaskan.
 * Jangan pakai Boolean() — Boolean("false") === true.
 */
export function wantsHeat(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}
