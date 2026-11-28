package com.findback.app.push

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin
import com.findback.app.FindbackApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Replaces the Capacitor push plugin's MessagingService (removed in the app
 * manifest) so data-only messages can be presented natively with a RemoteInput
 * reply action while still forwarding to the plugin when a bridge is alive.
 *
 * Chat: only the conversation that is actually on screen (foreground AND the
 * reported route is that conversation) skips presentation; JS is still told so
 * the open thread refreshes. Any other screen, or a backgrounded app, posts the
 * notification.
 *
 * Comment, like, dislike and the rest: always presented, wherever the app is,
 * and also forwarded when a bridge exists so the in-app Activity list and bell
 * keep updating live. `PushChannels.notificationsAllowed` stays the single
 * authority on whether Android may show anything at all.
 */
class FindbackMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["type"].orEmpty().startsWith("CHAT_")) {
            val chat = ChatPushData.fromData(message.data) ?: return
            // "Already on screen", not merely "foreground": being elsewhere in
            // the app still needs a notification.
            val onScreen = PushPresence.isChatOpen(
                PushPresence.activeRoute, chat.conversationId, FindbackApp.foreground)
            try {
                ChatPushState.deliver(this, chat, onScreen) { PushNotificationsPlugin.sendRemoteMessage(message) }
            } catch (_: Exception) { /* Cached admission/persistence failed: never forward or present. */ }
            return
        }
        // Always forward: foreground JS events, and the plugin's lastMessage
        // stash for a cold/background launch.
        PushNotificationsPlugin.sendRemoteMessage(message)

        // Engagement is never gated on the open screen: the in-app Activity
        // list gets the event through the forward above, and the OS
        // notification is posted here as well. The presenter applies
        // `PushChannels.notificationsAllowed` and the per-type channel.
        val push = PushData.fromData(message.data) ?: return
        NotificationPresenter(this).show(push)
    }

    override fun onNewToken(token: String) {
        // Registration token for the plugin's `registration` event.
        PushNotificationsPlugin.onNewToken(token)
    }
}
