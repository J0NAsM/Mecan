package py.softshop.mecan;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Encuentra el servidor del taller en la red local cuando su direccion cambio.
 *
 * En una red domestica el router reparte las direcciones y puede darle otra a la PC despues de un
 * reinicio. La direccion que la app trae compilada deja de servir y, sin esto, habria que
 * escribirla a mano en cada telefono. Aca se recorre la propia red buscando el sistema.
 *
 * No alcanza con que algo conteste en ese puerto: se exige la forma exacta del estado de salud de
 * este sistema, igual que hacen scripts/tunnel.js y scripts/start-desktop.js del lado del servidor.
 * Una impresora o un router con panel web contestan 200 a cualquier cosa, y apuntar la app a una de
 * esas seria peor que no encontrar nada, porque la persona veria una pantalla ajena creyendo que es
 * la suya.
 *
 * Solo se busca cuando la direccion configurada es http hacia una IP privada. Si el servidor es un
 * dominio publico —el tunel— la direccion no cambia y recorrer la red no tendria ningun sentido.
 */
final class ServerFinder {

    interface Found {
        /** @param baseUrl direccion encontrada, o null si no aparecio ninguna. */
        void onResult(String baseUrl);
    }

    private static final String TAG = "MecanFinder";
    // Timeouts cortos: se prueban decenas de direcciones y casi todas no tienen nada escuchando.
    private static final int CONNECT_TIMEOUT_MS = 400;
    private static final int READ_TIMEOUT_MS = 800;
    private static final int THREADS = 48;
    private static final int TOTAL_TIMEOUT_S = 12;
    private static final int DEFAULT_PORT = 3000;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private ServerFinder() {}

    /** Indica si recorrer la red puede servir para esta direccion. */
    static boolean searchable(String baseUrl) {
        try {
            URL url = new URL(baseUrl);
            if (!"http".equalsIgnoreCase(url.getProtocol())) return false;
            return isPrivateIPv4(url.getHost());
        } catch (Exception exception) {
            return false;
        }
    }

    /**
     * Busca el sistema en la red del telefono y devuelve el resultado en el hilo principal.
     *
     * @param previous direccion que dejo de responder; de ahi se toma el puerto.
     */
    static void find(Context context, String previous, Found callback) {
        new Thread(() -> {
            String result = null;
            try {
                result = search(context, portOf(previous));
            } catch (Exception exception) {
                Log.w(TAG, "Fallo la busqueda en la red", exception);
            }
            String found = result;
            MAIN.post(() -> callback.onResult(found));
        }, "mecan-finder").start();
    }

    private static String search(Context context, int port) throws Exception {
        List<String> hosts = neighbours(context);
        if (hosts.isEmpty()) return null;

        List<Callable<String>> probes = new ArrayList<>(hosts.size());
        for (String host : hosts) probes.add(() -> probe(host, port));

        ExecutorService pool = Executors.newFixedThreadPool(Math.min(THREADS, probes.size()));
        try {
            // invokeAny devuelve la primera que responda como este sistema y cancela el resto:
            // no hace falta recorrer la red entera cuando ya aparecio.
            return pool.invokeAny(probes, TOTAL_TIMEOUT_S, TimeUnit.SECONDS);
        } catch (Exception exception) {
            // Que ninguna responda no es un error a reportar: es el caso normal cuando la PC esta
            // apagada o el telefono esta en otra red.
            return null;
        } finally {
            pool.shutdownNow();
        }
    }

    /** Direcciones de la misma red que el telefono, sin la suya ni las reservadas. */
    private static List<String> neighbours(Context context) {
        List<String> hosts = new ArrayList<>();
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) return hosts;
        Network network = manager.getActiveNetwork();
        if (network == null) return hosts;
        LinkProperties properties = manager.getLinkProperties(network);
        if (properties == null) return hosts;

        for (LinkAddress address : properties.getLinkAddresses()) {
            if (!(address.getAddress() instanceof Inet4Address)) continue;
            String own = address.getAddress().getHostAddress();
            if (own == null || !isPrivateIPv4(own)) continue;
            // Se recorre siempre el /24 del telefono. Una red mas amplia (un /16, por ejemplo)
            // tendria decenas de miles de direcciones: recorrerlas tardaria demasiado para que a
            // alguien le sirva, y en la practica el servidor esta en el mismo /24.
            int lastDot = own.lastIndexOf('.');
            if (lastDot < 0) continue;
            String prefix = own.substring(0, lastDot + 1);
            for (int last = 1; last <= 254; last += 1) {
                String candidate = prefix + last;
                if (!candidate.equals(own)) hosts.add(candidate);
            }
            break;
        }
        return hosts;
    }

    /** Devuelve la direccion base si ahi responde este sistema; si no, lanza. */
    private static String probe(String host, int port) throws Exception {
        String base = "http://" + host + ":" + port;
        HttpURLConnection connection = (HttpURLConnection) new URL(base + "/health").openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", UpdateManager.userAgent());
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK)
                throw new Exception("sin estado de salud");
            JSONObject health = new JSONObject(
                    new String(readAll(connection.getInputStream()), StandardCharsets.UTF_8));
            if (!health.has("database") || !health.has("migrations"))
                throw new Exception("responde otra cosa");
            return base;
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] readAll(InputStream input) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[1024];
        int read;
        // El estado de salud son unos pocos cientos de bytes. El limite evita quedarse leyendo algo
        // que no lo sea y que responda un flujo interminable.
        while ((read = input.read(chunk)) != -1 && buffer.size() < 4096) buffer.write(chunk, 0, read);
        return buffer.toByteArray();
    }

    private static int portOf(String baseUrl) {
        try {
            int port = new URL(baseUrl).getPort();
            return port > 0 ? port : DEFAULT_PORT;
        } catch (Exception exception) {
            return DEFAULT_PORT;
        }
    }

    /** Rangos privados de la RFC 1918, mas el enlace local que usa Android sin DHCP. */
    private static boolean isPrivateIPv4(String host) {
        if (host == null) return false;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int first;
        int second;
        try {
            first = Integer.parseInt(parts[0]);
            second = Integer.parseInt(parts[1]);
            for (String part : parts) {
                int value = Integer.parseInt(part);
                if (value < 0 || value > 255) return false;
            }
        } catch (NumberFormatException exception) {
            return false;
        }
        if (first == 10) return true;
        if (first == 192 && second == 168) return true;
        if (first == 172 && second >= 16 && second <= 31) return true;
        return first == 169 && second == 254;
    }

    /** Solo para mensajes: la direccion sin el esquema, que es lo que la persona reconoce. */
    static String readable(String baseUrl) {
        return baseUrl == null ? "" : baseUrl.replaceFirst("(?i)^https?://", "").toLowerCase(Locale.ROOT);
    }
}
