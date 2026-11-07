// @vitest-environment jsdom
import { expect, it } from "vitest";
import { voiceBarHeights } from "./Messaging";

/**
 * The bar pattern is decorative, but it must not flicker between renders: a
 * shape that changed on every repaint would read as a broken player. Same id,
 * same bars — including after a remount, which the module cache must not leak
 * across (it is keyed by id, not by render count).
 */
it("keeps one stable bar pattern per voice note", () => {
  const first = voiceBarHeights("ae5c8fe6-2c21-4dcc-9ba7-71d7f535269e");
  const second = voiceBarHeights("ae5c8fe6-2c21-4dcc-9ba7-71d7f535269e");
  expect(second).toEqual(first);
  expect(voiceBarHeights("5691d555-de0f-4437-b7cb-631ebf3bd2e3")).not.toEqual(first);
});

it("stays inside the readable height band", () => {
  const heights = voiceBarHeights("some-other-note");
  expect(heights).toHaveLength(30);
  for (const height of heights) {
    expect(height).toBeGreaterThanOrEqual(28);
    expect(height).toBeLessThanOrEqual(100);
  }
  // A flat line is a divider, not a waveform.
  expect(new Set(heights).size).toBeGreaterThan(3);
});
