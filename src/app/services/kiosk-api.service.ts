import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, catchError, throwError, timeout } from 'rxjs';
import {
  CatalogMode,
  CatalogSlot,
  normalizeCatalogMode,
} from '../catalog/catalog.models';
import { KioskConfigService } from './kiosk-config.service';
import { MENU_PLACEHOLDER, publicErrorMessage } from './public-error';

export type CatalogUi = {
  catalog_columns: number;
  catalog_mode: CatalogMode;
};

export type MachineCatalog = {
  machine: {
    machine_code: string;
    machine_name: string;
  };
  ui: CatalogUi;
  slots: CatalogSlot[];
};

export type CreateOrderRequest = {
  slot_code: string;
  qty?: number;
  heat_requested: boolean;
};

export type CreateOrderResult = {
  order_code: string;
  machine_code: string;
  status: string;
  total: number;
  created_at?: string | null;
  expires_at: string | null;
  payment_ref: string | null;
  qr_image_url: string | null;
  qr_string: string | null;
  provider: string | null;
};

export type OrderStatusResult = {
  order_code: string;
  status: string;
  total: number;
  paid_at: string | null;
  expires_at: string | null;
};

export type DispenseResultStatus = 'DISPENSED' | 'DISPENSE_FAILED';

export type DispenseResultResponse = {
  order_code: string;
  status: string;
};

export type CancelOrderResult = {
  order_code: string;
  status: string;
  cancelled: boolean;
};

type CatalogApiResponse = {
  success: boolean;
  data?: {
    machine?: {
      machine_code?: string;
      machine_name?: string;
    };
    ui?: { catalog_columns?: number; catalog_mode?: string };
    slots?: Array<{
      slot_code?: string;
      product_code?: string;
      product_name?: string;
      description?: string;
      image_url?: string | null;
      price?: number;
      stock?: number;
      requires_heating?: boolean;
      is_active?: boolean;
    }>;
  };
  message?: string;
};

type CreateOrderApiResponse = {
  success: boolean;
  message?: string;
  data?: {
    order?: {
      order_id?: string;
      machine_code?: string;
      status?: string;
      total?: number;
      created_at?: string | null;
      expires_at?: string | null;
    };
    payment?: {
      provider?: string | null;
      payment_ref?: string | null;
      qr_image_url?: string | null;
      qr_string?: string | null;
      gross_amount?: number;
      expires_at?: string | null;
    };
  };
};

type OrderStatusApiResponse = {
  success: boolean;
  message?: string;
  data?: {
    order_id?: string;
    status?: string;
    total?: number;
    paid_at?: string | null;
    expires_at?: string | null;
  };
};

type DispenseResultApiResponse = {
  success: boolean;
  message?: string;
  data?: {
    order_id?: string;
    status?: string;
  };
};

type CancelOrderApiResponse = {
  success: boolean;
  message?: string;
  data?: {
    order_id?: string;
    status?: string;
    cancelled?: boolean;
  };
};

const FALLBACK_IMAGE = MENU_PLACEHOLDER;

@Injectable({ providedIn: 'root' })
export class KioskApiService {
  constructor(
    private readonly http: HttpClient,
    private readonly config: KioskConfigService
  ) {}

