/**
 * Background web push for the browser build.
 *
 * Android has OS push through the native shell. A browser tab has no such
 * channel, so this is the honest web counterpart: a service worker subscriptions
 * that the server can still reach after the tab is closed.
 *
 * Rules:
 * - The OS permission is requested ONLY from an explicit user action, never on
 *   page load.
 * - The service worker is registered only after that action, so simply visiting
 *   the site leaves no background worker behind.
 * - The subscription is stored server-side for the signed-in account and
 *   released on sign-out or when the user turns the switch off.
 * - Nothing here is required for the app to work: an unsupported browser, a
 *   missing VAPID key or a denied permission all degrade to a plain "off" state
 *   that the settings screen can report truthfully.
 */
import { Capacitor } from "@capacitor/core";
import { registerWebPushSubscription, unregisterWebPushSubscription } from "./webPushTokens";

const OPT_IN = "norfold:web-push-optin:v1";

/** VAPID public key for this deployment; public by definition. */
export function webPushPublicKey(): string | null {
  const value = (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined)?.trim();
  return value ? value : null;
}

export function webPushSupported(): boolean {
  return !Capacitor.isNativePlatform()
    && typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && typeof Notification !== "undefined";
}

/** True only when the build carries the VAPID key subscriptions need. */
export function webPushConfigured(): boolean {
  return webPushSupported() && webPushPublicKey() !== null;
}

export function webPushPermission(): NotificationPermission | "unsupported" {
  if (!webPushSupported()) return "unsupported";
  return Notification.permission;
}

function optedIn(accountId: string): boolean {
  try {
    const raw = JSON.parse(window.localStorage.getItem(OPT_IN) ?? "{}");
    return raw !== null && typeof raw === "object" && (raw as Record<string, unknown>)[accountId] === true;
  } catch {
    return false;
  }
}

function setOptIn(accountId: string, enabled: boolean): void {
  try {
    const raw = JSON.parse(window.localStorage.getItem(OPT_IN) ?? "{}");
    const next = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (enabled) next[accountId] = true; else delete next[accountId];
    window.localStorage.setItem(OPT_IN, JSON.stringify(next));
  } catch {
    // Private mode / quota: the live subscription is still the source of truth.
  }
}

/** Local opt-in AND grants; the switch is only drawn "on" for both. */
export function webPushEnabled(accountId: string): boolean {
  return webPushConfigured() && webPushPermission() === "granted" && optedIn(accountId);
}

function sameApplicationServerKey(subscription: PushSubscription, expected: Uint8Array<ArrayBuffer>): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

/** base64url VAPID key → the exact bytes `subscribe` expects. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/push-sw.js");
  if (existing) return existing;
  return navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
}

/** Current live subscription, if any. Never prompts. */
async function liveSubscription(): Promise<PushSubscription | null> {
  if (!webPushSupported()) return null;
  try {
    const worker = await navigator.serviceWorker.getRegistration("/push-sw.js");
    return worker ? await worker.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/**
 * Explicit opt-in. Must be called from a user gesture: it asks the browser for
 * permission, registers the worker, subscribes and stores the endpoint. The
 * resolved state is what actually happened, never an assumption.
 */
export async function enableWebPush(accountId: string): Promise<"on" | "blocked" | "unconfigured" | "unsupported" | "failed"> {
  if (!webPushSupported()) return "unsupported";
  const key = webPushPublicKey();
  if (!key) return "unconfigured";
  let permission: NotificationPermission;
  try {
    permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  } catch {
    return "failed";
  }
  if (permission !== "granted") return "blocked";
  try {
    const worker = await registration();
    const applicationServerKey = decodeBase64Url(key);
    const current = await worker.pushManager.getSubscription();
    const subscription = current && sameApplicationServerKey(current, applicationServerKey)
      ? current
      : await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const json = subscription.toJSON();
    if (!json.endpoint) return "failed";
    await registerWebPushSubscription({ endpoint: json.endpoint, keys: json.keys });
    setOptIn(accountId, true);
    return "on";
  } catch {
    return "failed";
  }
}

/** Turn the switch off and release the endpoint server-side. */
export async function disableWebPush(accountId: string): Promise<void> {
  setOptIn(accountId, false);
  const subscription = await liveSubscription();
  if (!subscription) return;
  try {
    await unregisterWebPushSubscription(subscription.endpoint);
  } catch {
    // The local state is already off; a stale row is pruned by the sender when
    // the service returns 404/410.
  }
  try {
    await subscription.unsubscribe();
  } catch {
    // Best effort: an unsubscribe failure leaves a dead endpoint behind, which
    // the sender prunes on the first delivery attempt.
  }
}

/**
 * Release this browser's endpoint at sign-out without changing the local
 * opt-in flag: the account may sign back in on the same browser.
 */
export async function releaseWebPush(): Promise<void> {
  const subscription = await liveSubscription();
  if (!subscription) return;
  try {
    await unregisterWebPushSubscription(subscription.endpoint);
  } catch {
    // Signed-out calls may fail; the service-role pruner is the backstop.
  }
}
