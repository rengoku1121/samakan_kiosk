import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { CatalogSelection, wantsHeat } from '../catalog/catalog.models';
import { CreateOrderResult } from './kiosk-api.service';

export type PaymentSessionStatus =
  | 'PENDING'
  | 'PAID'
  | 'DISPENSING'
  | 'DISPENSED'
  | 'DISPENSE_FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export type PaymentSession = {
  is_mock: boolean;
  order_code: string;
  product_name: string;
  price: number;
  heat_requested: boolean;
  slot_code: string;
  qr_image_url: string;
  expires_at: string;
  status: PaymentSessionStatus;
  payment_ref?: string | null;
  dispense_detail?: string | null;
};

const STORAGE_KEY = 'samakan.kiosk.session';
/** Sesi lebih tua dari ini dianggap basi; pelanggan pasti sudah pergi. */
const RESUME_MAX_AGE_MS = 30 * 60 * 1000;
/** Status yang berarti uang sudah masuk tapi barang belum tentu keluar. */
const RESUMABLE_STATUSES: PaymentSessionStatus[] = ['PAID', 'DISPENSING'];

@Injectable({ providedIn: 'root' })
export class KioskPaymentService {
  private session: PaymentSession | null = null;
  private savedAt = 0;

  constructor() {
    this.restore();
  }

  get(): PaymentSession | null {
    return this.session ? { ...this.session } : null;
  }

  /**
   * Sesi sudah dibayar tapi belum selesai dispense — biasanya karena aplikasi
   * mati atau listrik padam di tengah jalan. Harus dilanjutkan, bukan dibuang.
   */
  get resumable(): PaymentSession | null {
    if (!this.session) return null;
    if (!RESUMABLE_STATUSES.includes(this.session.status)) return null;
    if (Date.now() - this.savedAt > RESUME_MAX_AGE_MS) return null;
    return { ...this.session };
  }

  clear(): void {
    this.session = null;
    this.savedAt = 0;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* abaikan */
    }
  }

  private persist(): void {
    if (!this.session) return;
    this.savedAt = Date.now();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ session: this.session, savedAt: this.savedAt })
      );
    } catch {
      /* storage penuh — sesi tetap hidup selama app belum ditutup */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { session?: PaymentSession; savedAt?: number };
      if (!parsed?.session?.order_code) return;
      this.session = parsed.session;
      this.savedAt = Number(parsed.savedAt) || 0;
    } catch {
      this.session = null;
      this.savedAt = 0;
    }
  }

  /** Session dari POST /api/v1/machines/:code/orders */
  setFromOrder(selection: CatalogSelection, order: CreateOrderResult): PaymentSession {
    const heat = wantsHeat(selection.heat_requested);
    const expires_at = this.normalizeExpiry(order.expires_at);
    const qr_image_url = this.resolveQrImage(order.qr_image_url, order.qr_string, order.order_code);

    const session: PaymentSession = {
      is_mock: false,
      order_code: order.order_code,
      product_name: selection.product_name,
      price: order.total > 0 ? order.total : selection.price,
      heat_requested: heat,
      slot_code: selection.slot_code,
      qr_image_url,
      expires_at,
      status: 'PENDING',
      payment_ref: order.payment_ref,
      dispense_detail: null,
    };
    this.session = session;
    this.persist();
    return { ...session };
  }

  markPaid(): void {
    if (!this.session) return;
    this.session = { ...this.session, status: 'PAID' };
    this.persist();
  }

  markDispensing(): void {
    if (!this.session) return;
    this.session = { ...this.session, status: 'DISPENSING', dispense_detail: null };
    this.persist();
  }

  markDispensed(detail?: string | null): void {
    if (!this.session) return;
    this.session = {
      ...this.session,
      status: 'DISPENSED',
      dispense_detail: detail ?? null,
    };
    this.persist();
  }

  markDispenseFailed(detail?: string | null): void {
    if (!this.session) return;
    this.session = {
      ...this.session,
      status: 'DISPENSE_FAILED',
      dispense_detail: detail ?? null,
    };
    this.persist();
  }

  markExpired(): void {
    if (!this.session) return;
    this.session = { ...this.session, status: 'EXPIRED' };
    this.persist();
  }

  markCancelled(): void {
    if (!this.session) return;
    this.session = { ...this.session, status: 'CANCELLED' };
    this.persist();
  }

  private normalizeExpiry(raw: string | null | undefined): string {
    if (raw) {
      const t = new Date(raw).getTime();
      if (!Number.isNaN(t)) return new Date(t).toISOString();
    }
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }

  private resolveQrImage(
    imageUrl: string | null,
    qrString: string | null,
    orderCode: string
  ): string {
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) return imageUrl;
    const data = qrString || orderCode;
    if (!environment.production && data) {
      return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(data)}`;
    }
    return '';
  }
}
