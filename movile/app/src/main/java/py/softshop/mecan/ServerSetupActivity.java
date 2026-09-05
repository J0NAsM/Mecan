package py.softshop.mecan;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.net.URL;
import java.util.Locale;

/**
 * Primera pantalla cuando la app todavia no sabe donde esta publicado el sistema del taller,
 * y tambien la via para cambiar de servidor mas adelante.
 */
public class ServerSetupActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_setup);

        Prefs prefs = new Prefs(this);
        EditText input = findViewById(R.id.server_url);
        TextView error = findViewById(R.id.server_error);
        Button save = findViewById(R.id.server_save);
        TextView version = findViewById(R.id.version_label);

        input.setText(prefs.serverUrl());
        version.setText(String.format(Locale.getDefault(), "%s %s (%d)",
                getString(R.string.app_name), BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE));

        save.setOnClickListener(view -> {
            String value = Prefs.normalize(input.getText().toString());
            if (!isUsable(value)) {
                error.setVisibility(View.VISIBLE);
                return;
            }
            error.setVisibility(View.GONE);
            prefs.setServerUrl(value);
            Intent main = new Intent(this, MainActivity.class);
            main.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(main);
            finish();
        });
    }

    /**
     * Acepta una direccion completa y con host real. La compilacion de publicacion exige HTTPS
     * porque por ese mismo canal viaja la actualizacion del APK; la de depuracion admite HTTP
     * para poder apuntar a un servidor de desarrollo en la red local.
     */
    private static boolean isUsable(String value) {
        if (value.isEmpty()) return false;
        try {
            URL url = new URL(value);
            if (url.getHost() == null || url.getHost().isEmpty()) return false;
            if ("https".equalsIgnoreCase(url.getProtocol())) return true;
            return BuildConfig.DEBUG && "http".equalsIgnoreCase(url.getProtocol());
        } catch (Exception exception) {
            return false;
        }
    }
}
