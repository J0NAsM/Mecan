package py.softshop.mecan;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Actualizacion de la propia app desde el servidor del taller.
 *
 * <p>El servidor publica /movil/actualizacion.json con la version vigente del APK. La app compara
 * ese numero con el suyo, descarga el archivo, comprueba su SHA-256 y entrega el resultado al
 * instalador de Android, que siempre pide confirmacion al usuario.
 *
 * <p>Comprobaciones antes de instalar: el identificador de aplicacion publicado debe ser el mismo
 * que el instalado, la version debe ser mayor, la descarga debe venir del mismo origen que el
 * servidor configurado y el hash debe coincidir. La compilacion de publicacion solo admite HTTPS.
 */
final class UpdateManager {

    /** Version publicada por el servidor. */
    static final class Release {
        String applicationId = "";
        int versionCode;
        String versionName = "";
        String downloadUrl = "";
        String sha256 = "";
        long size;
        boolean mandatory;
        String notes = "";
    }

    interface CheckCallback {
        void onResult(Release available, String error);
    }

    private interface Progress {
        void onProgress(long done, long total);
    }

    private static final String MANIFEST_PATH = "/movil/actualizacion.json";
    private static final int TIMEOUT_MS = 20000;
    private static final long MAX_APK_BYTES = 300L * 1024 * 1024;
    private static final ExecutorService WORKERS = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private UpdateManager() {}

    /** Consulta el manifiesto en segundo plano y responde en el hilo principal. */
    static void check(String baseUrl, CheckCallback callback) {
        WORKERS.execute(() -> {
            Release release = null;
            String error = null;
            try {
                release = fetch(baseUrl);
            } catch (Exception exception) {
                error = exception.getMessage() == null ? exception.toString() : exception.getMessage();
            }
            final Release result = release;
            final String failure = error;
            MAIN.post(() -> callback.onResult(result, failure));
        });
    }

    private static Release fetch(String baseUrl) throws Exception {
        URL manifest = new URL(baseUrl + MANIFEST_PATH);
        HttpURLConnection connection = (HttpURLConnection) manifest.openConnection();
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", userAgent());
        try {
            int status = connection.getResponseCode();
            // 404 significa que el servidor todavia no publico ningun APK: no es un error de red.
            if (status == HttpURLConnection.HTTP_NOT_FOUND) return null;
            if (status != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + status);
            byte[] raw = readAll(connection.getInputStream(), 64 * 1024);
            JSONObject json = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            Release release = new Release();
            release.applicationId = json.optString("applicationId", "");
            release.versionCode = json.optInt("versionCode", 0);
            release.versionName = json.optString("versionName", "");
            release.sha256 = json.optString("sha256", "").toLowerCase(Locale.ROOT);
            release.size = json.optLong("size", 0L);
            release.mandatory = json.optBoolean("mandatory", false);
            release.notes = json.optString("notes", "");
            // La descarga se resuelve contra el servidor configurado: un manifiesto no puede
            // desviar la instalacion hacia otro host.
            URL absolute = new URL(manifest, json.optString("downloadUrl", ""));
            URL origin = new URL(baseUrl);
            boolean sameOrigin = absolute.getProtocol().equalsIgnoreCase(origin.getProtocol())
                    && absolute.getHost().equalsIgnoreCase(origin.getHost())
                    && effectivePort(absolute.getProtocol(), absolute.getPort())
                    == effectivePort(origin.getProtocol(), origin.getPort());
            if (!sameOrigin)
                throw new Exception("La descarga publicada no pertenece al servidor configurado.");
            release.downloadUrl = absolute.toString();
            if (release.versionCode <= 0 || release.sha256.length() != 64)
                throw new Exception("El manifiesto de actualizacion esta incompleto.");
            return release;
        } finally {
            connection.disconnect();
        }
    }

    /** True cuando la version publicada es realmente instalable sobre la que esta corriendo. */
    static boolean isNewer(Context context, Release release) {
        if (release == null) return false;
        if (!release.applicationId.isEmpty() && !release.applicationId.equals(context.getPackageName()))
            return false;
        return release.versionCode > BuildConfig.VERSION_CODE;
    }

    /** Aviso de version nueva; si es obligatoria no se puede posponer. */
    static void promptInstall(Activity activity, Release release, Runnable onDismissed) {
        String body = activity.getString(R.string.update_body, release.versionName, BuildConfig.VERSION_NAME);
        if (!release.notes.isEmpty()) body = body + "\n\n" + release.notes;
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle(release.mandatory ? R.string.update_required_title : R.string.update_available_title)
                .setMessage(body)
                .setCancelable(!release.mandatory)
                .setPositiveButton(R.string.update_install, (dialog, which) -> download(activity, release));
        if (!release.mandatory) {
            builder.setNegativeButton(R.string.update_later, (dialog, which) -> {
                new Prefs(activity).skipVersionCode(release.versionCode);
                if (onDismissed != null) onDismissed.run();
            });
            builder.setOnCancelListener(dialog -> {
                if (onDismissed != null) onDismissed.run();
            });
        }
        builder.show();
    }

