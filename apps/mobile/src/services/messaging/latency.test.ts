import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("chat latency", () => {
  it("pairs only matching conversation ids", async () => {
    vi.resetModules();
    const latency = await import("./latency");
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    latency.markHintReceived("one");
    latency.markConversationPainted("two");
    expect(latency.recentLatencySamples()).toHaveLength(0);
    latency.markConversationPainted("one");
    expect(latency.recentLatencySamples()).toMatchObject([{ conversationId: "one" }]);
  });

  it("retains only the latest 50 samples", async () => {
    vi.resetModules();
    const latency = await import("./latency");
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    for (let i = 0; i < 51; i++) {
      latency.markHintReceived(String(i));
      latency.markConversationPainted(String(i));
    }
    expect(latency.recentLatencySamples()).toHaveLength(50);
    expect(latency.recentLatencySamples()[0]?.conversationId).toBe("1");
  });

  it("does not report hints painted after the TTL", async () => {
    vi.resetModules(); vi.useFakeTimers();
    const latency = await import("./latency");
    latency.markHintReceived("one");
    vi.advanceTimersByTime(10_001);
    latency.markConversationPainted("one");
    expect(latency.recentLatencySamples()).toHaveLength(0);
  });
});
