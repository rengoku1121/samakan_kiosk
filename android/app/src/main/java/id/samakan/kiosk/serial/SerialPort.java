package id.samakan.kiosk.serial;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Wrapper JNI ke /dev/ttyS* (android-serialport-api style).
 */
public class SerialPort {
  private final FileDescriptor mFd;
  private final FileInputStream mFileInputStream;
  private final FileOutputStream mFileOutputStream;

  static {
    System.loadLibrary("serial_port");
  }

  public SerialPort(File device, int baudrate, int flags) throws SecurityException, IOException {
    if (!device.canRead() || !device.canWrite()) {
      throw new SecurityException(
        "Tidak bisa read/write " + device.getAbsolutePath() +
          " (permission). Path ada tapi app tidak punya akses."
      );
    }
    mFd = open(device.getAbsolutePath(), baudrate, flags);
    if (mFd == null) {
      throw new IOException("native open gagal: " + device.getAbsolutePath());
    }
    mFileInputStream = new FileInputStream(mFd);
    mFileOutputStream = new FileOutputStream(mFd);
  }

  public InputStream getInputStream() {
    return mFileInputStream;
  }

  public OutputStream getOutputStream() {
    return mFileOutputStream;
  }

  public void closePort() {
    try {
      mFileInputStream.close();
    } catch (IOException ignored) {
    }
    try {
      mFileOutputStream.close();
    } catch (IOException ignored) {
    }
    close();
  }

  private native static FileDescriptor open(String path, int baudrate, int flags);

  private native void close();
}
