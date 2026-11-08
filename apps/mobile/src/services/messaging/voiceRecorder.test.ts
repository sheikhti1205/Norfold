// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createVoiceRecorder, type VoiceRecorderHandle, type VoiceRecordingDeps } from "./voiceRecorder";
import { VOICE_MAX_MS, VOICE_PERMISSION_DENIED, VOICE_MIC_UNAVAILABLE } from "./voice";

/** Deterministic clock: no real timers, no real microphone, no real device. */
function harness(options: { deny?: string; supported?: string[]; dead?: boolean } = {}) {
  let now = 1_000;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const handles: FakeRecorder[] = [];
  const tracks = liveTracks(1, options.dead);
  const requestStream = vi.fn(async () => {
    if (options.deny) throw Object.assign(new Error("denied"), { name: options.deny });
    const stream = { getTracks: () => tracks, getAudioTracks: () => tracks } as unknown as MediaStream;
    return stream;
  });

  class FakeRecorder implements VoiceRecorderHandle {
    state: "inactive" | "recording" | "paused" = "inactive";
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, mime: string) { this.mimeType = mime; handles.push(this); }
    start() { this.state = "recording"; }
    pause() { this.state = "paused"; }
    resume() { this.state = "recording"; }
    requestData() { this.ondataavailable?.({ data: new Blob(["segment"], { type: this.mimeType }) }); }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
      this.onstop?.();
    }
    /** Test-only: fail the underlying capture. */
    breakIt() { this.onerror?.(); }
  }

  const deps: VoiceRecordingDeps = {
    createRecorder: (stream, mime) => new FakeRecorder(stream, mime),
    requestStream,
    isTypeSupported: (mime) => (options.supported ? options.supported.includes(mime) : true),
    now: () => now,
    setTimeout: (handler, ms) => {
      const handle = ++id;
      timers.set(handle, { at: now + ms, run: handler });
      return handle;
    },
    clearTimeout: (handle) => { timers.delete(handle); },
  };

  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(handle); timer.run(); }
    }
  };

  const handle = (index = 0) => {
    const found = handles[index];
    if (!found) throw new Error("no recorder was created");
    return found;
  };

  return { deps, advance, handle, tracks, requestStream, recorder: createVoiceRecorder(deps) };
}

function liveTracks(count = 1, dead = false) {
  const tracks: Array<{ stop: () => void; stopped: boolean; enabled: boolean; readyState: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const track = { enabled: true, readyState: dead ? "ended" : "live", stopped: false,
      stop: () => { track.stopped = true; } };
    tracks.push(track);
  }
  return tracks;
}

