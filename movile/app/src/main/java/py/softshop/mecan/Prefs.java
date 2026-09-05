package py.softshop.mecan;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

/** Preferencias locales del dispositivo: a qué servidor apunta la app y cuándo revisó actualizaciones. */
final class Prefs {
    private static final String FILE = "mecan";
    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_LAST_CHECK = "lastUpdateCheck";
    private static final String KEY_SKIPPED = "skippedVersionCode";

    private final SharedPreferences store;

    Prefs(Context context) {
        store = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    String serverUrl() {
        String saved = store.getString(KEY_SERVER, "");
        if (!saved.isEmpty()) return saved;
        return normalize(BuildConfig.DEFAULT_SERVER_URL);
    }

    void setServerUrl(String value) {
        store.edit().putString(KEY_SERVER, normalize(value)).apply();
    }

    long lastUpdateCheck() {
        return store.getLong(KEY_LAST_CHECK, 0L);
    }

    void markUpdateChecked() {
        store.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply();
    }

    int skippedVersionCode() {
        return store.getInt(KEY_SKIPPED, 0);
    }

    void skipVersionCode(int versionCode) {
        store.edit().putInt(KEY_SKIPPED, versionCode).apply();
    }

    /** Deja la dirección en forma canónica: sin espacios, sin barra final y con esquema explícito. */
    static String normalize(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return "";
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) trimmed = "https://" + trimmed;
        while (trimmed.endsWith("/")) trimmed = trimmed.substring(0, trimmed.length() - 1);
        return trimmed;
    }
}
