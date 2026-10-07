package id.samakan.kiosk.serial;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Capacitor plugin: native UART (/dev/ttyS*) untuk VMC XY5186-E.
 */
@CapacitorPlugin(name = "NativeTtySerial")
public class NativeTtySerialPlugin extends Plugin {
  private static final String TAG = "NativeTtySerial";

  private SerialPort serialPort;
  private final AtomicBoolean reading = new AtomicBoolean(false);
  private ExecutorService readerExecutor;
  private String openPath;

  @PluginMethod
  public void listDevices(PluginCall call) {
    JSArray devices = new JSArray();
    String[] candidates = new String[]{
      "/dev/ttyS1", "/dev/ttyS2", "/dev/ttyS3", "/dev/ttyS0", "/dev/ttyHSL0"
    };
    int id = 1;
    for (String path : candidates) {
      File f = new File(path);
      if (!f.exists()) continue;
      JSObject d = new JSObject();
      d.put("deviceId", id++);
      d.put("path", path);
      d.put("canRead", f.canRead());
      d.put("canWrite", f.canWrite());
      d.put("label", path);
      devices.put(d);
    }
    JSObject ret = new JSObject();
    ret.put("devices", devices);
    call.resolve(ret);
  }

  @PluginMethod
  public void open(PluginCall call) {
    String path = call.getString("path", "/dev/ttyS2");
    int baudRate = call.getInt("baudRate", 57600);
    int flags = call.getInt("flags", 0);

    if (path == null || path.trim().isEmpty()) {
      call.reject("path wajib (mis. /dev/ttyS2)");
      return;
    }

    try {
      closeInternal();
      File device = new File(path);
      if (!device.exists()) {
        call.reject("Device tidak ada: " + path);
        return;
      }
      serialPort = new SerialPort(device, baudRate, flags);
      openPath = path;
      Log.i(TAG, "opened " + path + " @" + baudRate);
      JSObject ret = new JSObject();
      ret.put("path", path);
      ret.put("baudRate", baudRate);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "open failed", e);
      call.reject("Gagal buka " + path + ": " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void close(PluginCall call) {
    closeInternal();
    call.resolve();
  }

  @PluginMethod
  public void isOpen(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("open", serialPort != null);
    ret.put("path", openPath);
    call.resolve(ret);
  }

  @PluginMethod
  public void write(PluginCall call) {
    String dataB64 = call.getString("data");
    if (serialPort == null) {
      call.reject("Port belum open");
      return;
    }
    if (dataB64 == null) {
      call.reject("data (base64) wajib");
      return;
    }
    try {
      byte[] bytes = Base64.decode(dataB64, Base64.DEFAULT);
      OutputStream out = serialPort.getOutputStream();
      out.write(bytes);
      out.flush();
      JSObject ret = new JSObject();
      ret.put("bytesWritten", bytes.length);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "write failed", e);
      call.reject("write gagal: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void startReading(PluginCall call) {
    if (serialPort == null) {
      call.reject("Port belum open");
      return;
    }
    if (reading.getAndSet(true)) {
      call.resolve();
      return;
    }
    final InputStream in = serialPort.getInputStream();
    readerExecutor = Executors.newSingleThreadExecutor();
    readerExecutor.execute(() -> {
      byte[] buf = new byte[512];
      while (reading.get()) {
        try {
          int n = in.read(buf);
          if (n < 0) {
            break;
          }
          if (n == 0) {
            continue;
          }
          byte[] chunk = new byte[n];
          System.arraycopy(buf, 0, chunk, 0, n);
          String b64 = Base64.encodeToString(chunk, Base64.NO_WRAP);
          JSObject ev = new JSObject();
          ev.put("data", b64);
          ev.put("path", openPath);
          notifyListeners("data", ev);
        } catch (IOException e) {
          if (reading.get()) {
            Log.e(TAG, "read error", e);
            JSObject err = new JSObject();
            err.put("message", e.getMessage());
            err.put("code", "read_error");
            notifyListeners("error", err);
          }
          break;
        }
      }
      reading.set(false);
    });
    call.resolve();
  }

  @PluginMethod
  public void stopReading(PluginCall call) {
    reading.set(false);
    if (readerExecutor != null) {
      readerExecutor.shutdownNow();
      readerExecutor = null;
    }
    call.resolve();
  }

  private void closeInternal() {
    reading.set(false);
    if (readerExecutor != null) {
      readerExecutor.shutdownNow();
      readerExecutor = null;
    }
    if (serialPort != null) {
      try {
        serialPort.closePort();
      } catch (Exception e) {
        Log.w(TAG, "closePort", e);
      }
      serialPort = null;
    }
    openPath = null;
  }

  @Override
  protected void handleOnDestroy() {
    closeInternal();
    super.handleOnDestroy();
  }
}
