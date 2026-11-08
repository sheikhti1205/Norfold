/**
 * The ONE voice-note playback owner.
 *
 * A conversation can hold many notes, but only one may play: starting a second
 * pauses the first rather than mixing two voices. Nothing autoplays, a seek is
 * explicit, and a note that cannot be decoded reports itself instead of
 * pretending to play.
 */
import { formatVoiceDuration } from "./voice";

export interface VoiceAudioHandle {
  src: string;
  currentTime: number;
  playbackRate: number;
  readonly duration: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "timeupdate" | "ended" | "error" | "loadedmetadata", listener: () => void): void;
  removeEventListener(type: "timeupdate" | "ended" | "error" | "loadedmetadata", listener: () => void): void;
  /** Detach the source and stop buffering. */
  release(): void;
}

export interface VoicePlaybackPorts {
  createAudio(): VoiceAudioHandle | null;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface VoicePlaybackSnapshot {
  playingId: string | null;
  positionMs: number;
  durationMs: number;
}

type Listener = (snapshot: VoicePlaybackSnapshot) => void;

const SEEK_STEP_MS = 10_000;

/**
 * One element for the whole transcript. `durationHintMs` is the value stored on
 * the attachment, so a container that reports `Infinity` (WebM often does)
 * still shows a truthful length.
 */
export function createVoicePlayback(ports: VoicePlaybackPorts) {
  let audio: VoiceAudioHandle | null = null;
  let current: { id: string; url: string; durationMs: number } | null = null;
  let positionMs = 0;
  let playing = false;
  let listener: Listener | null = null;
  let ticker: number | null = null;

  const snapshot = (): VoicePlaybackSnapshot => ({
    playingId: playing ? current?.id ?? null : null,
    positionMs: current?.id === null ? 0 : positionMs,
    durationMs: current?.durationMs ?? 0,
  });

  const emit = () => listener?.(snapshot());

  const stopTicker = () => {
    if (ticker !== null) ports.clearInterval(ticker);
    ticker = null;
  };

  /** Release everything; the blob URL belongs to the caller. */
  const reset = () => {
    stopTicker();
    if (audio) {
      try { audio.pause(); } catch { /* already stopped */ }
      audio.release();
    }
    audio = null;
    current = null;
    playing = false;
    positionMs = 0;
  };

  const seekTo = (milliseconds: number) => {
    if (!audio || !current) return;
    const bounded = Math.min(current.durationMs, Math.max(0, Math.round(milliseconds)));
    try { audio.currentTime = bounded / 1000; } catch { /* not seekable yet */ }
    positionMs = bounded;
    emit();
  };

  const readPosition = () => {
    if (!audio) return;
    const seconds = audio.currentTime;
    positionMs = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : positionMs;
    emit();
  };

  const startTicker = () => {
    stopTicker();
    ticker = ports.setInterval(readPosition, 200);
  };

  return {
    get snapshot(): VoicePlaybackSnapshot {
      return snapshot();
    },
    subscribe(next: Listener): () => void {
      listener = next;
      return () => { if (listener === next) listener = null; };
    },
    /** Load (not play) one note. A different note always stops the old one. */
    load(id: string, url: string, durationHintMs: number): boolean {
      if (current?.id === id && current.url === url && audio) return true;
      reset();
      const element = ports.createAudio();
      if (!element) return false;
      audio = element;
      current = { id, url, durationMs: durationHintMs };
      element.src = url;
      element.addEventListener("timeupdate", readPosition);
      element.addEventListener("ended", () => {
        stopTicker();
        playing = false;
        if (current) {
          // Ending is not the same as resetting: the bubble keeps the length.
          positionMs = current.durationMs;
        }
        emit();
      });
      element.addEventListener("error", () => { reset(); emit(); });
      emit();
      return true;
    },
    async play(): Promise<void> {
      if (!audio) return;
      stopTicker();
      playing = true;
      emit();
      startTicker();
      try {
        await audio.play();
      } catch {
        // Autoplay refusal or a decode failure: say nothing plays.
        stopTicker();
        playing = false;
        emit();
      }
    },
    pause(): void {
      if (!audio || !playing) return;
      try { audio.pause(); } catch { /* already paused */ }
      stopTicker();
      playing = false;
      readPosition();
    },
    seekTo(milliseconds: number): void {
      seekTo(milliseconds);
    },
    setRate(rate: number): void {
      if (audio && [1, 1.5, 2].includes(rate)) audio.playbackRate = rate;
    },
    /** Skip back/forward from the current position, clamped to the note. */
    nudge(direction: "back" | "forward"): void {
      if (!current) return;
      seekTo(positionMs + (direction === "forward" ? SEEK_STEP_MS : -SEEK_STEP_MS));
    },
    /** Leaving the conversation, account switch or unmount. */
    teardown(): void {
      reset();
      listener = null;
    },
  };
}

export type VoicePlaybackPort = ReturnType<typeof createVoicePlayback>;

export function browserVoicePlaybackPorts(): VoicePlaybackPorts {
  return {
    createAudio() {
      const scope = globalThis as unknown as { Audio?: new () => HTMLAudioElement };
      if (typeof scope.Audio !== "function") return null;
      const element = new scope.Audio();
      element.preload = "metadata";
      return {
        get src() { return element.src; },
        set src(value: string) { element.src = value; },
        get currentTime() { return element.currentTime; },
        set currentTime(value: number) { element.currentTime = value; },
        get playbackRate() { return element.playbackRate; },
        set playbackRate(value: number) { element.playbackRate = value; },
        get duration() { return element.duration; },
        get paused() { return element.paused; },
        play: () => element.play(),
        pause: () => element.pause(),
        addEventListener: (type, listener) => element.addEventListener(type, listener),
        removeEventListener: (type, listener) => element.removeEventListener(type, listener),
        release: () => {
          element.pause();
          element.removeAttribute("src");
          element.load();
        },
      };
    },
    setInterval: (handler, ms) => globalThis.setInterval(handler, ms) as unknown as number,
    clearInterval: (id) => globalThis.clearInterval(id),
  };
}

/** Progress for the bubble's thin bar, in percent, with a floor for rounding. */
export function voiceProgressPercent(positionMs: number, durationMs: number): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (positionMs / durationMs) * 100));
}

export { formatVoiceDuration };