describe("voice recorder lifecycle", () => {
  it("pauses for review, resumes the same container and excludes review time", async () => {
    const h = harness();
    await h.recorder.start();
    h.advance(2_000);
    h.recorder.pause();
    expect(h.recorder.state.status).toBe("review");
    expect(h.tracks[0]?.enabled).toBe(false);
    expect(h.recorder.canResume).toBe(true);
    h.advance(30_000);
    h.recorder.resume();
    expect(h.recorder.state.status).toBe("recording");
    expect(h.tracks[0]?.enabled).toBe(true);
    h.advance(3_000);
    h.recorder.pause();
    const note = await h.recorder.finalize();
    expect(note?.durationMs).toBe(5_000);
    expect(note?.blob.size).toBe(19); // two chunks + the final trailer, not two containers
    expect(h.requestStream).toHaveBeenCalledTimes(1);
    expect(h.tracks.every(track => track.stopped)).toBe(true);
    expect(h.recorder.canResume).toBe(false);
    expect(h.recorder.take()).toBe(note);
    expect(h.recorder.take()).toBeNull();
  });

  it("discarding a paused review closes the microphone and cannot resume it", async () => {
    const h = harness();
    await h.recorder.start(); h.advance(2_000); h.recorder.pause();
    h.recorder.discard(); h.recorder.resume();
    expect(h.handle().state).toBe("inactive");
    expect(h.recorder.state.status).toBe("idle");
    expect(h.tracks.every(track => track.stopped)).toBe(true);
  });
  it("keeps the same finalized bytes for a retry instead of stopping twice", async () => {
    const h = harness();
    await h.recorder.start(); h.advance(2_000); h.recorder.pause();
    const stop = vi.spyOn(h.handle(), "stop");
    const first = await h.recorder.finalize();
    const retry = await h.recorder.finalize();
    expect(first).not.toBeNull();
    expect(retry).toBe(first);
    expect(stop).toHaveBeenCalledOnce();
    expect(h.recorder.state.status).toBe("review");
  });
  it("caps resumed capture by recorded time, not by time spent reviewing", async () => {
    const h = harness();
    await h.recorder.start(); h.advance(VOICE_MAX_MS - 2_000); h.recorder.pause();
    h.advance(60_000);
    expect(h.recorder.state.status).toBe("review");
    h.recorder.resume(); h.advance(1_999);
    expect(h.recorder.state.status).toBe("recording");
    h.advance(1);
    expect(h.recorder.state.status).toBe("review");
    const note = await h.recorder.finalize();
    expect(note?.durationMs).toBe(VOICE_MAX_MS);
    expect(h.recorder.canResume).toBe(false);
    expect(h.tracks.every(track => track.stopped)).toBe(true);
  });
  it("asks for the microphone only on start and ticks while recording", async () => {
    const h = harness();
    expect(h.requestStream).not.toHaveBeenCalled();
    await h.recorder.start();
    expect(h.requestStream).toHaveBeenCalledTimes(1);
    expect(h.recorder.state.status).toBe("recording");
    h.advance(600);
    expect(h.recorder.state).toMatchObject({ status: "recording", elapsedMs: 600 });
  });

  it("stops into review, then hands the note over exactly once", async () => {
    const h = harness();
    await h.recorder.start();
    h.advance(4_200);
    h.recorder.stop();
    expect(h.recorder.state.status).toBe("review");
    const note = h.recorder.take();
    expect(note).not.toBeNull();
    expect(note?.durationMs).toBe(4_200);
    expect(note?.mime).toBe("audio/webm");
    expect(h.recorder.state.status).toBe("idle");
    expect(h.recorder.take()).toBeNull();
  });

  it("rejects an accidental tap instead of sending a zero-length note", async () => {
    const h = harness();
    await h.recorder.start();
    h.advance(120);
    h.recorder.stop();
    expect(h.recorder.state.status).toBe("idle");
  });

  it("releases the capture tracks on discard", async () => {
    const h = harness();
    await h.recorder.start();
    h.recorder.discard();
    expect(h.recorder.state.status).toBe("idle");
    expect(h.handle().state).toBe("inactive");
    expect(h.tracks.every((track) => track.stopped)).toBe(true);
  });

  it("reports a blocked microphone without leaking the stream", async () => {
    const h = harness({ deny: "NotAllowedError" });
    await h.recorder.start();
    expect(h.recorder.state).toEqual({ status: "error", message: VOICE_PERMISSION_DENIED });
  });

  it("refuses a dead capture track instead of starting a recorder that cannot record", async () => {
    const h = harness({ dead: true });
    await h.recorder.start();
    expect(h.recorder.state).toEqual({ status: "error", message: VOICE_MIC_UNAVAILABLE });
    expect(h.recorder.canResume).toBe(false);
    expect(h.tracks.every((track) => track.stopped)).toBe(true);
    // A doomed start never reaches the platform at all.
    expect(() => h.handle()).toThrow(/no recorder/);
  });

  it("stops itself at the maximum length", async () => {
    const h = harness();
    await h.recorder.start();
    h.advance(VOICE_MAX_MS - 1);
    expect(h.recorder.state.status).toBe("recording");
    h.advance(2);
    expect(h.recorder.state.status).toBe("review");
    expect(h.recorder.state.status === "review" && h.recorder.state.recording.durationMs).toBe(VOICE_MAX_MS);
  });

  it("teardown during recording leaves no live microphone and emits nothing", async () => {
    const h = harness();
    const seen: string[] = [];
    h.recorder.subscribe((state) => seen.push(state.status));
    await h.recorder.start();
    h.recorder.teardown();
    expect(h.handle().state).toBe("inactive");
    expect(h.recorder.state.status).toBe("idle");
    expect(seen.at(-1)).toBe("recording");
  });

  it("surfaces a capture failure as an error, not a silent stop", async () => {
    const h = harness();
    await h.recorder.start();
    h.handle().breakIt();
    expect(h.recorder.state.status).toBe("error");
  });

  it("prefers the first MIME the platform says it can record", async () => {
    const h = harness({ supported: ["audio/webm", "audio/mp4"] });
    await h.recorder.start();
    expect(h.handle().mimeType).toBe("audio/webm");
  });
});