  private get baseUrl(): string {
    return this.config.apiBaseUrl;
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Kiosk-Internal-Token': this.config.kioskToken,
    });
  }

  private mapUi(ui?: { catalog_columns?: number; catalog_mode?: string }): CatalogUi {
    const raw = Number(ui?.catalog_columns ?? 2);
    const cols = Number.isInteger(raw) ? Math.min(4, Math.max(2, raw)) : 2;
    return {
      catalog_columns: cols,
      catalog_mode: normalizeCatalogMode(ui?.catalog_mode),
    };
  }

  private apiError(err: unknown, fallback: string): Error {
    return new Error(publicErrorMessage(err, fallback));
  }

  getCatalogUi(): Observable<CatalogUi> {
    const url = `${this.baseUrl}/api/v1/kiosk/ui`;
    return this.http.get<CatalogApiResponse>(url, { headers: this.headers() }).pipe(
      map((res) => this.mapUi(res?.data?.ui))
    );
  }

  getCatalog(machineCode = this.config.machineCode): Observable<MachineCatalog> {
    const url = `${this.baseUrl}/api/v1/machines/${encodeURIComponent(machineCode)}/catalog`;
    return this.http.get<CatalogApiResponse>(url, { headers: this.headers() }).pipe(
      map((res) => {
        if (!res?.success || !res.data) {
          throw new Error(res?.message || 'Gagal memuat katalog');
        }
        const slots: CatalogSlot[] = (res.data.slots || [])
          .filter((s) => s && s.is_active !== false)
          .map((s) => ({
            slot_code: String(s.slot_code || '').trim(),
            product_code: String(s.product_code || '').trim(),
            product_name: String(s.product_name || 'Menu').trim(),
            price: Number(s.price) || 0,
            stock: Math.max(0, Number(s.stock) || 0),
            requires_heating: Boolean(s.requires_heating),
            desc: String(s.description || '').trim(),
            image_url: String(s.image_url || '').trim() || FALLBACK_IMAGE,
            tag: Number(s.stock) <= 0 ? 'Habis' : undefined,
          }))
          .filter((s) => s.slot_code && s.product_code);

        return {
          machine: {
            machine_code: String(res.data.machine?.machine_code || machineCode),
            machine_name: String(res.data.machine?.machine_name || ''),
          },
          ui: this.mapUi(res.data.ui),
          slots,
        };
      }),
      catchError((err) => throwError(() => this.apiError(err, 'Gagal memuat katalog')))
    );
  }

  /**
   * POST /api/v1/machines/:machineCode/orders
   * Body: { slot_code, qty, heat_requested }
   */
  createOrder(
    body: CreateOrderRequest,
    machineCode = this.config.machineCode
  ): Observable<CreateOrderResult> {
    const url = `${this.baseUrl}/api/v1/machines/${encodeURIComponent(machineCode)}/orders`;
    const payload = {
      slot_code: String(body.slot_code || '').trim(),
      qty: body.qty && body.qty > 0 ? Math.floor(body.qty) : 1,
      heat_requested: body.heat_requested === true,
    };

    return this.http
      .post<CreateOrderApiResponse>(url, payload, { headers: this.headers() })
      .pipe(
        map((res) => {
          if (!res?.success || !res.data?.order) {
            throw new Error(res?.message || 'Gagal membuat order');
          }
          const order = res.data.order;
          const payment = res.data.payment || {};
          const orderCode = String(order.order_id || '').trim();
          if (!orderCode) throw new Error('Respons order tidak valid');

          return {
            order_code: orderCode,
            machine_code: String(order.machine_code || machineCode),
            status: String(order.status || 'PENDING'),
            total: Number(payment.gross_amount ?? order.total) || 0,
            created_at: order.created_at ?? null,
            expires_at: (payment.expires_at || order.expires_at || null) as string | null,
            payment_ref: payment.payment_ref ? String(payment.payment_ref) : null,
            qr_image_url: payment.qr_image_url ? String(payment.qr_image_url) : null,
            qr_string: payment.qr_string ? String(payment.qr_string) : null,
            provider: payment.provider ? String(payment.provider) : null,
          };
        }),
        catchError((err) => throwError(() => this.apiError(err, 'Gagal membuat order / QRIS')))
      );
  }

  /**
   * GET /api/v1/orders/:orderCode/status
   * Polling status pembayaran (sinkron Midtrans bila webhook belum masuk).
   */
  getOrderStatus(orderCode: string): Observable<OrderStatusResult> {
    const code = String(orderCode || '').trim();
    const url = `${this.baseUrl}/api/v1/orders/${encodeURIComponent(code)}/status`;
    return this.http.get<OrderStatusApiResponse>(url, { headers: this.headers() }).pipe(
      map((res) => {
        if (!res?.success || !res.data) {
          throw new Error(res?.message || 'Gagal cek status order');
        }
        return {
          order_code: String(res.data.order_id || code),
          status: String(res.data.status || 'PENDING').toUpperCase(),
          total: Number(res.data.total) || 0,
          paid_at: res.data.paid_at ?? null,
          expires_at: res.data.expires_at ?? null,
        };
      }),
      catchError((err) => throwError(() => this.apiError(err, 'Gagal cek status order')))
    );
  }

  /**
   * POST /api/v1/orders/:orderCode/cancel
   * Batalkan QR + lepas hold. Jika sudah PAID, status tetap PAID (kiosk ke dispense).
   */
  cancelOrder(orderCode: string): Observable<CancelOrderResult> {
    const code = String(orderCode || '').trim();
    const url = `${this.baseUrl}/api/v1/orders/${encodeURIComponent(code)}/cancel`;
    return this.http.post<CancelOrderApiResponse>(url, {}, { headers: this.headers() }).pipe(
      timeout(4000),
      map((res) => {
        if (!res?.success || !res.data) {
          throw new Error(res?.message || 'Gagal membatalkan order');
        }
        return {
          order_code: String(res.data.order_id || code),
          status: String(res.data.status || 'CANCELLED').toUpperCase(),
          cancelled: Boolean(res.data.cancelled),
        };
      }),
      catchError((err) => throwError(() => this.apiError(err, 'Gagal membatalkan order')))
    );
  }

  /** POST /api/v1/machines/:machineCode/heartbeat */
  sendHeartbeat(
    appVersion: string,
    machineCode = this.config.machineCode
  ): Observable<boolean> {
    const url = `${this.baseUrl}/api/v1/machines/${encodeURIComponent(machineCode)}/heartbeat`;
    return this.http
      .post<{ success?: boolean }>(url, { app_version: appVersion }, { headers: this.headers() })
      .pipe(
        map((res) => Boolean(res?.success)),
        catchError((err) => throwError(() => this.apiError(err, 'Heartbeat gagal')))
      );
  }

  /** POST /api/v1/machines/:machineCode/crash-report */
  reportCrash(
    source: string,
    message: string,
    machineCode = this.config.machineCode
  ): Observable<boolean> {
    const url = `${this.baseUrl}/api/v1/machines/${encodeURIComponent(machineCode)}/crash-report`;
    const payload = {
      source: String(source || 'kiosk').slice(0, 64),
      message: String(message || '').slice(0, 500),
    };
    return this.http
      .post<{ success?: boolean }>(url, payload, { headers: this.headers() })
      .pipe(
        map((res) => Boolean(res?.success)),
        catchError((err) => throwError(() => this.apiError(err, 'Crash report gagal')))
      );
  }

  /**
   * POST /api/v1/orders/:orderCode/dispense-result
   * Body: { status: DISPENSED | DISPENSE_FAILED, detail? }
   */
  reportDispenseResult(
    orderCode: string,
    status: DispenseResultStatus,
    detail?: string | null
  ): Observable<DispenseResultResponse> {
    const code = String(orderCode || '').trim();
    const url = `${this.baseUrl}/api/v1/orders/${encodeURIComponent(code)}/dispense-result`;
    const payload: { status: DispenseResultStatus; detail?: string } = { status };
    const d = String(detail || '').trim();
    if (d) payload.detail = d.slice(0, 255);

    return this.http
      .post<DispenseResultApiResponse>(url, payload, { headers: this.headers() })
      .pipe(
        map((res) => {
          if (!res?.success || !res.data) {
            throw new Error(res?.message || 'Gagal melaporkan hasil dispense');
          }
          return {
            order_code: String(res.data.order_id || code),
            status: String(res.data.status || status).toUpperCase(),
          };
        }),
        catchError((err) => throwError(() => this.apiError(err, 'Gagal melaporkan hasil dispense')))
      );
  }
}
