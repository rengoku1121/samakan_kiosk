import { TestBed } from '@angular/core/testing';
import { CatalogSelection } from '../catalog/catalog.models';
import { CreateOrderResult } from './kiosk-api.service';
import { KioskPaymentService } from './kiosk-payment.service';

const selection: CatalogSelection = {
  slot_code: '013',
  product_code: 'SMK-KATSU',
  product_name: 'Chicken Katsu Bowl',
  price: 30000,
  stock: 3,
  image_url: '',
  desc: '',
  catalog_mode: 'slot',
  requires_heating: true,
  heat_requested: true,
};

const order: CreateOrderResult = {
  order_code: 'KIOSK-000123',
  machine_code: 'MER-000001-M1',
  status: 'PENDING',
  total: 30000,
  created_at: null,
  expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  payment_ref: 'REF-1',
  qr_image_url: null,
  qr_string: 'QR',
  provider: 'MIDTRANS',
};

describe('KioskPaymentService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function newService(): KioskPaymentService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [KioskPaymentService] });
    return TestBed.inject(KioskPaymentService);
  }

  it('tidak memulihkan sesi yang belum dibayar', () => {
    const svc = newService();
    svc.setFromOrder(selection, order);
    expect(newService().resumable).toBeNull();
  });

  it('memulihkan sesi PAID setelah aplikasi restart', () => {
    const svc = newService();
    svc.setFromOrder(selection, order);
    svc.markPaid();

    const resumed = newService().resumable;
    expect(resumed?.order_code).toBe('KIOSK-000123');
    expect(resumed?.slot_code).toBe('013');
    expect(resumed?.status).toBe('PAID');
  });

  it('memulihkan sesi yang mati saat dispense berjalan', () => {
    const svc = newService();
    svc.setFromOrder(selection, order);
    svc.markPaid();
    svc.markDispensing();

    expect(newService().resumable?.status).toBe('DISPENSING');
  });

  it('hasil VMC di disk tidak ikut resume motor', () => {
    const svc = newService();
    svc.setFromOrder(selection, order);
    svc.markPaid();
    svc.markDispensing();
    svc.markDispensed('vmc-ok');
    expect(newService().resumable).toBeNull();
    expect(newService().get()?.status).toBe('DISPENSED');
  });

  it('tidak memulihkan sesi yang sudah selesai', () => {
    const svc = newService();
    svc.setFromOrder(selection, order);
    svc.markPaid();
    svc.markDispensed('ok');

    expect(newService().resumable).toBeNull();
  });

  it('clear() menghapus sesi tersimpan', () => {
    const svc = newService();
    svc.setFromOrder(selection, order);
    svc.markPaid();
    svc.clear();

    expect(newService().resumable).toBeNull();
    expect(newService().get()).toBeNull();
  });
});