    /** Descarga el APK mostrando progreso, verifica el hash y lanza el instalador del sistema. */
    static void download(Activity activity, Release release) {
        View view = LayoutInflater.from(activity).inflate(R.layout.dialog_progress, null);
        TextView labelView = view.findViewById(R.id.progress_label);
        TextView detailView = view.findViewById(R.id.progress_detail);
        ProgressBar bar = view.findViewById(R.id.progress_bar);
        labelView.setText(R.string.update_downloading);
        AlertDialog dialog = new AlertDialog.Builder(activity).setView(view).setCancelable(false).show();

        WORKERS.execute(() -> {
            File target = null;
            String error = null;
            try {
                target = downloadTo(activity, release, (done, total) -> MAIN.post(() -> {
                    if (total > 0) {
                        bar.setIndeterminate(false);
                        bar.setProgress((int) (done * 100 / total));
                        detailView.setText(String.format(Locale.getDefault(), "%.1f MB / %.1f MB",
                                done / 1048576f, total / 1048576f));
                    } else {
                        bar.setIndeterminate(true);
                        detailView.setText(String.format(Locale.getDefault(), "%.1f MB", done / 1048576f));
                    }
                }));
            } catch (Exception exception) {
                error = exception.getMessage();
            }
            final File file = target;
            final String failure = error;
            MAIN.post(() -> {
                // La descarga puede terminar despues de que la persona cierre la pantalla:
                // tocar un dialogo de una actividad ya destruida provocaria un fallo.
                if (activity.isFinishing() || activity.isDestroyed()) return;
                dialog.dismiss();
                if (file == null) {
                    new AlertDialog.Builder(activity)
                            .setTitle(R.string.update_available_title)
                            .setMessage(failure == null ? activity.getString(R.string.update_download_failed) : failure)
                            .setPositiveButton(R.string.close, null)
                            .show();
                    return;
                }
                install(activity, file);
            });
        });
    }

    private static File downloadTo(Context context, Release release, Progress progress) throws Exception {
        File directory = new File(context.getFilesDir(), "updates");
        if (!directory.isDirectory() && !directory.mkdirs())
            throw new Exception(context.getString(R.string.update_download_failed));
        // Solo se conserva la descarga en curso: no se acumulan APK viejos en el dispositivo.
        File[] previous = directory.listFiles();
        if (previous != null) for (File old : previous) old.delete();

        File target = new File(directory, "mecan-" + release.versionCode + ".apk");
        HttpURLConnection connection = (HttpURLConnection) new URL(release.downloadUrl).openConnection();
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setRequestProperty("User-Agent", userAgent());
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + status);
            long total = release.size > 0 ? release.size : connection.getContentLengthLong();
            long done = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(target)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    done += read;
                    if (done > MAX_APK_BYTES)
                        throw new Exception(context.getString(R.string.update_download_failed));
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                    progress.onProgress(done, total);
                }
            }
            if (release.size > 0 && done != release.size)
                throw new Exception(context.getString(R.string.update_hash_failed));
            if (!hex(digest.digest()).equals(release.sha256))
                throw new Exception(context.getString(R.string.update_hash_failed));
            return target;
        } catch (Exception exception) {
            target.delete();
            throw exception;
        } finally {
            connection.disconnect();
        }
    }

    /** Entrega el archivo al instalador del sistema, pidiendo antes el permiso de origenes desconocidos. */
    private static void install(Activity activity, File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity)
                    .setTitle(R.string.update_permission_title)
                    .setMessage(R.string.update_permission_body)
                    .setPositiveButton(R.string.update_permission_open, (dialog, which) -> {
                        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName()));
                        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(settings);
                    })
                    .setNegativeButton(R.string.cancel, null)
                    .show();
            return;
        }
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
        } catch (Exception exception) {
            Toast.makeText(activity, R.string.update_download_failed, Toast.LENGTH_LONG).show();
        }
    }

    private static byte[] readAll(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        try {
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
                if (buffer.size() > limit) throw new Exception("Respuesta demasiado grande.");
            }
        } finally {
            input.close();
        }
        return buffer.toByteArray();
    }

    private static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) text.append(String.format(Locale.ROOT, "%02x", value));
        return text.toString();
    }

    /** Puerto real de una direccion: 443/80 cuando el esquema lo deja implicito. */
    static int effectivePort(String scheme, int port) {
        if (port != -1) return port;
        return "https".equalsIgnoreCase(scheme) ? 443 : 80;
    }

    static String userAgent() {
        return "MecanMovil/" + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")";
    }
}
