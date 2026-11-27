package com.findback.app;

import android.app.Activity;
import android.view.View;
import android.view.ViewTreeObserver;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Authoritative soft-keyboard *visibility* from Android's window insets.
 *
 * The main activity resizes its window with the IME, so the bridge WebView
 * reports the same layout and visual height while the keyboard is up (measured
 * on device: 582 / 582). JavaScript geometry therefore cannot tell an open
 * keyboard from a short screen; WindowInsetsCompat can, and it is the only
 * honest visibility answer on this runtime.
 *
 * Only visibility is published. A root IME inset is measured in window
 * coordinates, before a resizing window consumes it, so handing it to CSS as a
 * bottom offset would double-subtract and lift the rail into the form. The
 * WebView measures its own occlusion (or the absence of one) instead.
 *
 * This class is read-only and additive: it observes layout passes on the decor
 * view and reads the root window insets on demand. It never installs an
 * OnApplyWindowInsetsListener, so Capacitor's own inset handling — and the map
 * activity's — is left exactly as it is.
 */
@CapacitorPlugin(name = "FindbackIme")
public class ImeInsetsPlugin extends Plugin {

    /** A bottom inset smaller than this is a navigation bar, never a keyboard. */
    private static final int MIN_IME_DP = 120;

    private ViewTreeObserver.OnGlobalLayoutListener layoutListener;
    private boolean lastVisible;
    private boolean lastKnown;

    @Override
    public void load() {
        super.load();
        attach();
    }

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        attach();
        publish(read());
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        publish(read());
    }

    @Override
    protected void handleOnDestroy() {
        detach();
        super.handleOnDestroy();
    }

    /** Current visibility, or an explicit "unknown" so JS falls back to geometry. */
    @PluginMethod
    public void getImeState(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(unknown());
            return;
        }
        // WindowInsetsCompat is a UI-thread read; PluginCall handlers run on the
        // bridge thread. The lifecycle callbacks and layout listener below are
        // already on the UI thread.
        activity.runOnUiThread(() -> {
            JSObject state = read();
            call.resolve(state != null ? state : unknown());
        });
    }

    private JSObject unknown() {
        JSObject state = new JSObject();
        state.put("known", false);
        state.put("visible", false);
        return state;
    }

    private void attach() {
        View decor = decorView();
        if (decor == null || layoutListener != null) return;
        layoutListener = () -> publish(read());
        decor.getViewTreeObserver().addOnGlobalLayoutListener(layoutListener);
    }

    private void detach() {
        View decor = decorView();
        if (decor == null || layoutListener == null) return;
        ViewTreeObserver observer = decor.getViewTreeObserver();
        if (observer.isAlive()) observer.removeOnGlobalLayoutListener(layoutListener);
        layoutListener = null;
    }

    private View decorView() {
        Activity activity = getActivity();
        return activity == null ? null : activity.getWindow().getDecorView();
    }

    /**
     * Null when the platform cannot read insets. Only visibility is answered:
     * an adjusting window has already resized its content, so its root IME
     * inset is not a safe CSS offset. `bottom` is used solely to recognise the
     * IME on platforms where `isVisible` does not report it.
     */
    private JSObject read() {
        View decor = decorView();
        if (decor == null) return null;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
        if (insets == null) return null;

        int bottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        float density = decor.getResources().getDisplayMetrics().density;
        if (!(density > 0f)) density = 1f;
        int minPx = Math.round(MIN_IME_DP * density);
        boolean visible = insets.isVisible(WindowInsetsCompat.Type.ime()) || bottom > minPx;

        JSObject state = new JSObject();
        state.put("known", true);
        state.put("visible", visible);
        return state;
    }

    private void publish(JSObject state) {
        if (state == null) return;
        boolean known = state.optBoolean("known", false);
        boolean visible = state.optBoolean("visible", false);
        if (known == lastKnown && visible == lastVisible) return;
        lastKnown = known;
        lastVisible = visible;
        notifyListeners("imeStateChanged", state);
    }
}
