package com.findback.app;

import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import androidx.core.view.inputmethod.InputConnectionCompat;
import androidx.core.view.inputmethod.InputContentInfoCompat;
import com.findback.app.media.KeyboardMediaIntake;
import com.getcapacitor.Bridge;
import com.getcapacitor.CapacitorWebView;

/**
 * The app's bridge WebView with keyboard/provider image insertion attached.
 *
 * The behavior is scoped to the moment an input connection is created: when a
 * live chat composer has advertised itself, the browser's own connection is
 * wrapped so the IME can commit an image. Everything else (text, IME
 * composition, plain paste, inputs that never advertised) keeps the stock
 * Capacitor connection untouched, and the IME is never restarted to force an
 * advertisement mid-composition — a newly eligible field starts accepting on
 * its next focus or IME restart.
 *
 * The content URI grant is requested here and released by the receiver (or
 * immediately, when the commit is refused). No URI, path or byte ever reaches
 * JavaScript from this class.
 */
public final class KeyboardMediaWebView extends CapacitorWebView {
    private Bridge bridge;

    public KeyboardMediaWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public void setBridge(Bridge bridge) {
        super.setBridge(bridge);
        this.bridge = bridge;
    }

    @Override
    @SuppressWarnings("deprecation")
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection base = super.onCreateInputConnection(outAttrs);
        if (base == null) return null;
        if (bridge != null && bridge.getConfig().isInputCaptured()) return base;
        // The commit-content path only exists from API 25; never pretend the
        // IME can insert an image where the platform cannot carry one.
        if (Build.VERSION.SDK_INT < 25) return base;
        if (!KeyboardMediaIntake.isEligible()) return base;
        outAttrs.contentMimeTypes = KeyboardMediaIntake.MIME_TYPES.clone();
        // The three-argument overload never requests or releases the grant on
        // our behalf, so this listener owns both ends in a single path.
        return InputConnectionCompat.createWrapper(base, outAttrs,
                (contentInfo, flags, opts) -> commit(contentInfo, flags, opts));
    }

    private boolean commit(InputContentInfoCompat contentInfo, int flags, Bundle opts) {
        boolean granted = false;
        if ((flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0) {
            try {
                contentInfo.requestPermission();
                granted = true;
            } catch (Exception denied) {
                // No readable grant: the receiver could not copy this item,
                // so refuse it instead of handing over an unreadable handle.
                return false;
            }
        }
        boolean accepted;
        try {
            accepted = KeyboardMediaIntake.receive(contentInfo, flags, opts);
        } catch (RuntimeException refused) {
            accepted = false;
        }
        if (!accepted && granted) {
            try {
                contentInfo.releasePermission();
            } catch (Exception ignored) {
                // A grant that already lapsed needs no second release.
            }
        }
        return accepted;
    }
}
