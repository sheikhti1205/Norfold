/**
 * One cross-platform recording port.
 *
 * Web and the Android WebView both expose `MediaRecorder`, so there is no
 * second native recorder to keep in step: the platform object is injected and
 * every lifecycle rule (permission, timer, cancel, teardown) is enforced here.
 *
 * The port never leaves a microphone open. Every terminal path — stop, cancel,
 * maximum duration, error, page hide, account switch, unmount — releases the
 * capture tracks. Paused review mutes the tracks; Resume continues the same
 * container. Send finalizes it before durable admission (never joins files).
 */
import {
  VOICE_MAX_MS, VOICE_MIC_UNAVAILABLE, VOICE_MIN_MS, VOICE_MIME_TYPES, VOICE_PERMISSION_DENIED,
  VOICE_RECORD_FAILED, VOICE_UNAVAILABLE, normalizeVoiceDuration, storedVoiceMime,
} from "./voice";
import { createInputMeter, type VoiceMeter } from "./voiceMeter";

export interface VoiceRecorderHandle {
  mimeType: string;
  state: "inactive" | "recording" | "paused";
  start(): void;
  stop(): void;
  pause?(): void;
  resume?(): void;
  requestData?(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface VoiceRecordingDeps {
  /** `null` when this runtime has no recorder at all. */
  createRecorder(stream: MediaStream, mime: string): VoiceRecorderHandle | null;
  requestStream(): Promise<MediaStream>;
  isTypeSupported?(mime: string): boolean;
  /** Optional live level source; a note still records when absent. */
  createMeter?(stream: MediaStream): VoiceMeter | null;
  now(): number;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
  /** Live levels in the order they were measured; may be empty. */
  peaks: number[];
  /** Epoch ms of the first peak; bars are placed against the note's timeline. */
  peakIntervalMs: number;
}

export type VoiceRecorderState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "pausing" }
  | { status: "recording"; elapsedMs: number; peaks: number[] }
  | { status: "review"; recording: VoiceRecording }
  | { status: "error"; message: string };

type Listener = (state: VoiceRecorderState) => void;

/** Chrome/WebView/Safari expose `isTypeSupported`; the port must not assume it. */
function pickMime(deps: VoiceRecordingDeps): string {
  for (const mime of VOICE_MIME_TYPES) {
    if (!deps.isTypeSupported || deps.isTypeSupported(mime)) return mime;
  }
  return VOICE_MIME_TYPES[0];
}

export function createVoiceRecorder(deps: VoiceRecordingDeps) {
  let state: VoiceRecorderState = { status: "idle" };
  const listeners = new Set<Listener>();
  let recorder: VoiceRecorderHandle | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let recordedMs = 0;
  let settleFinalization: ((note: VoiceRecording | null) => void) | null = null;
  let ticker: number | null = null;
  let watchdog: number | null = null;
  let meter: VoiceMeter | null = null;
  let livePeaks: number[] = [];
  /** One reading per tick; the screen draws the trailing window. */
  const PEAK_INTERVAL_MS = 120;

  const emit = (next: VoiceRecorderState) => {
    state = next;
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* a view must not break recording */ }
    }
  };

  /** Read through a call so an await cannot leave a narrowed stale union. */
  const snapshot = (): VoiceRecorderState => state;

  const releaseTracks = () => {
    meter?.close();
    meter = null;
    for (const track of stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* already ended */ }
    }
    stream = null;
  };

  const stopTimers = () => {
    if (ticker !== null) deps.clearTimeout(ticker);
    if (watchdog !== null) deps.clearTimeout(watchdog);
    ticker = null;
    watchdog = null;
  };

  /** Every exit funnels through here: no path may leave a live microphone. */
  const teardown = () => {
    stopTimers();
    chunks = [];
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    }
    recorder = null;
    releaseTracks();
    settleFinalization?.(null);
    settleFinalization = null;
  };

  const fail = (message: string) => {
    teardown();
    emit({ status: "error", message });
  };

  const finish = () => {
    const durationMs = state.status === "recording" ? recordedMs + deps.now() - startedAt : recordedMs;
    const parts = chunks;
    const mime = storedVoiceMime(recorder?.mimeType ?? parts[0]?.type ?? "");
    const resolve = settleFinalization;
    settleFinalization = null;
    teardown();
    const blob = new Blob(parts, { type: mime });
    const peaks = livePeaks;
    livePeaks = [];
    // An accidental tap is not a message: nothing is sent and nothing is kept.
    if (durationMs < VOICE_MIN_MS || blob.size === 0) {
      emit({ status: "idle" });
      resolve?.(null);
      return;
    }
    const recording = { blob, mime, durationMs: normalizeVoiceDuration(durationMs), peaks, peakIntervalMs: PEAK_INTERVAL_MS };
    emit({ status: "review", recording });
    resolve?.(recording);
  };

  const tick = () => {
    if (state.status !== "recording") return;
    // A missing meter still advances the clock; it just contributes silence.
    if (meter) livePeaks.push(meter.read());
    emit({ status: "recording", elapsedMs: recordedMs + deps.now() - startedAt, peaks: [...livePeaks] });
    ticker = deps.setTimeout(tick, PEAK_INTERVAL_MS);
  };

  return {
    get state(): VoiceRecorderState {
      return state;
    },
    get canResume(): boolean {
      return state.status === "review" && recorder?.state === "paused" && !!recorder.resume;
    },
    subscribe(next: Listener): () => void {
      listeners.add(next);
      return () => { listeners.delete(next); };
    },
    /** Permission is requested here and nowhere else. */
    async start(): Promise<void> {
      if (state.status !== "idle" && state.status !== "error") return;
      emit({ status: "starting" });
      let opened: MediaStream;
      try {
        opened = await deps.requestStream();
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        fail(name === "NotAllowedError" || name === "SecurityError" ? VOICE_PERMISSION_DENIED : VOICE_UNAVAILABLE);
        return;
      }
      if (snapshot().status !== "starting") { // cancelled while the prompt was open
        for (const track of opened.getTracks()) { try { track.stop(); } catch { /* ended */ } }
        return;
      }
      // A granted stream is not automatically a usable one: the device can hand
      // back a track that another app already took or that the audio route
      // dropped. Starting a recorder on that track fails asynchronously and
      // reads like a save error, so refuse it here with the honest sentence.
      // Only an explicitly ended track counts: a runtime that omits readyState
      // cannot be judged, and guessing there would refuse a working mic.
      const capture = opened.getAudioTracks?.() ?? opened.getTracks();
      if (capture.length > 0 && capture.every((track) => track.readyState === "ended")) {
        for (const track of opened.getTracks()) { try { track.stop(); } catch { /* ended */ } }
        fail(VOICE_MIC_UNAVAILABLE);
        return;
      }
      const mime = pickMime(deps);
      const handle = deps.createRecorder(opened, mime);
      if (!handle) {
        for (const track of opened.getTracks()) { try { track.stop(); } catch { /* ended */ } }
        fail(VOICE_UNAVAILABLE);
        return;
      }
      stream = opened;
      recorder = handle;
      chunks = [];
      livePeaks = [];
      recordedMs = 0;
      meter = deps.createMeter?.(opened) ?? null;
      handle.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
        if (state.status === "pausing") emit({ status: "review", recording: {
          blob: new Blob(chunks, { type: storedVoiceMime(handle.mimeType) }),
          mime: storedVoiceMime(handle.mimeType), durationMs: normalizeVoiceDuration(recordedMs),
          peaks: [...livePeaks], peakIntervalMs: PEAK_INTERVAL_MS,
        } });
      };
      handle.onstop = finish;
      handle.onerror = () => fail(VOICE_RECORD_FAILED);
      try {
        handle.start();
      } catch {
        fail(VOICE_RECORD_FAILED);
        return;
      }
      startedAt = deps.now();
      emit({ status: "recording", elapsedMs: 0, peaks: [] });
      ticker = deps.setTimeout(tick, PEAK_INTERVAL_MS);
      // A note stops itself at the ceiling rather than growing unbounded.
      watchdog = deps.setTimeout(() => {
        if (state.status === "recording" && recorder?.state === "recording") recorder.stop();
      }, VOICE_MAX_MS);
    },
    /** Ends the gesture and moves to review (never sends). */
    stop(): void {
      if (state.status !== "recording") return;
      stopTimers();
      try { recorder?.stop(); } catch { fail(VOICE_RECORD_FAILED); }
    },
    /** Review without ending the container; a paused microphone is muted. */
    pause(): void {
      if (state.status !== "recording" || !recorder) return;
      stopTimers();
      if (!recorder.pause || !recorder.resume || !recorder.requestData) {
        try { recorder.stop(); } catch { fail(VOICE_RECORD_FAILED); }
        return;
      }
      recordedMs += deps.now() - startedAt;
      try {
        recorder.pause();
        for (const track of stream?.getTracks() ?? []) track.enabled = false;
        emit({ status: "pausing" });
        recorder.requestData();
      } catch { fail(VOICE_RECORD_FAILED); }
    },
    resume(): void {
      if (state.status !== "review" || recorder?.state !== "paused" || !recorder.resume) return;
      try {
        for (const track of stream?.getTracks() ?? []) track.enabled = true;
        recorder.resume();
        startedAt = deps.now();
        emit({ status: "recording", elapsedMs: recordedMs, peaks: [...livePeaks] });
        ticker = deps.setTimeout(tick, PEAK_INTERVAL_MS);
        watchdog = deps.setTimeout(() => {
          if (state.status === "recording") recorder?.stop();
        }, Math.max(0, VOICE_MAX_MS - recordedMs));
      } catch { fail(VOICE_RECORD_FAILED); }
    },
    /** Flush the final trailer before send; keep review intact for retry. */
    finalize(): Promise<VoiceRecording | null> {
      if (state.status !== "review") return Promise.resolve(null);
      if (!recorder) return Promise.resolve(state.recording);
      return new Promise(resolve => {
        settleFinalization = resolve;
        try { recorder?.stop(); } catch { fail(VOICE_RECORD_FAILED); }
      });
    },
    /** Throws the note away: nothing is uploaded and the microphone closes. */
    discard(): void {
      teardown();
      emit({ status: "idle" });
    },
    /** Hands the finished note to the caller exactly once. */
    take(): VoiceRecording | null {
      if (state.status !== "review") return null;
      const recording = state.recording;
      teardown();
      emit({ status: "idle" });
      return recording;
    },
    /** Unmount, account switch, page hide: stop and forget without emitting. */
    teardown(): void {
      teardown();
      state = { status: "idle" };
    },
  };
}

