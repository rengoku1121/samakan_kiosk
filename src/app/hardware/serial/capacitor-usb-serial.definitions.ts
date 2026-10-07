/**
 * Kontrak plugin @leeskies/capacitor-usb-serial (subset yang kita pakai).
 * Disimpan lokal supaya TypeScript tidak bergantung penuh pada peer Cap 7.
 */
import type { PluginListenerHandle } from '@capacitor/core';

export type UsbSerialDevice = {
  deviceId: number;
  deviceName?: string;
  productName?: string;
  manufacturerName?: string;
  driverType?: string;
  hasPermission?: boolean;
  vendorId?: number;
  productId?: number;
};

export type UsbSerialPlugin = {
  listDevices(): Promise<{ devices: UsbSerialDevice[] }>;
  requestPermission(options: { deviceId: number }): Promise<{ granted: boolean }>;
  hasPermission(options: { deviceId: number }): Promise<{ granted: boolean }>;
  open(options: { deviceId: number; portNum?: number }): Promise<{ portId: string }>;
  close(options: { portId: string }): Promise<void>;
  isOpen(options: { portId: string }): Promise<{ open: boolean }>;
  setParameters(options: {
    portId: string;
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
  }): Promise<void>;
  write(options: { portId: string; data: string }): Promise<{ bytesWritten?: number }>;
  startReading(options: { portId: string }): Promise<void>;
  stopReading(options: { portId: string }): Promise<void>;
  addListener(
    eventName: 'data',
    listenerFunc: (event: { portId?: string; data: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listenerFunc: (event: { message?: string; code?: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'detached',
    listenerFunc: (event: { deviceId?: number }) => void
  ): Promise<PluginListenerHandle>;
};
