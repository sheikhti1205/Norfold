package com.findback.app.push

/**
 * Which screen the SPA is actually showing.
 *
 * The FCM thread must never read `WebView.url` (the WebView is not thread
 * safe), so JS reports the router's visible path here through the
 * `FindbackNotifications` plugin. "Foreground" alone means "some Norfold screen
 * is open", which is too coarse: only the pushed conversation itself being on
 * screen may suppress its notification.
 *
 * The matching is a pure function of (route, conversation, foreground) so it is
 * exercised on the JVM without an Android runtime.
 */
object PushPresence {
    /** Longer than any real route; a value this long is not a route we trust. */
    private const val MAX_ROUTE = 512

    /**
     * Latest reported path (`/chats/<id>`, `/posts/<id>`, `/`, …). Empty means
     * "no specific screen is known", which never suppresses a notification.
     */
    @Volatile
    var activeRoute: String = ""
        private set

    /**
     * Stores the path JS reported and returns what was stored. Anything that is
     * not a rooted path fails open to "unknown": a malformed report must not be
     * able to hide a push.
     */
    @JvmStatic fun setRoute(value: String?): String {
        val trimmed = value?.trim().orEmpty()
        activeRoute = if (trimmed.startsWith("/") && trimmed.length <= MAX_ROUTE) trimmed else ""
        return activeRoute
    }

    /**
     * True only when the foreground app is showing exactly this conversation.
     *
     * Exact path equality, never a prefix: `/chats/ab` says nothing about the
     * conversation `/chats/abc`, and a query or fragment after the exact path
     * does not change which screen is visible. A background app, an unknown
     * route or an empty conversation id never suppresses.
     */
    @JvmStatic fun isChatOpen(route: String?, conversationId: String?, foreground: Boolean): Boolean {
        if (!foreground) return false
        val conversation = conversationId?.trim().orEmpty()
        if (conversation.isEmpty()) return false
        val path = route?.trim().orEmpty().substringBefore('?').substringBefore('#')
        return path == "/chats/$conversation"
    }
}
