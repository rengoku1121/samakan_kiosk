import { HttpErrorResponse } from '@angular/common/http';
import {
  publicDispenseFailureMessage,
  publicErrorMessage,
  publicSlotCheckMessage,
} from './public-error';

describe('publicErrorMessage', () => {
  const fallback = 'Gagal memuat katalog dari server. Coba lagi.';

  it('hides Angular HttpClient URL on status 0', () => {
    const err = new HttpErrorResponse({
      status: 0,
      statusText: 'Unknown Error',
      url: 'http://192.168.1.12:4000/api/v1/machines/MER-000001-M1/catalog',
    });
    const msg = publicErrorMessage(err, fallback);
    expect(msg).not.toContain('192.168');
    expect(msg).not.toContain('/api/v1');
    expect(msg).not.toContain('Http failure');
    expect(msg).toContain('jaringan');
  });

  it('keeps a safe backend message', () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: { message: 'Slot tidak tersedia' },
    });
    expect(publicErrorMessage(err, fallback)).toBe('Slot tidak tersedia');
  });

  it('rejects a backend message that contains a URL', () => {
    const err = new HttpErrorResponse({
      status: 502,
      error: { message: 'proxy failed for http://192.168.1.12:4000' },
    });
    expect(publicErrorMessage(err, fallback)).not.toContain('http');
  });

  it('maps 500 to a generic server message', () => {
    const err = new HttpErrorResponse({ status: 500, statusText: 'Server Error' });
    expect(publicErrorMessage(err, fallback)).toContain('Server sedang bermasalah');
  });
});

describe('publicSlotCheckMessage', () => {
  it('does not leak elevator jargon', () => {
    expect(publicSlotCheckMessage('Error elevator · slot 004')).not.toMatch(/elevator/i);
  });

  it('maps empty stock', () => {
    expect(publicSlotCheckMessage('Stok slot habis')).toContain('habis');
  });

  it('asks to wait for the pickup door without sounding like a failure', () => {
    const msg = publicSlotCheckMessage('Pintu ambil belum terkunci · slot 021');
    expect(msg).toContain('lubang pengambilan tertutup');
    expect(msg).not.toMatch(/gagal|error|hubungi petugas/i);
  });
});

describe('publicDispenseFailureMessage', () => {
  it('never echoes English VMC labels', () => {
    const msg = publicDispenseFailureMessage('Selection jammed');
    expect(msg).not.toMatch(/jammed|motor|microwave/i);
    expect(msg).toContain('Hubungi petugas');
  });
});
