/**
 * Loader for the Google Maps JavaScript API on the web build.
 *
 * The API is bootstrapped with the documented script-tag + `callback` form
 * (the Dynamic Library Import pattern) instead of a loader dependency: this
 * repo takes no new dependencies, so the tag, the timeout and the auth-failure
 * hook live here. One `<script>` is injected at a time and every caller shares
 * the same load promise; a timeout or a transport error clears the cache so a
 * later attempt can retry, while a rejected key never retries.
 *
 * The API key is build-time public config read from `import.meta.env`; it is
 * never logged, never put into an error message, and never rendered.
 *
 * Types below are a deliberately narrow local model of the two constructors
 * this app uses (`Map`, `Marker`) — not an attempt to describe the whole SDK.
 */

export type GoogleMapsAuthFailureReason =
  | "no-key"
  | "auth-failure"
  | "load-timeout"
  | "load-error";

export interface GoogleMapsMap {
  setOptions?: (options: Record<string, unknown>) => void;
}

export interface GoogleMapsMarker {
  setMap?: (map: unknown) => void;
}

export interface GoogleMapsNamespace {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapsMap;
    /** `Marker` is optional so a missing constructor is a reportable failure. */
    Marker?: new (options: Record<string, unknown>) => GoogleMapsMarker;
  };
}

declare global {
  interface Window {
    google?: GoogleMapsNamespace;
    gm_authFailure?: () => void;
  }
}

/** The loaded namespace without the optionality of the global slot. */
export type GoogleMapsApi = NonNullable<typeof window.google>;

/** A stuck bootstrap gives up here instead of leaving the surface blank. */
export const GOOGLE_MAPS_LOAD_TIMEOUT_MS = 10000;

const GOOGLE_MAPS_API_URL = "https://maps.googleapis.com/maps/api/js";

/**
 * Per-page bootstrap callback name. Generated once at module init, so it is
 * unique to the page but identical for every call on it.
 */
const CALLBACK_NAME = `__norfoldGoogleMapsReady_${Math.random().toString(36).slice(2, 10)}`;

/** Consumer-safe copy — never carries key material. */
const FAILURE_MESSAGES: Record<GoogleMapsAuthFailureReason, string> = {
  "no-key": "Map preview unavailable. The location still saves normally.",
  "auth-failure":
    "Map preview unavailable — the map key was rejected. The location still saves normally.",
  "load-timeout": "Map preview took too long to load. The location still saves normally.",
  "load-error": "Map preview could not load. The location still saves normally.",
};

export class GoogleMapsLoadError extends Error {
  readonly reason: GoogleMapsAuthFailureReason;
  constructor(reason: GoogleMapsAuthFailureReason) {
    super(FAILURE_MESSAGES[reason]);
    this.name = "GoogleMapsLoadError";
    this.reason = reason;
  }
}

let loadPromise: Promise<GoogleMapsApi> | null = null;
let authFailed = false;
let authHookInstalled = false;
/** Settles the in-flight load when the API reports a rejected key. */
let failActiveLoad: ((reason: GoogleMapsAuthFailureReason) => void) | null = null;

/** Window as a string-keyed bag, for the per-page bootstrap callback name. */
function callbackHost(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

/** Trimmed public key from the build config; empty when unset. */
export function googleMapsKey(): string {
  const value = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  return typeof value === "string" ? value.trim() : "";
}

export function isGoogleMapsConfigured(): boolean {
  return googleMapsKey().length > 0;
}

/**
 * Install the auth-failure hook once per page. A rejected key never recovers,
 * so the in-flight load settles immediately instead of waiting for the
 * timeout, and every later call rejects without touching the network again.
 */
function installAuthFailureHook(): void {
  if (authHookInstalled) return;
  authHookInstalled = true;
  window.gm_authFailure = () => {
    authFailed = true;
    failActiveLoad?.("auth-failure");
  };
}

function bootstrapUrl(key: string): string {
  return (
    `${GOOGLE_MAPS_API_URL}?key=${encodeURIComponent(key)}` +
    `&v=weekly&loading=async&callback=${CALLBACK_NAME}`
  );
}

/**
 * Load the Maps JavaScript API once per page.
 *
 * Not declared `async` on purpose: every caller receives the same promise
 * object, so two simultaneous callers cannot inject a second script.
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (authFailed) return Promise.reject(new GoogleMapsLoadError("auth-failure"));
  const key = googleMapsKey();
  if (!key) return Promise.reject(new GoogleMapsLoadError("no-key"));
  if (loadPromise) return loadPromise;
  if (typeof document === "undefined" || !document.head) {
    return Promise.reject(new GoogleMapsLoadError("load-error"));
  }

  installAuthFailureHook();

  const promise = new Promise<GoogleMapsApi>((resolve, reject) => {
    let settled = false;
    const script = document.createElement("script");

    const stopWaiting = () => {
      window.clearTimeout(timer);
      failActiveLoad = null;
    };

    function fail(reason: GoogleMapsAuthFailureReason): void {
      if (settled) return;
      settled = true;
      stopWaiting();
      // A failed tag is retryable, so drop it instead of leaving a dead
      // element in <head>; a rejected promise is never cached for the same
      // reason. Auth failure is terminal and handled before this point.
      script.remove();
      if (loadPromise === promise) loadPromise = null;
      reject(new GoogleMapsLoadError(reason));
    }

    const timer = window.setTimeout(() => fail("load-timeout"), GOOGLE_MAPS_LOAD_TIMEOUT_MS);

    failActiveLoad = fail;
    script.async = true;
    script.src = bootstrapUrl(key);
    script.addEventListener("error", () => fail("load-error"));
    callbackHost()[CALLBACK_NAME] = () => {
      if (settled) return;
      const api = window.google;
      if (!api?.maps?.Map) {
        fail("load-error");
        return;
      }
      settled = true;
      stopWaiting();
      resolve(api);
    };
    document.head.appendChild(script);
  });

  loadPromise = promise;
  return promise;
}

/**
 * Test-only: forget the cached promise, the auth-failure flag and the hook so
 * each test starts from a cold page. Production never calls this.
 */
export function __resetGoogleMapsLoaderForTest(): void {
  loadPromise = null;
  authFailed = false;
  authHookInstalled = false;
  failActiveLoad = null;
  delete window.gm_authFailure;
  delete callbackHost()[CALLBACK_NAME];
}
