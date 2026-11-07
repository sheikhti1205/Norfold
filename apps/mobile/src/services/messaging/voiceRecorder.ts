/**
 * One cross-platform recording port.
 *
 * Web and the Android WebView both expose `MediaRecorder`, so there is no
 * second native recorder to keep in step: the platform object is injected and
 * every lifecycle rule (permission, timer, cancel, teardown) is enforced here.
 *
 * The port never leaves a microphone open. Every terminal path — stop, cancel,
 * maximum duration, error, page hide, account switch, unmount — releases the
 * capture tracks, and a stopped recorder cannot be resumed.
 */
import {
  VOICE_MAX_MS, VOICE_MIN_MS, VOICE_MIME_TYPES, VOICE_PERMISSION_DENIED,
  VOICE_RECORD_FAILED, VOICE_UNAVAILABLE, normalizeVoiceDuration, storedVoiceMime,
} from "./voice";

export interface VoiceRecorderHandle {
  mimeType: string;
  state: "inactive" | "recording";
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface VoiceRecordingDeps {
  /** `null` when this runtime has no recorder at all. */
  createRecorder(stream: MediaStream, mime: string): VoiceRecorderHandle | null;
  requestStream(): Promise<MediaStream>;
  isTypeSupported?(mime: string): boolean;
  now(): number;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export type VoiceRecorderState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "recording"; elapsedMs: number }
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
  let ticker: number | null = null;
  let watchdog: number | null = null;

  const emit = (next: VoiceRecorderState) => {
    state = next;
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* a view must not break recording */ }
    }
  };

  /** Read through a call so an await cannot leave a narrowed stale union. */
  const snapshot = (): VoiceRecorderState => state;

  const releaseTracks = () => {
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
      if (recorder.state === "recording") {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    }
    recorder = null;
    releaseTracks();
  };

  const fail = (message: string) => {
    teardown();
    emit({ status: "error", message });
  };

  const finish = () => {
    const durationMs = deps.now() - startedAt;
    const parts = chunks;
    const mime = storedVoiceMime(recorder?.mimeType ?? parts[0]?.type ?? "");
    teardown();
    const blob = new Blob(parts, { type: mime });
    // An accidental tap is not a message: nothing is sent and nothing is kept.
    if (durationMs < VOICE_MIN_MS || blob.size === 0) {
      emit({ status: "idle" });
      return;
    }
    emit({ status: "review", recording: { blob, mime, durationMs: normalizeVoiceDuration(durationMs) } });
  };

  const tick = () => {
    if (state.status !== "recording") return;
    emit({ status: "recording", elapsedMs: deps.now() - startedAt });
    ticker = deps.setTimeout(tick, 200);
  };

  return {
    get state(): VoiceRecorderState {
      return state;
    },
    subscribe(next: Listener): () => void {
      listeners.add(next);
      return () => { listeners.delete(next); };
    },
    /** Permission is requested here and nowhere else. */
    async start(): Promise<void> {
      if (state.status === "starting" || state.status === "recording") return;
      if (state.status === "review") return;
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
      handle.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      handle.onstop = finish;
      handle.onerror = () => fail(VOICE_RECORD_FAILED);
      try {
        handle.start();
      } catch {
        fail(VOICE_RECORD_FAILED);
        return;
      }
      startedAt = deps.now();
      emit({ status: "recording", elapsedMs: 0 });
      ticker = deps.setTimeout(tick, 200);
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
    /** Throws the note away: nothing is uploaded and the microphone closes. */
    discard(): void {
      teardown();
      emit({ status: "idle" });
    },
    /** Hands the finished note to the caller exactly once. */
    take(): VoiceRecording | null {
      if (state.status !== "review") return null;
      const recording = state.recording;
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
    now: () => Date.now(),
    setTimeout: (handler, ms) => scope.setTimeout(handler, ms),
    clearTimeout: (id) => scope.clearTimeout(id),
  };
}
