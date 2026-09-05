package py.softshop.mecan;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.net.URL;
import java.util.Locale;

/**
 * Contenedor de la aplicacion web del taller.
 *
 * <p>Toda la funcionalidad proviene del sistema web servido por el servidor configurado: ordenes,
 * clientes, vehiculos, inventario, compras, caja, reportes y consola SaaS. La app aporta lo que un
 * navegador no da: instalacion propia, sesion persistente, subida de archivos, descargas y
 * actualizacion automatica del propio APK.
 *
 * <p>La navegacion se limita al servidor configurado; cualquier otro enlace se abre en el navegador
 * del sistema, de modo que el puente JavaScript solo queda expuesto al origen propio.
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "Mecan";
    private static final long CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000;

    private WebView web;
    private SwipeRefreshLayout refresh;
    private ProgressBar progress;
    private View offline;
    private android.widget.TextView offlineDetail;
    private Prefs prefs;
    private boolean searching;
    private String baseUrl = "";
    private boolean loadFailed;
    private ValueCallback<Uri[]> fileCallback;

    private final ActivityResultLauncher<Intent> filePicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileCallback == null) return;
                fileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData()));
                fileCallback = null;
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        baseUrl = prefs.serverUrl();
        if (baseUrl.isEmpty()) {
            startActivity(new Intent(this, ServerSetupActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        web = findViewById(R.id.web);
        refresh = findViewById(R.id.refresh);
        progress = findViewById(R.id.progress);
        offline = findViewById(R.id.offline);
        offlineDetail = findViewById(R.id.offline_detail);

        findViewById(R.id.offline_retry).setOnClickListener(view -> reload());
        findViewById(R.id.offline_server).setOnClickListener(view -> openSetup());
        refresh.setColorSchemeResources(R.color.brand);
        refresh.setOnRefreshListener(this::reload);

        configureWebView();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        // restoreState devuelve null cuando el estado guardado no sirve; sin este respaldo la
        // pantalla quedaria en blanco al volver despues de que el sistema matara el proceso.
        boolean restored = savedInstanceState != null && web.restoreState(savedInstanceState) != null;
        if (!restored) web.loadUrl(baseUrl + "/");
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // El contenedor no lee el sistema de archivos: solo habla con el servidor del taller.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // ngrok intercala una pantalla de aviso ante cualquier peticion con User-Agent de
        // navegador, y dentro de la app eso dejaria la sesion trabada en un aviso que nadie puede
        // aceptar. Con un User-Agent propio la omite. Solo se cambia en dominios de ngrok: contra un
        // dominio propio conviene el User-Agent real del WebView, que es el que espera la web.
        // UpdateManager ya usa este mismo User-Agent, por eso el manifiesto y el APK nunca chocaron
        // con la pantalla intermedia aunque la navegacion si lo hiciera.
        String host = Uri.parse(baseUrl).getHost();
        boolean viaNgrok = host != null
                && (host.endsWith(".ngrok-free.app") || host.endsWith(".ngrok.app")
                        || host.endsWith(".ngrok.dev") || host.endsWith(".ngrok.io"));
        settings.setUserAgentString(viaNgrok
                ? UpdateManager.userAgent()
                : settings.getUserAgentString() + " " + UpdateManager.userAgent());

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new WebBridge(), "MecanApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (isOwnServer(target)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (Exception exception) {
                    Log.w(TAG, "No se pudo abrir el enlace externo", exception);
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
                progress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                refresh.setRefreshing(false);
                offline.setVisibility(loadFailed ? View.VISIBLE : View.GONE);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Solo el documento principal decide si la pantalla queda en modo sin conexion.
                if (!request.isForMainFrame()) return;
                loadFailed = true;
                refresh.setRefreshing(false);
                showOffline();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    filePicker.launch(params.createIntent());
                    return true;
                } catch (Exception exception) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        // Exportaciones CSV, comprobantes y adjuntos se descargan con la sesion vigente.
        web.setDownloadListener((url, userAgent, disposition, mime, size) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                request.addRequestHeader("User-Agent", userAgent);
                request.setMimeType(mime);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalFilesDir(this,
                        android.os.Environment.DIRECTORY_DOWNLOADS, fileName(url, disposition));
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, R.string.downloading_file, Toast.LENGTH_SHORT).show();
            } catch (Exception exception) {
                Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_LONG).show();
            }
        });
    }

    private static String fileName(String url, String disposition) {
        String name = android.webkit.URLUtil.guessFileName(url, disposition, null);
        return name == null || name.isEmpty() ? "mecan-descarga" : name;
    }

    private boolean isOwnServer(Uri target) {
        try {
            URL configured = new URL(baseUrl);
            String scheme = target.getScheme();
            String host = target.getHost();
            if (scheme == null || host == null) return false;
            return configured.getProtocol().equalsIgnoreCase(scheme)
                    && configured.getHost().equalsIgnoreCase(host)
                    && UpdateManager.effectivePort(configured.getProtocol(), configured.getPort())
                    == UpdateManager.effectivePort(scheme, target.getPort());
        } catch (Exception exception) {
            return false;
        }
    }

    private void reload() {
        loadFailed = false;
        offline.setVisibility(View.GONE);
        if (web.getUrl() == null) web.loadUrl(baseUrl + "/");
        else web.reload();
    }

    /**
     * Deja la pantalla en modo sin conexion, buscando antes el servidor en la red local.
     *
     * <p>En una red domestica el router puede darle otra direccion a la PC despues de un
     * reinicio, y entonces la que la app tiene guardada deja de responder aunque el sistema este
     * funcionando. Antes de decir que no hay conexion —lo que mandaria a la persona a escribir
     * una direccion a mano en cada telefono— se revisa la red por si el sistema esta en otra.
     */
    private void showOffline() {
        if (searching) return;
        offline.setVisibility(View.VISIBLE);
        if (!ServerFinder.searchable(baseUrl)) {
            progress.setVisibility(View.GONE);
            offlineDetail.setText(R.string.offline_body);
            return;
        }
        searching = true;
        offlineDetail.setText(R.string.searching_body);
        progress.setVisibility(View.VISIBLE);
        ServerFinder.find(this, baseUrl, found -> {
            searching = false;
            if (isFinishing() || isDestroyed()) return;
            progress.setVisibility(View.GONE);
            if (found == null) {
                offlineDetail.setText(R.string.offline_body);
                return;
            }
            // Queda guardada: el proximo arranque entra directo, sin volver a recorrer la red.
            prefs.setServerUrl(found);
            baseUrl = found;
            Toast.makeText(this, getString(R.string.server_found, ServerFinder.readable(found)),
                    Toast.LENGTH_LONG).show();
            loadFailed = false;
            offline.setVisibility(View.GONE);
            // No sirve web.reload(): recargaria la direccion vieja, que es la que fallo.
            web.loadUrl(baseUrl + "/");
        });
    }

    private void openSetup() {
        startActivity(new Intent(this, ServerSetupActivity.class));
        finish();
    }

    @Override
    protected void onResume() {
        super.onResume();
        maybeCheckForUpdates(false);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    /**
     * Consulta si hay una version publicada mas nueva.
     *
     * @param manual true cuando lo pidio la persona: entonces siempre consulta e informa el
     *               resultado, incluso si ya tiene la ultima version.
     */
    private void maybeCheckForUpdates(boolean manual) {
        if (baseUrl.isEmpty()) return;
        long elapsed = System.currentTimeMillis() - prefs.lastUpdateCheck();
        if (!manual && elapsed < CHECK_INTERVAL_MS) return;
        UpdateManager.check(baseUrl, (release, error) -> {
            prefs.markUpdateChecked();
            if (isFinishing() || isDestroyed()) return;
            if (error != null) {
                if (manual) Toast.makeText(this, R.string.update_check_failed, Toast.LENGTH_LONG).show();
                return;
            }
            if (!UpdateManager.isNewer(this, release)) {
                if (manual) {
                    Toast.makeText(this,
                            getString(R.string.update_none, BuildConfig.VERSION_NAME),
                            Toast.LENGTH_LONG).show();
                }
                return;
            }
            // Una version pospuesta no vuelve a interrumpir sola, pero una obligatoria si,
            // y la consulta manual siempre la muestra.
            boolean postponed = prefs.skippedVersionCode() == release.versionCode;
            if (!manual && postponed && !release.mandatory) return;
            UpdateManager.promptInstall(this, release, null);
        });
    }

    /** Puente minimo para que la web pueda ofrecer acciones propias de la app instalada. */
    private final class WebBridge {
        @JavascriptInterface
        public boolean isApp() {
            return true;
        }

        @JavascriptInterface
        public String versionName() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public String serverUrl() {
            return baseUrl;
        }

        @JavascriptInterface
        public void checkForUpdates() {
            runOnUiThread(() -> maybeCheckForUpdates(true));
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle(R.string.change_server)
                        .setMessage(String.format(Locale.getDefault(), "%s\n\n%s", baseUrl,
                                getString(R.string.setup_intro)))
                        .setPositiveButton(R.string.change_server, (dialog, which) -> openSetup())
                        .setNegativeButton(R.string.cancel, null)
                        .show();
            });
        }
    }
}
