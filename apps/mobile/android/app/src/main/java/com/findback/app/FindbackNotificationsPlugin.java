package com.findback.app;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.findback.app.push.ChatPushData;
import com.findback.app.push.ChatPushState;
import com.google.firebase.FirebaseOptions;

/**
 * Opens the OS-level Norfold notification settings so a user who denied the
 * Android 13+ permission can re-enable it. The in-app inbox never depends on
 * this; it is purely a recovery path from the notification settings UI.
 */
@CapacitorPlugin(name = "FindbackNotifications")
public class FindbackNotificationsPlugin extends Plugin {
    /**
     * Whether this build carries a usable Firebase Android client config.
     *
     * A build without google-services.json never initialises FirebaseApp, and
     * every FirebaseMessaging call then throws IllegalStateException. Capacitor
     * rethrows plugin exceptions on its handler thread (Bridge.java:856), so the
     * process dies before any JS catch can run. JS asks this first and never
     * calls register()/unregister() when the answer is false.
     *
     * Reads the generated string resources rather than FirebaseApp.getApps():
     * the app list is populated by an async startup provider, so it can still be
     * empty during the first seconds of a correctly configured launch.
     */
    @PluginMethod
    public void isPushConfigured(PluginCall call) {
        JSObject result = new JSObject();
        boolean configured;
        try {
            configured = FirebaseOptions.fromResource(getContext()) != null;
        } catch (Exception error) {
            // Fail closed: an unreadable config would crash on the first
            // FirebaseMessaging call, and a crash is worse than inert push.
            configured = false;
        }
        result.put("configured", configured);
        call.resolve(result);
    }

    @PluginMethod
    public void setChatAccount(PluginCall call) {
        String account = call.getString("accountId");
        if (account != null && !account.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            call.reject("Invalid notification account");
            return;
        }
        try {
            ChatPushState.bind(getContext(), account);
            call.resolve();
        } catch (Exception error) { call.reject("Notification account could not be saved"); }
    }

    @PluginMethod
    public void takeChatTap(PluginCall call) {
        String account = call.getString("accountId");
        if (account == null) { call.reject("Notification account required"); return; }
        try {
            ChatPushData tap = ChatPushState.take(getContext(), account);
            JSObject result = new JSObject();
            if (tap != null) {
                JSObject data = new JSObject();
                data.put("type", tap.getType());
                data.put("recipientId", tap.getRecipientId());
                data.put("conversationId", tap.getConversationId());
                data.put("notificationId", tap.getNotificationId());
                result.put("data", data);
            }
            call.resolve(result);
        } catch (Exception error) { call.reject("Notification action unavailable"); }
    }

    public void chatTapAvailable() { notifyListeners("chatTapAvailable", new JSObject()); }

    @PluginMethod
    public void acknowledgeChatTap(PluginCall call) {
        String account = call.getString("accountId");
        String wake = call.getString("notificationId");
        if (account == null || wake == null) { call.reject("Notification action required"); return; }
        try {
            ChatPushState.acknowledge(getContext(), account, wake);
            call.resolve();
        } catch (Exception error) { call.reject("Notification action could not be saved"); }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getContext().startActivity(intent);
        call.resolve();
    }
}
