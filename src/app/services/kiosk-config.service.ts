import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export type KioskRuntimeConfig = {
  apiBaseUrl: string;
  machineCode: string;
  kioskToken: string;
};

/** Password pabrik mode servis. Tiap mesin menggantinya lewat halaman servis. */
export const DEFAULT_SERVICE_PASSWORD = 'samakan';

const STORAGE_KEY = 'samakan.kiosk.config';
const SERVICE_PASSWORD_MIN = 4;
const SERVICE_PASSWORD_MAX = 64;

/** Host Core lama — mesin yang sudah ter-provision tetap ikut pindah. */
const LEGACY_API_HOST = 'api.samakan.id';
const PRODUCTION_API_BASE = 'https://core.samakan.id';

/**
 * Provisioning per mesin tanpa rebuild APK.
 * environment.* = default pabrik; localStorage = hasil setting teknisi di /service.
 */
@Injectable({ providedIn: 'root' })
export class KioskConfigService {
  private cfg: KioskRuntimeConfig;
  private servicePassword = DEFAULT_SERVICE_PASSWORD;

  constructor() {
    const stored = this.readStored();
    this.cfg = { ...this.defaults(), ...stored.config };
    if (stored.servicePassword) this.servicePassword = stored.servicePassword;
    if (stored.config.apiBaseUrl && this.isLegacyApiHost(stored.config.apiBaseUrl)) {
      this.cfg = { ...this.cfg, apiBaseUrl: this.normalizeApiBase(stored.config.apiBaseUrl) };
      this.persist(this.cfg);
    }
  }

  get apiBaseUrl(): string {
    return this.cfg.apiBaseUrl.replace(/\/$/, '');
  }

  get machineCode(): string {
    return this.cfg.machineCode;
  }

  get kioskToken(): string {
    return this.cfg.kioskToken;
  }

  get(): KioskRuntimeConfig {
    return { ...this.cfg };
  }

  /** true = masih memakai token contoh; jangan dipakai untuk uang sungguhan. */
  get isDevToken(): boolean {
    return !this.cfg.kioskToken || /^dev-/i.test(this.cfg.kioskToken);
  }

  /** true = ada override tersimpan di perangkat ini. */
  get isProvisioned(): boolean {
    return Object.keys(this.readStored().config).length > 0;
  }

  /** true = mesin ini masih memakai password pabrik. */
  get usesDefaultServicePassword(): boolean {
    return this.servicePassword === DEFAULT_SERVICE_PASSWORD;
  }

  checkServicePassword(input: string): boolean {
    const given = String(input ?? '').trim();
    return given.length > 0 && given === this.servicePassword;
  }

  /** Simpan password khusus perangkat ini. Kosong atau terlalu pendek ditolak. */
  setServicePassword(raw: string): boolean {
    const next = String(raw ?? '').trim();
    if (next.length < SERVICE_PASSWORD_MIN || next.length > SERVICE_PASSWORD_MAX) return false;
    this.servicePassword = next;
    this.persist(this.cfg);
    return true;
  }

  save(patch: Partial<KioskRuntimeConfig>): KioskRuntimeConfig {
    const next: KioskRuntimeConfig = {
      apiBaseUrl: this.normalizeApiBase(this.clean(patch.apiBaseUrl, this.cfg.apiBaseUrl)),
      machineCode: this.clean(patch.machineCode, this.cfg.machineCode),
      kioskToken: this.clean(patch.kioskToken, this.cfg.kioskToken),
    };
    this.cfg = next;
    this.persist(next);
    return { ...next };
  }

  reset(): KioskRuntimeConfig {
    const password = this.servicePassword;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* abaikan */
    }
    this.cfg = this.defaults();
    this.servicePassword = password;
    this.persist(this.cfg);
    return { ...this.cfg };
  }

  private defaults(): KioskRuntimeConfig {
    return {
      apiBaseUrl: environment.apiBaseUrl,
      machineCode: environment.machineCode,
      kioskToken: environment.kioskToken,
    };
  }

  private readStored(): { config: Partial<KioskRuntimeConfig>; servicePassword: string } {
    const empty = { config: {}, servicePassword: '' };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Partial<KioskRuntimeConfig> & { servicePassword?: string };
      const config: Partial<KioskRuntimeConfig> = {};
      if (parsed.apiBaseUrl) config.apiBaseUrl = String(parsed.apiBaseUrl);
      if (parsed.machineCode) config.machineCode = String(parsed.machineCode);
      if (parsed.kioskToken) config.kioskToken = String(parsed.kioskToken);
      const servicePassword = this.acceptPassword(parsed.servicePassword);
      return { config, servicePassword };
    } catch {
      return empty;
    }
  }

  private persist(cfg: KioskRuntimeConfig): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...cfg, servicePassword: this.servicePassword })
      );
    } catch {
      /* storage penuh / mode privat — config tetap berlaku sampai app ditutup */
    }
  }

  private acceptPassword(value: unknown): string {
    const next = String(value ?? '').trim();
    if (next.length < SERVICE_PASSWORD_MIN || next.length > SERVICE_PASSWORD_MAX) return '';
    return next;
  }

  private normalizeApiBase(url: string): string {
    return this.isLegacyApiHost(url) ? PRODUCTION_API_BASE : url;
  }

  private isLegacyApiHost(url: string): boolean {
    try {
      return new URL(String(url).trim()).hostname.toLowerCase() === LEGACY_API_HOST;
    } catch {
      return false;
    }
  }

  private clean(value: string | undefined, fallback: string): string {
    const v = String(value ?? '').trim();
    return v || fallback;
  }
}
