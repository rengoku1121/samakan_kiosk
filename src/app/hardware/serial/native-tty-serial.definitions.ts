/**
 * Plugin lokal NativeTtySerial (Android app) — UART /dev/ttyS*.
 */
import type { PluginListenerHandle } from '@capacitor/core';

export type NativeTtyDevice = {
  deviceId: number;
  path: string;
  canRead?: boolean;
  canWrite?: boolean;
  label?: string;
};

export type NativeTtySerialPlugin = {
  listDevices(): Promise<{ devices: NativeTtyDevice[] }>;
  open(options: {
    path: string;
    baudRate?: number;
    flags?: number;
  }): Promise<{ path: string; baudRate: number }>;
  close(): Promise<void>;
  isOpen(): Promise<{ open: boolean; path?: string | null }>;
  write(options: { data: string }): Promise<{ bytesWritten?: number }>;
  startReading(): Promise<void>;
  stopReading(): Promise<void>;
  addListener(
    eventName: 'data',
    listenerFunc: (event: { data: string; path?: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listenerFunc: (event: { message?: string; code?: string }) => void
  ): Promise<PluginListenerHandle>;
};
