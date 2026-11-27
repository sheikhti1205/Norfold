package com.findback.app;

import com.findback.app.LocationServicesPlugin;
import com.findback.app.map.FindbackMapPlugin;
import com.findback.app.GoogleAuthPlugin;
import com.findback.app.DriveAuthPlugin;
import com.findback.app.FindbackNotificationsPlugin;
import com.findback.app.shortlink.ShortLinkResolverPlugin;
import com.findback.app.download.ModelDownloadPlugin;
import com.findback.app.needle.FindbackNeedle;
import com.findback.app.vlm.FindBackDiagPlugin;
import com.findback.app.vlm.EmbeddingPlugin;
import com.findback.app.OpenRouterKeyPlugin;
import com.getcapacitor.BridgeActivity;
import com.findback.app.media.FindbackMediaPlugin;
import com.findback.app.file.FindbackFileExportPlugin;
import com.findback.app.messaging.FindbackMessagingSqlitePlugin;
import com.findback.app.messaging.NorfoldDeviceIdentityPlugin;
import com.findback.app.push.ChatPushState;
import android.content.Intent;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Capture before BridgeActivity forwards launch data to plugins. Cold
        // taps stay in private storage until the JS session actually rehydrates.
        captureChatIntent(getIntent());
        registerPlugin(ShortLinkResolverPlugin.class);
        registerPlugin(FindBackDiagPlugin.class);
        registerPlugin(ModelDownloadPlugin.class);
        registerPlugin(com.findback.app.update.AppUpdatePlugin.class);
        registerPlugin(FindbackNeedle.class);
        registerPlugin(OpenRouterKeyPlugin.class);
        registerPlugin(EmbeddingPlugin.class);
        registerPlugin(LocationServicesPlugin.class);
        registerPlugin(FindbackMapPlugin.class);
        registerPlugin(GoogleAuthPlugin.class);
        registerPlugin(DriveAuthPlugin.class);
        registerPlugin(FindbackNotificationsPlugin.class);
        registerPlugin(FindbackMediaPlugin.class);
        registerPlugin(FindbackFileExportPlugin.class);
        registerPlugin(FindbackMessagingSqlitePlugin.class);
        registerPlugin(NorfoldDeviceIdentityPlugin.class);
        registerPlugin(SystemColorsPlugin.class);
        registerPlugin(DataEpochPlugin.class);
        // Read-only IME state for the editor rail: the adjusting window reports
        // equal layout and visual heights with the keyboard up, so JS cannot
        // detect it. This plugin only reads WindowInsetsCompat; it installs no
        // insets listener of its own.
        registerPlugin(ImeInsetsPlugin.class);
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null && savedInstanceState.getBundle("findbackMediaRequest") != null) {
            mediaPlugin().restoreMediaRequestState(savedInstanceState.getBundle("findbackMediaRequest"));
        }
    }
    /**
     * BridgeActivity inflates Capacitor's library layout first; the app-owned
     * layout replaces it here so Bridge.Builder.create() finds this app's
     * KeyboardMediaWebView at the canonical @id/webview and wires the bridge to
     * it. Nothing else about the activity changes.
     */
    @Override
    protected void load() {
        setContentView(R.layout.activity_main);
        super.load();
    }
    @Override
    public void onNewIntent(Intent intent) {
        boolean chat = ChatPushState.ACTION_TAP.equals(intent.getAction());
        boolean captured = captureChatIntent(intent);
        Intent safe = chat ? new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN) : intent;
        setIntent(safe);
        super.onNewIntent(safe);
        if (captured && getBridge() != null && getBridge().getPlugin("FindbackNotifications") != null) {
            ((FindbackNotificationsPlugin) getBridge().getPlugin("FindbackNotifications").getInstance()).chatTapAvailable();
        }
    }
    private boolean captureChatIntent(Intent intent) {
        if (intent == null || !ChatPushState.ACTION_TAP.equals(intent.getAction())) return false;
        boolean captured = false;
        try { captured = ChatPushState.capture(this, intent); } catch (Exception ignored) { /* fail closed */ }
        // Never allow even a forged chat Intent to enter the public-link or
        // Capacitor push-action paths. Only our private pending record is used.
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN));
        return captured;
    }
    /**
     * Foreground loss withdraws keyboard insertion immediately, before the
     * WebView is asked to re-render: the IME may hold an editor session that
     * the JS page can no longer supervise.
     */
    @Override
    public void onPause() {
        super.onPause();
        if (getBridge() == null || getBridge().getPlugin("FindbackMedia") == null) return;
        ((FindbackMediaPlugin) getBridge().getPlugin("FindbackMedia").getInstance()).onHostPaused();
    }
    @Override public void onSaveInstanceState(android.os.Bundle outState) {
        android.os.Bundle media = mediaPlugin().saveMediaRequestState();
        if (media != null) outState.putBundle("findbackMediaRequest", media);
        super.onSaveInstanceState(outState);
    }
    private FindbackMediaPlugin mediaPlugin() {
        return (FindbackMediaPlugin) getBridge().getPlugin("FindbackMedia").getInstance();
    }
}
