package id.samakan.kiosk;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import id.samakan.kiosk.serial.NativeTtySerialPlugin;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativeTtySerialPlugin.class);
    registerPlugin(KioskLockPlugin.class);
    registerPlugin(KioskNetPlugin.class);
    super.onCreate(savedInstanceState);

    KioskMode.keepScreenOn(this);
    if (isDebuggable()) {
      KioskMode.setLockPaused(true);
      KioskMode.showSystemUi(this);
    } else {
      KioskMode.applyImmersive(this);
    }

    WebView webView = getBridge().getWebView();

    // Backend LAN http:// hanya diizinkan di build debug; rilis wajib HTTPS.
    if (webView != null && isDebuggable()) {
      webView.getSettings().setMixedContentMode(
        WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
      );
    }
  }

  @Override
  public void onResume() {
    super.onResume();
    if (isDebuggable() || KioskMode.isLockPaused()) {
      KioskMode.setLockPaused(true);
      KioskMode.showSystemUi(this);
      return;
    }
    KioskMode.applyImmersive(this);
    KioskMode.startLockTask(this);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus && !KioskMode.isLockPaused()) {
      KioskMode.applyImmersive(this);
    }
  }

  private boolean isDebuggable() {
    return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
  }
}
