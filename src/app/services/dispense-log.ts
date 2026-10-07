/**
 * Logging terpusat untuk dispense / VMC (muncul di logcat Chrome/Android).
 * Filter: adb logcat | findstr KioskDispense
 * Build produksi hanya menulis warn/error.
 */
import { environment } from '../../environments/environment';

const TAG = '[KioskDispense]';

export function dispenseLog(
  level: 'info' | 'warn' | 'error',
  step: string,
  detail?: unknown
): void {
  if (environment.production && level === 'info') return;

  const msg = `${TAG} ${step}`;
  if (level === 'error') {
    if (detail !== undefined) console.error(msg, detail);
    else console.error(msg);
    return;
  }
  if (level === 'warn') {
    if (detail !== undefined) console.warn(msg, detail);
    else console.warn(msg);
    return;
  }
  if (detail !== undefined) console.info(msg, detail);
  else console.info(msg);
}
