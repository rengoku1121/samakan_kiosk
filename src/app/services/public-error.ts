import { HttpErrorResponse } from '@angular/common/http';

/** Foto cadangan lokal — jangan tarik Unsplash di mesin produksi. */
export const MENU_PLACEHOLDER = 'assets/img/menu-placeholder.svg';

const TECHNICAL =
  /https?:\/\/|\/api\/v1|\blocalhost\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|Http failure|Unknown Error|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|status:\s*0|<!DOCTYPE|<html|\b0x[0-9a-f]{2}\b|\b(jammed|motor|elevator|microwave|staypole|pushrod|VMC|loopback|mock|stack|at\s+\w+\()/i;

function looksTechnical(msg: string): boolean {
  const t = msg.trim();
  if (!t) return true;
  if (t.length > 160) return true;
  return TECHNICAL.test(t);
}

function httpStatusMessage(status: number, fallback: string): string {
  if (status === 0) {
    return 'Tidak bisa terhubung ke server. Periksa jaringan mesin, lalu coba lagi.';
  }
  if (status === 401 || status === 403) {
    return 'Mesin belum terhubung ke server. Hubungi petugas.';
  }
  if (status === 404) {
    return 'Data tidak ditemukan. Coba lagi atau hubungi petugas.';
  }
  if (status === 408 || status === 504) {
    return 'Server lama merespons. Coba lagi.';
  }
  if (status === 429) {
    return 'Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.';
  }
  if (status >= 500) {
    return 'Server sedang bermasalah. Coba lagi beberapa saat.';
  }
  return fallback;
}

function bodyMessage(err: HttpErrorResponse): string {
  const raw = err.error;
  if (typeof raw === 'string' && !looksTechnical(raw)) return raw.trim();
  if (raw && typeof raw === 'object' && typeof raw.message === 'string') {
    const m = raw.message.trim();
    if (m && !looksTechnical(m)) return m;
  }
  return '';
}

/**
 * Pesan untuk layar pelanggan. Tidak boleh memuat URL, IP, atau teks HttpClient.
 */
export function publicErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    return bodyMessage(err) || httpStatusMessage(err.status, fallback);
  }
  if (err instanceof Error) {
    const m = err.message.trim();
    if (m && !looksTechnical(m)) return m;
  }
  return fallback;
}

/** Lubang masih terbuka setelah dispense — bukan kegagalan mesin. */
export const PICKUP_DOOR_WAIT_MESSAGE =
  'Mohon tunggu hingga lubang pengambilan tertutup. Setelah tertutup, silakan pilih menu kembali.';

/** Cek slot sebelum bayar — detail VMC disembunyikan dari pelanggan. */
export function publicSlotCheckMessage(detail: string | null | undefined): string {
  const d = String(detail || '').toLowerCase();
  if (!d) return 'Slot belum siap. Pilih menu lain atau coba lagi.';
  if (d.includes('habis') || d.includes('out of stock')) {
    return 'Menu di slot ini habis. Pilih menu lain.';
  }
  if (d.includes('tidak ada') || d.includes('not exist')) {
    return 'Slot tidak tersedia. Pilih menu lain.';
  }
  if (d.includes('dinonaktifkan') || d.includes('pause')) {
    return 'Slot sedang tidak aktif. Pilih menu lain.';
  }
  if (
    d.includes('pintu ambil') ||
    d.includes('delivery door') ||
    d.includes('lubang pengambilan')
  ) {
    return PICKUP_DOOR_WAIT_MESSAGE;
  }
  if (d.includes('elevator') && d.includes('produk')) {
    return 'Mesin masih memproses pesanan sebelumnya. Tunggu sebentar.';
  }
  if (d.includes('pemanas') || d.includes('heating') || d.includes('microwave')) {
    return 'Pemanas masih dipakai. Tunggu sebentar, lalu coba lagi.';
  }
  if (d.includes('timeout') || d.includes('tidak merespons') || d.includes('tidak dikenali')) {
    return 'Mesin tidak merespons. Coba lagi.';
  }
  return 'Slot belum siap. Pilih menu lain atau hubungi petugas.';
}

/** Gagal dispense setelah bayar — pelanggan hanya perlu tahu harus panggil petugas. */
export function publicDispenseFailureMessage(_detail?: string | null): string {
  return 'Pembayaran sudah lunas, tetapi produk belum keluar. Hubungi petugas dengan kode order di bawah.';
}
