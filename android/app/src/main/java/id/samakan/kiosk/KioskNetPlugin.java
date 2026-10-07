package id.samakan.kiosk;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;

/**
 * Status jaringan untuk Mode Servis. Tidak mengubah koneksi.
 * Nama Wi-Fi bisa kosong di Android baru tanpa izin lokasi; IP tetap diisi.
 */
@CapacitorPlugin(name = "KioskNet")
public class KioskNetPlugin extends Plugin {

  @PluginMethod
  public void status(PluginCall call) {
    Context ctx = getContext();
    ConnectivityManager cm =
      (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
    Network network = cm != null ? cm.getActiveNetwork() : null;
    NetworkCapabilities caps =
      (cm != null && network != null) ? cm.getNetworkCapabilities(network) : null;

    boolean online =
      caps != null
        && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);

    String transport = "Tidak dikenal";
    if (caps != null) {
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "Wi-Fi";
      else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "Ethernet";
      else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "Seluler";
    }

    JSObject out = new JSObject();
    out.put("online", online);
    out.put("transport", transport);
    out.put("ssid", wifiSsid(ctx, transport));
    out.put("ip", ipv4(cm, network));
    call.resolve(out);
  }

  @SuppressWarnings("deprecation")
  private static String wifiSsid(Context ctx, String transport) {
    if (!"Wi-Fi".equals(transport)) return "";
    try {
      WifiManager wm =
        (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      if (wm == null) return "";
      WifiInfo info = wm.getConnectionInfo();
      if (info == null || info.getSSID() == null) return "";
      String ssid = info.getSSID().replace("\"", "").trim();
      if (ssid.isEmpty() || "<unknown ssid>".equalsIgnoreCase(ssid)) return "";
      return ssid;
    } catch (SecurityException e) {
      return "";
    }
  }

  private static String ipv4(ConnectivityManager cm, Network network) {
    if (cm == null || network == null) return "";
    LinkProperties props = cm.getLinkProperties(network);
    if (props == null) return "";
    for (LinkAddress addr : props.getLinkAddresses()) {
      InetAddress ia = addr.getAddress();
      if (ia instanceof Inet4Address && !ia.isLoopbackAddress() && !ia.isLinkLocalAddress()) {
        String host = ia.getHostAddress();
        return host == null ? "" : host;
      }
    }
    return "";
  }
}
