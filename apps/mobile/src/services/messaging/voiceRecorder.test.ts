// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createVoiceRecorder, type VoiceRecorderHandle, type VoiceRecordingDeps } from "./voiceRecorder";
import { VOICE_MAX_MS, VOICE_PERMISSION_DENIED } from "./voice";

/** Deterministic clock: no real timers, no real microphone, no real device. */
function harness(options: { deny?: string; supported?: string[] } = {}) {
  let now = 1_000;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const handles: FakeRecorder[] = [];
  const tracks = liveTracks();
  const requestStream = vi.fn(async () => {
    if (options.deny) throw Object.assign(new Error("denied"), { name: options.deny });
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    return stream;
  });

  class FakeRecorder implements VoiceRecorderHandle {
    state: "inactive" | "recording" = "inactive";
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, mime: string) { this.mimeType = mime; handles.push(this); }
    start() { this.state = "recording"; }
    stop() {
      if (this.state !== "recording") return;
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

function liveTracks(count = 1) {
  const tracks: Array<{ stop: () => void; stopped: boolean }> = [];
  for (let index = 0; index < count; index += 1) {
    const track = { stopped: false, stop: () => { track.stopped = true; } };
    tracks.push(track);
  }
  return tracks;
}

describe("voice recorder lifecycle", () => {
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
