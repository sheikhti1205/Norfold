// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * Regression for a shell whose registration exists but does not implement the
 * IME methods (an older build, or a partial test double). The bridge must read
 * as "unknown" and let the editor fall back to viewport geometry; throwing
 * would take the whole editor tree down through its error boundary.
 */
const state = vi.hoisted(() => ({ registrations: 0 }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
  registerPlugin: () => {
    state.registrations += 1;
    return {};
  },
}));

describe("native IME bridge — partial shell", () => {
  it("reports unknown instead of throwing when the plugin has no IME methods", async () => {
    vi.resetModules();
    const { subscribeNativeIme } = await import("./ime");
    const seen: unknown[] = [];

    const stop = subscribeNativeIme((value) => seen.push(value));

    expect(typeof stop).toBe("function");
    expect(state.registrations).toBeGreaterThan(0);
    stop();
    expect(seen).toHaveLength(0);
  });
});
