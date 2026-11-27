import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

/**
 * Authoritative soft-keyboard *visibility* from the Android shell.
 *
 * The main activity resizes its window with the IME, so the WebView reports the
 * same layout and visual height while the keyboard is up (measured on device:
 * 582 / 582). No amount of viewport geometry can tell that state apart from a
 * short screen; `WindowInsetsCompat.Type.ime()` can. Everywhere else the bridge
 * is absent and the caller falls back to its own geometry.
 *
 * Only visibility is published. Where the rail goes is a WebView question: a
 * resizing window has already ended at the IME's top edge, while an overlaying
 * IME leaves it to `visualViewport`. A raw root IME inset would be measured in
 * window coordinates and would double-subtract once the window had resized.
 */
export interface NativeImeState {
  /** False when this runtime cannot read insets; the caller must not guess. */
  known: boolean;
  visible: boolean;
}

interface NativeImeBridge {
  getImeState(): Promise<NativeImeState>;
  addListener(
    event: "imeStateChanged",
    handler: (state: NativeImeState) => void,
  ): Promise<PluginListenerHandle>;
}

let bridge: NativeImeBridge | null = null;

/**
 * The platform guard runs *before* `registerPlugin`, so a browser page, the
 * iOS shell and a partial test double can never reach the Android bridge.
 */
function isAndroidApp(): boolean {
  return typeof Capacitor.isNativePlatform === "function"
    && Capacitor.isNativePlatform()
    && typeof Capacitor.getPlatform === "function"
    && Capacitor.getPlatform() === "android";
}

function native(): NativeImeBridge | null {
  if (!isAndroidApp() || typeof registerPlugin !== "function") return null;
  bridge ??= registerPlugin<NativeImeBridge>("FindbackIme");
  return bridge;
}

/**
 * Subscribe to the shell's IME readings. Returns its own unsubscribe; the
 * initial reading is delivered asynchronously, exactly like a pushed one, so a
 * caller that mounts while the keyboard is already open gets it too.
 */
export function subscribeNativeIme(sink: (state: NativeImeState) => void): () => void {
  const api = native();
  if (!api) return () => {};
  let cancelled = false;
  let handle: PluginListenerHandle | null = null;
  const deliver = (state: NativeImeState) => {
    if (cancelled || typeof state !== "object" || state === null) return;
    sink({
      known: state.known === true,
      visible: state.visible === true,
    });
  };
  void api.getImeState().then(deliver).catch(() => {});
  void api.addListener("imeStateChanged", deliver)
    .then((attached) => {
      if (cancelled) void attached.remove();
      else handle = attached;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    void handle?.remove();
    handle = null;
  };
}
