package id.samakan.kiosk;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Kontrol penguncian panel dari halaman Mode Servis kiosk, supaya teknisi
 * tidak perlu adb untuk keluar sebentar dari lock task.
 */
@CapacitorPlugin(name = "KioskLock")
public class KioskLockPlugin extends Plugin {

  @PluginMethod
  public void getStatus(PluginCall call) {
    call.resolve(status(getActivity()));
  }

  @PluginMethod
  public void setLockTask(PluginCall call) {
    boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", Boolean.TRUE));
    Activity activity = getActivity();

    activity.runOnUiThread(() -> {
      KioskMode.setLockPaused(!enabled);
      if (enabled) {
        KioskMode.applyImmersive(activity);
        KioskMode.startLockTask(activity);
      } else {
        KioskMode.stopLockTask(activity);
        KioskMode.showSystemUi(activity);
      }
      call.resolve(status(activity));
    });
  }

  @PluginMethod
  public void openSettings(PluginCall call) {
    Activity activity = getActivity();
    call.resolve();
    activity.runOnUiThread(() -> KioskMode.openAndroidSettings(activity));
  }

  @PluginMethod
  public void exitApp(PluginCall call) {
    Activity activity = getActivity();
    call.resolve();
    activity.runOnUiThread(() -> KioskMode.exitApp(activity));
  }

  @PluginMethod
  public void applyImmersive(PluginCall call) {
    Activity activity = getActivity();
    activity.runOnUiThread(() -> {
      if (!KioskMode.isLockPaused()) {
        KioskMode.applyImmersive(activity);
      }
      call.resolve();
    });
  }

  private static JSObject status(Activity activity) {
    JSObject out = new JSObject();
    out.put("lockTaskPermitted", KioskMode.isLockTaskPermitted(activity));
    out.put("lockTaskActive", KioskMode.isLockTaskActive(activity));
    out.put("lockPaused", KioskMode.isLockPaused());
    out.put("isDefaultHome", KioskMode.isDefaultHome(activity));
    return out;
  }
}
