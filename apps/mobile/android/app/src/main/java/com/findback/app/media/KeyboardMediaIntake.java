package com.findback.app.media;

import android.net.Uri;
import android.os.Bundle;
import androidx.core.view.inputmethod.InputContentInfoCompat;

/**
 * One process-wide hand-off from the app-owned WebView to the media plugin.
 *
 * The WebView decides only whether a live composer is advertising and whether
 * the commit has a usable content:// handle. The plugin owns permissions, the
 * worker, the bounded cache and every error path. If no plugin receiver is
 * registered the commit is refused, so nothing can leak a grant.
 */
public final class KeyboardMediaIntake {
    /** The only MIME types a live chat composer advertises to the IME. */
    public static final String[] MIME_TYPES = {
            "image/jpeg", "image/png", "image/gif", "image/webp",
    };

    public interface Receiver {
        /**
         * Called on the UI thread with a granted content handle. The receiver
         * owns the copy and MUST release the grant when it finishes.
         */
        boolean receive(InputContentInfoCompat content, int flags, Bundle opts);
    }

    private static volatile Receiver receiver;

    private KeyboardMediaIntake() {}

    public static boolean isEligible() {
        return KeyboardMediaState.shared().eligible() && receiver != null;
    }

    static void register(Receiver next) {
        receiver = next;
    }

    static void unregister(Receiver expected) {
        if (receiver == expected) receiver = null;
    }

    public static boolean receive(InputContentInfoCompat content, int flags, Bundle opts) {
        Receiver current = receiver;
        if (current == null || content == null) return false;
        Uri uri = content.getContentUri();
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getAuthority() == null) return false;
        return current.receive(content, flags, opts);
    }
}
