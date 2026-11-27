// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Android shell is the authority on whether its IME is open: the adjusting
 * window reports the same layout and visual height with the keyboard up, so the
 * web layer cannot tell. The bridge publishes visibility only — placement stays
 * with the WebView's own geometry — and these tests pin that contract,
 * including the "unknown" answer every other runtime gets.
 */
const state = vi.hoisted(() => ({
  native: true,
  platform: "android",
  readings: [] as Array<{ event: string; handler: (value: unknown) => void; removed: boolean }>,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => state.native,
    getPlatform: () => state.platform,
  },
  registerPlugin: () => ({
    getImeState: async () => ({ known: true, visible: false }),
    addListener: async (event: string, handler: (value: unknown) => void) => {
      const reading = { event, handler, removed: false };
      state.readings.push(reading);
      return {
        remove: async () => {
          reading.removed = true;
        },
      };
    },
  }),
}));

import { subscribeNativeIme } from "./ime";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  state.native = true;
  state.platform = "android";
  state.readings.length = 0;
});

describe("native IME bridge", () => {
  it("delivers the initial reading and pushed changes, then stops after unsubscribe", async () => {
    const seen: Array<{ known: boolean; visible: boolean }> = [];
    const stop = subscribeNativeIme((value) => seen.push(value));

    await flush();
    expect(seen).toEqual([{ known: true, visible: false }]);
    expect(state.readings).toHaveLength(1);
    expect(state.readings[0]?.event).toBe("imeStateChanged");

    state.readings[0]!.handler({ known: true, visible: true });
    expect(seen[1]).toEqual({ known: true, visible: true });

    stop();
    await flush();
    expect(state.readings[0]?.removed).toBe(true);
    state.readings[0]!.handler({ known: true, visible: false });
    expect(seen).toHaveLength(2);
  });

  it("normalises malformed payloads instead of trusting them", async () => {
    const seen: Array<{ known: boolean; visible: boolean }> = [];
    const stop = subscribeNativeIme((value) => seen.push(value));
    await flush();
    state.readings[0]!.handler({ known: "yes", visible: 1 });
    expect(seen[1]).toEqual({ known: false, visible: false });
    stop();
  });

  it("never forwards a legacy height field", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const stop = subscribeNativeIme((value) => seen.push({ ...value }));
    await flush();
    // A stale shell may still send the old payload shape; a raw root IME inset
    // is not a safe CSS offset, so the bridge must drop it.
    state.readings[0]!.handler({ known: true, visible: true, height: 280 });
    expect(seen[1]).toEqual({ known: true, visible: true });
    stop();
  });

  it("stays silent outside the Android shell", async () => {
    state.native = false;
    const seen: unknown[] = [];
    const stop = subscribeNativeIme((value) => seen.push(value));
    await flush();
    expect(seen).toHaveLength(0);
    expect(state.readings).toHaveLength(0);
    stop();
  });
});
