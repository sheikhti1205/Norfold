// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createVoicePlayback, voiceProgressPercent, type VoiceAudioHandle, type VoicePlaybackPorts } from "./voicePlayback";

class FakeAudio implements VoiceAudioHandle {
  src = "";
  currentTime = 0;
  duration = Number.POSITIVE_INFINITY;
  paused = true;
  playing = false;
  failPlay = false;
  listeners = new Map<string, Set<() => void>>();
  released = false;

  play() {
    if (this.failPlay) return Promise.reject(new Error("blocked"));
    this.paused = false;
    this.playing = true;
    return Promise.resolve();
  }
  pause() { this.paused = true; this.playing = false; }
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
  release() { this.released = true; this.paused = true; }
}

function harness() {
  const created: FakeAudio[] = [];
  let ticker: (() => void) | null = null;
  const ports: VoicePlaybackPorts = {
    createAudio: () => { const audio = new FakeAudio(); created.push(audio); return audio; },
    setInterval: (handler) => { ticker = handler; return 1; },
    clearInterval: () => { ticker = null; },
  };
  const playback = createVoicePlayback(ports);
  const audio = (index = 0) => {
    const found = created[index];
    if (!found) throw new Error("no audio element");
    return found;
  };
  return { playback, created, audio, tick: () => ticker?.(), hasTicker: () => ticker !== null };
}

describe("voice playback", () => {
  it("plays one note at a time and pauses the previous one", async () => {
    const h = harness();
    expect(h.playback.load("a", "blob:a", 3_000)).toBe(true);
    await h.playback.play();
    const first = h.audio();
    h.playback.load("b", "blob:b", 5_000);
    expect(first.released).toBe(true);
    expect(h.created).toHaveLength(2);
    await h.playback.play();
    expect(h.playback.snapshot.playingId).toBe("b");
  });

  it("reports position from the element and formats a stored length", async () => {
    const h = harness();
    h.playback.load("a", "blob:a", 65_000);
    await h.playback.play();
    h.audio().currentTime = 12.4;
    h.tick();
    expect(h.playback.snapshot.positionMs).toBe(12_400);
    expect(h.playback.snapshot.durationMs).toBe(65_000);
  });

  it("pauses, seeks within bounds and nudges by ten seconds", async () => {
    const h = harness();
    h.playback.load("a", "blob:a", 30_000);
    await h.playback.play();
    h.playback.pause();
    expect(h.playback.snapshot.playingId).toBeNull();
    h.playback.seekTo(28_000);
    h.playback.nudge("forward");
    expect(h.audio().currentTime).toBe(30);
    h.playback.nudge("back");
    expect(h.audio().currentTime).toBe(20);
  });

  it("keeps the stored length when the container reports Infinity", async () => {
    const h = harness();
    h.playback.load("a", "blob:a", 41_000);
    expect(h.playback.snapshot.durationMs).toBe(41_000);
  });

  it("never autoplays and never claims to play when playback is refused", async () => {
    const h = harness();
    h.playback.load("a", "blob:a", 4_000);
    expect(h.audio().paused).toBe(true);
    h.audio().failPlay = true;
    await h.playback.play();
    expect(h.playback.snapshot.playingId).toBeNull();
  });

  it("teardown releases the element so a closed conversation cannot keep audio", async () => {
    const h = harness();
    h.playback.load("a", "blob:a", 4_000);
    await h.playback.play();
    h.playback.teardown();
    expect(h.audio().released).toBe(true);
    expect(h.playback.snapshot.playingId).toBeNull();
  });

  it("computes a bounded progress percentage", () => {
    expect(voiceProgressPercent(0, 0)).toBe(0);
    expect(voiceProgressPercent(5_000, 10_000)).toBe(50);
    expect(voiceProgressPercent(20_000, 10_000)).toBe(100);
  });
});
