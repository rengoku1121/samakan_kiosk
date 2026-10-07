package id.samakan.kiosk;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;

/**
 * Penguncian panel vending: layar tidak boleh tidur, status/navigation bar
 * tersembunyi, dan (bila panel sudah di-provision sebagai device owner)
 * aplikasi terkunci di depan.
 */
public final class KioskMode {

  /** Teknisi melepas kunci / menutup app — jangan kunci ulang di onResume. */
  private static volatile boolean lockPaused = false;

  private KioskMode() {}

  public static boolean isLockPaused() {
    return lockPaused;
  }

  public static void setLockPaused(boolean paused) {
    lockPaused = paused;
  }

  /** Layar selalu menyala selama aplikasi di depan. */
  public static void keepScreenOn(Activity activity) {
    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  /**
   * Immersive sticky: bar sistem muncul sesaat saat layar disapu lalu hilang
   * lagi, sehingga pelanggan tidak bisa keluar ke Settings lewat status bar.
   * Harus dipanggil ulang setiap kali window mendapat fokus.
   */
  public static void applyImmersive(Activity activity) {
    View decor = activity.getWindow().getDecorView();
    decor.setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    );
  }

  /**
   * true bila panel sudah di-set sebagai device owner dan paket ini masuk
   * daftar lock task. Tanpa itu startLockTask() memunculkan dialog konfirmasi
   * "screen pinning" yang tidak boleh muncul di mesin unattended.
   */
  public static boolean isLockTaskPermitted(Context context) {
    DevicePolicyManager dpm =
      (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
    if (dpm == null) return false;
    return dpm.isLockTaskPermitted(context.getPackageName());
  }

  public static boolean isLockTaskActive(Context context) {
    ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null) return false;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }
    return false;
  }

  /** Kunci aplikasi di depan. Diam saja bila panel belum di-provision. */
  public static boolean startLockTask(Activity activity) {
    if (!isLockTaskPermitted(activity)) return false;
    if (isLockTaskActive(activity)) return true;
    try {
      activity.startLockTask();
      return true;
    } catch (IllegalArgumentException | IllegalStateException e) {
      return false;
    }
  }

  public static void stopLockTask(Activity activity) {
    if (!isLockTaskActive(activity)) return;
    try {
      activity.stopLockTask();
    } catch (IllegalStateException ignored) {
      // Sudah keluar dari lock task.
    }
  }

  /** Tampilkan status/navigation bar supaya teknisi bisa ke Settings. */
  @SuppressWarnings("deprecation")
  public static void showSystemUi(Activity activity) {
    View decor = activity.getWindow().getDecorView();
    decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
  }

  public static boolean isDefaultHome(Context context) {
    Intent home = new Intent(Intent.ACTION_MAIN);
    home.addCategory(Intent.CATEGORY_HOME);
    ResolveInfo resolved =
      context.getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
    return resolved != null
      && resolved.activityInfo != null
      && context.getPackageName().equals(resolved.activityInfo.packageName);
  }

  public static void openAndroidSettings(Activity activity) {
    setLockPaused(true);
    stopLockTask(activity);
    showSystemUi(activity);
    Intent intent = new Intent(Settings.ACTION_SETTINGS);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    activity.startActivity(intent);
  }

  /**
   * Lepas kunci lalu tutup task. Jika aplikasi ini Home default, Android akan
   * membukanya lagi — jadi buka Settings supaya teknisi bisa keluar.
   */
  public static void exitApp(Activity activity) {
    setLockPaused(true);
    stopLockTask(activity);
    showSystemUi(activity);
    if (isDefaultHome(activity)) {
      Intent intent = new Intent(Settings.ACTION_SETTINGS);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      activity.startActivity(intent);
      activity.moveTaskToBack(true);
      return;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      activity.finishAndRemoveTask();
    } else {
      activity.finishAffinity();
    }
  }
}
