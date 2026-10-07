package id.samakan.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Panel vending sering mati listrik. Setelah boot, kiosk harus kembali sendiri
 * tanpa petugas menyentuh layar.
 */
public class BootReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent == null ? null : intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
      && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
      return;
    }

    // APK debug: jangan buka kiosk sendiri setelah boot.
    if ((context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      return;
    }

    Intent launch = new Intent(context, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(launch);
  }
}
