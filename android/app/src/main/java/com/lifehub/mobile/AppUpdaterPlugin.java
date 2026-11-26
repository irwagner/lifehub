package com.lifehub.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String downloadUrl = call.getString("url");
        if (downloadUrl == null || !downloadUrl.startsWith("https://")) {
            call.reject("URL de atualização inválida.");
            return;
        }

        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                Intent permIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())
                );
                permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(permIntent);

                JSObject res = new JSObject();
                res.put("status", "permission_required");
                res.put(
                    "message",
                    "Ative 'Permitir desta fonte' na tela que abriu e depois toque em Atualizar novamente."
                );
                call.resolve(res);
                return;
            }
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File outFile = new File(context.getCacheDir(), "lifehub-update.apk");
                if (outFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                }

                // Follow up to 5 HTTP redirects (GitHub release -> objects.githubusercontent.com)
                String currentUrl = downloadUrl;
                int redirects = 0;
                while (redirects < 5) {
                    URL urlObj = new URL(currentUrl);
                    conn = (HttpURLConnection) urlObj.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "LifeHub-Android-Updater");
                    int code = conn.getResponseCode();
                    if (
                        code == HttpURLConnection.HTTP_MOVED_PERM ||
                        code == HttpURLConnection.HTTP_MOVED_TEMP ||
                        code == HttpURLConnection.HTTP_SEE_OTHER ||
                        code == 307 ||
                        code == 308
                    ) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc == null || loc.isEmpty()) {
                            throw new Exception("Redirecionamento inválido ao baixar APK.");
                        }
                        currentUrl = loc;
                        redirects++;
                    } else if (code >= 200 && code < 300) {
                        break;
                    } else {
                        throw new Exception("Servidor respondeu com HTTP " + code);
                    }
                }

                if (conn == null) {
                    throw new Exception("Falha ao abrir conexão de download.");
                }

                long totalBytes = conn.getContentLengthLong();
                long downloaded = 0;
                int lastPercent = -1;

                try (
                    InputStream in = new BufferedInputStream(conn.getInputStream());
                    FileOutputStream out = new FileOutputStream(outFile)
                ) {
                    byte[] buffer = new byte[16384];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        downloaded += read;
                        if (totalBytes > 0) {
                            int percent = (int) Math.min(100, (downloaded * 100L) / totalBytes);
                            if (percent != lastPercent && (percent % 5 == 0 || percent == 100)) {
                                lastPercent = percent;
                                JSObject prog = new JSObject();
                                prog.put("percent", percent);
                                prog.put("downloaded", downloaded);
                                prog.put("total", totalBytes);
                                notifyListeners("downloadProgress", prog);
                            }
                        }
                    }
                    out.flush();
                }

                Uri apkUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    outFile
                );

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                );
                context.startActivity(installIntent);

                JSObject ok = new JSObject();
                ok.put("status", "installer_launched");
                ok.put("message", "Download concluído! Toque em Atualizar na tela do Android.");
                call.resolve(ok);
            } catch (Exception e) {
                call.reject("Erro ao baixar atualização: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }
}