export type VoiceRecorderPort = ReturnType<typeof createVoiceRecorder>;

/**
 * Whether this runtime can record at all. The composer only offers the control
 * when this is true, so the microphone is never decorative.
 */
export function voiceRecordingSupported(): boolean {
  const scope = globalThis as unknown as {
    MediaRecorder?: unknown;
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  };
  return typeof scope.MediaRecorder === "function"
    && typeof scope.navigator?.mediaDevices?.getUserMedia === "function";
}

/** Browser adapter. Returns `null` where the runtime cannot record at all. */
export function browserVoiceDeps(): VoiceRecordingDeps {
  const scope = globalThis as unknown as {
    MediaRecorder?: {
      new (stream: MediaStream, options?: { mimeType?: string }): VoiceRecorderHandle & { mimeType: string };
      isTypeSupported?: (mime: string) => boolean;
    };
    navigator?: { mediaDevices?: { getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream> } };
    setTimeout: (handler: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  };
  const Recorder = scope.MediaRecorder;
  const getUserMedia = scope.navigator?.mediaDevices?.getUserMedia?.bind(scope.navigator.mediaDevices);
  const supported = typeof Recorder === "function" && typeof getUserMedia === "function";
  return {
    createRecorder(stream, mime) {
      if (!supported || !Recorder) return null;
      try {
        return new Recorder(stream, { mimeType: mime });
      } catch {
        return null;
      }
    },
    requestStream() {
      if (!getUserMedia) return Promise.reject(new Error("unavailable"));
      return getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    },
    isTypeSupported: (mime) => Recorder?.isTypeSupported?.(mime) ?? true,
    createMeter: (stream) => createInputMeter(stream),
    now: () => Date.now(),
    setTimeout: (handler, ms) => scope.setTimeout(handler, ms),
    clearTimeout: (id) => scope.clearTimeout(id),
  };
}
