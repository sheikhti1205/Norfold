// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeVoicePeaks } from "./voicePeaks";

function decodedBuffer() {
  const data = new Float32Array(8_000);
  for (let index = 3_000; index < 5_000; index++) data[index] = 1;
  return { numberOfChannels: 1, getChannelData: () => data };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voice decoding borrows no output device", () => {
  it("decodes through an offline context at the low rate", async () => {
    const constructed: Array<{ channels: number; length: number; sampleRate: number }> = [];
    class FakeOffline {
      constructor(channels: number, length: number, sampleRate: number) {
        constructed.push({ channels, length, sampleRate });
      }
      async decodeAudioData() {
        return decodedBuffer();
      }
    }
    vi.stubGlobal("OfflineAudioContext", FakeOffline);
    vi.stubGlobal("AudioContext", class {
      constructor() {
        throw new Error("a live context must not be opened for decoding");
      }
    });

    const bars = await decodeVoicePeaks(new ArrayBuffer(16), 8);

    expect(bars).toHaveLength(8);
    expect(constructed).toEqual([{ channels: 1, length: 1, sampleRate: 8_000 }]);
  });

  it("closes the live fallback immediately after decoding", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const rates: number[] = [];
    class FakeLive {
      constructor(options?: { sampleRate?: number }) {
        rates.push(options?.sampleRate ?? 0);
      }
      async decodeAudioData() {
        return decodedBuffer();
      }
      close = close;
    }
    vi.stubGlobal("OfflineAudioContext", undefined);
    vi.stubGlobal("webkitOfflineAudioContext", undefined);
    vi.stubGlobal("AudioContext", FakeLive);

    const bars = await decodeVoicePeaks(new ArrayBuffer(16), 8);

    expect(bars).toHaveLength(8);
    expect(rates).toEqual([8_000]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
