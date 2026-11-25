// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_MAPS_LOAD_TIMEOUT_MS,
  GoogleMapsLoadError,
  __resetGoogleMapsLoaderForTest,
  googleMapsKey,
  isGoogleMapsConfigured,
  loadGoogleMaps,
  type GoogleMapsApi,
} from "./googleMapsLoader";

const KEY = "test-browser-key";

class FakeMap {
  constructor(_element: HTMLElement, _options: Record<string, unknown>) {}

  setOptions(): void {}
}

const API: GoogleMapsApi = { maps: { Map: FakeMap } };

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll("script")).filter((script) =>
    script.src.includes("maps.googleapis.com"),
  );
}

function lastScript(): HTMLScriptElement {
  const scripts = injectedScripts();
  const script = scripts[scripts.length - 1];
  if (!script) throw new Error("the loader injected no script");
  return script;
}

function callbackName(script: HTMLScriptElement): string {
  return new URL(script.src).searchParams.get("callback") ?? "";
}

/** Resolve the pending load the way the API's bootstrap callback does. */
function completeLoad(api: GoogleMapsApi): void {
  window.google = api;
  const name = callbackName(lastScript());
  const callback = (window as unknown as Record<string, unknown>)[name] as
    | (() => void)
    | undefined;
  callback?.();
}

beforeEach(() => {
  __resetGoogleMapsLoaderForTest();
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
});

afterEach(() => {
  __resetGoogleMapsLoaderForTest();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete window.google;
  delete window.gm_authFailure;
  for (const script of injectedScripts()) script.remove();
});

describe("googleMapsLoader", () => {
  it("reports a missing key instead of injecting a script", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "   ");
    expect(googleMapsKey()).toBe("");
    expect(isGoogleMapsConfigured()).toBe(false);
    const append = vi.spyOn(document.head, "appendChild");
    await expect(loadGoogleMaps()).rejects.toMatchObject({ reason: "no-key" });
    expect(append).not.toHaveBeenCalled();
    expect(injectedScripts()).toHaveLength(0);
  });

  it("trims the configured key", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", `  ${KEY}  `);
    expect(googleMapsKey()).toBe(KEY);
    expect(isGoogleMapsConfigured()).toBe(true);
  });

  it("shares one script between concurrent and repeat calls", async () => {
    const append = vi.spyOn(document.head, "appendChild");
    const first = loadGoogleMaps();
    const second = loadGoogleMaps();
    expect(append).toHaveBeenCalledTimes(1);

    completeLoad(API);
    await expect(first).resolves.toBe(API);
    await expect(second).resolves.toBe(API);

    // Already loaded: the cached promise answers without a second tag.
    await expect(loadGoogleMaps()).resolves.toBe(API);
    expect(append).toHaveBeenCalledTimes(1);
    expect(injectedScripts()).toHaveLength(1);
  });

  it("bootstraps the documented dynamic-import URL with the env key", async () => {
    const pending = loadGoogleMaps();
    const url = new URL(lastScript().src);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://maps.googleapis.com/maps/api/js",
    );
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(url.searchParams.get("v")).toBe("weekly");
    expect(url.searchParams.get("loading")).toBe("async");
    expect(url.searchParams.get("callback")).toBeTruthy();

    completeLoad(API);
    await pending;
  });

  it("stops retrying once gm_authFailure reports a rejected key", async () => {
    const append = vi.spyOn(document.head, "appendChild");
    const pending = loadGoogleMaps();
    const settled = pending.catch((error: unknown) => error);
    expect(window.gm_authFailure).toBeTypeOf("function");

    window.gm_authFailure?.();

    const error = await settled;
    expect(error).toBeInstanceOf(GoogleMapsLoadError);
    expect((error as GoogleMapsLoadError).reason).toBe("auth-failure");
    // A rejected key never recovers: later calls fail fast, with no new script.
    await expect(loadGoogleMaps()).rejects.toMatchObject({ reason: "auth-failure" });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("times out without leaking the key and lets a later call try again", async () => {
    vi.useFakeTimers();
    const append = vi.spyOn(document.head, "appendChild");
    const pending = loadGoogleMaps();
    const settled = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(GOOGLE_MAPS_LOAD_TIMEOUT_MS);

    const error = await settled;
    expect(error).toBeInstanceOf(GoogleMapsLoadError);
    expect((error as GoogleMapsLoadError).reason).toBe("load-timeout");
    expect((error as Error).message).not.toContain(KEY);

    // The rejected promise was not cached, so a retry injects a fresh script.
    const retry = loadGoogleMaps();
    expect(append).toHaveBeenCalledTimes(2);
    completeLoad(API);
    await expect(retry).resolves.toBe(API);
  });

  it("reports a blocked or offline script as a load error and retries next time", async () => {
    const append = vi.spyOn(document.head, "appendChild");
    const pending = loadGoogleMaps();
    const settled = pending.catch((error: unknown) => error);

    lastScript().dispatchEvent(new Event("error"));

    const error = await settled;
    expect(error).toBeInstanceOf(GoogleMapsLoadError);
    expect((error as GoogleMapsLoadError).reason).toBe("load-error");

    const retry = loadGoogleMaps();
    expect(append).toHaveBeenCalledTimes(2);
    completeLoad(API);
    await expect(retry).resolves.toBe(API);
  });
});
