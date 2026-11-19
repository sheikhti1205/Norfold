import { useRef, type ReactNode } from "react";
import { LoaderCircle, Mic, Pause, Play, SendHorizontal, Trash2 } from "lucide-react";
import { VOICE_MAX_MS } from "../services/messaging/voice";
import { formatVoiceDuration } from "../services/messaging/voicePlayback";
import "./voiceNote.css";

/** One bounded whole-number percentage for the bar and its ARIA value. */
function boundedPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Milliseconds that are safe to print and compare. */
function safeMillis(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function clampMillis(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** One whole-second timeline for the two clocks, so elapsed plus remaining
 * always adds up to the printed total. The bar keeps the real percentage. */
function voiceClock(positionMs: number, totalMs: number) {
  const totalSeconds = Math.floor(safeMillis(totalMs) / 1000);
  const elapsedSeconds = Math.min(totalSeconds, Math.floor(safeMillis(positionMs) / 1000));
  const leftSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  return {
    elapsed: formatVoiceDuration(elapsedSeconds * 1000),
    left: `${formatVoiceDuration(leftSeconds * 1000)} left`,
    total: formatVoiceDuration(totalSeconds * 1000),
  };
}

/** The one continuous progress control. The recorder, the paused preview and
 * the delivered note all paint this bar and nothing else: no waveform, no
 * second capture line and no banked minute marks. */
export function VoiceProgress({ value, label, text }: {
  value: number; label: string; text: string;
}) {
  const percent = boundedPercent(value);
  return <span className="fb-chat-voice-progress" role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={text}>
    <span className="fb-chat-voice-progress-fill" style={{ width: `${percent}%` }} />
  </span>;
}

/** The delivered note. One compact control row and one progress bar; the
 * timestamp and receipt stay in normal flow below it, never over the bar. */
export function VoiceMessagePlayer(props: {
  peaks?: readonly number[]; playing: boolean; ready: boolean; durationMs: number;
  /** This note's authoritative clock, including a real 0 after a seek or a
   * reset. Omitted while the playback owner holds a different note, so this
   * bubble keeps its own last position instead of reading a stranger's clock. */
  positionMs?: number;
  avatar: ReactNode; rate: number; onRate: () => void; onToggle: () => void;
}) {
  const { playing, ready, durationMs, positionMs, rate, onRate, onToggle } = props;
  const duration = safeMillis(durationMs);
  const owned = typeof positionMs === "number" && Number.isFinite(positionMs)
    ? clampMillis(positionMs, duration)
    : undefined;
  // Only an owned clock moves this note. When the element is holding another
  // note the caller withholds the clock, and this bubble holds its last value.
  const lastPosition = useRef(0);
  if (owned !== undefined) lastPosition.current = owned;
  const position = owned ?? Math.min(duration, lastPosition.current);
  const percent = duration > 0 ? (position / duration) * 100 : 0;
  const clock = voiceClock(position, duration);
  return <div className="fb-chat-voice">
    <div className="fb-chat-voice-row">
      <button type="button" className="fb-chat-voice-toggle"
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        disabled={!ready || duration <= 0} onClick={onToggle}>
        {playing ? <Pause size={25} aria-hidden="true" /> : <Play size={25} aria-hidden="true" />}
      </button>
      {playing && <button type="button" className="fb-chat-voice-rate"
        aria-label={`Playback speed ${rate}×`} onClick={onRate}>{rate}×</button>}
      <span className="fb-chat-voice-clock">
        <span className="fb-chat-voice-time">{clock.elapsed}</span>
        <span className="fb-chat-voice-remaining">{clock.left}</span>
      </span>
    </div>
    <VoiceProgress value={percent} label="Voice message progress"
      text={`${clock.elapsed} of ${clock.total}, ${clock.left}`} />
  </div>;
}

function captureRemaining(captureElapsedMs: number, captureLimitMs: number) {
  const limit = safeMillis(captureLimitMs) || VOICE_MAX_MS;
  const elapsed = clampMillis(captureElapsedMs, limit);
  const remaining = Math.max(0, limit - elapsed);
  return {
    limit,
    elapsed,
    finalMinute: remaining > 0 && remaining <= 60_000,
  };
}

/** Replaces (never stacks above) the text composer with one compact row of
 * controls, the elapsed/remaining labels and a full-width progress bar. The
 * five-minute ceiling still opens review; it never sends. */
export function VoiceRecordingPanel(props: {
  phase: "recording" | "pausing" | "review";
  peaks?: readonly number[]; elapsedMs: number; percent: number;
  /** This take's authoritative preview clock, a real 0 included. Omit while the
   * playback owner holds another note or clip; `percent` is the legacy fallback. */
  positionMs?: number;
  /** The take's recorded length. Wins over `captureElapsedMs` and `elapsedMs`. */
  durationMs?: number;
  captureElapsedMs?: number; captureLimitMs?: number;
  playing: boolean; previewReady?: boolean; canResume?: boolean; sending?: boolean; allowed?: boolean;
  onPreview: () => void; onPause: () => void; onResume: () => void; onDiscard: () => void; onSend: () => void;
}) {
  const {
    phase, elapsedMs, percent, positionMs, durationMs, captureElapsedMs, captureLimitMs = VOICE_MAX_MS,
    playing, previewReady = false, canResume = false, sending = false, allowed = true,
    onPreview, onPause, onResume, onDiscard, onSend,
  } = props;
  const review = phase === "review";
  const capture = captureRemaining(captureElapsedMs ?? elapsedMs, captureLimitMs);
  // Review has its own clock: the recorded container, not the live capture
  // limit. `captureElapsedMs` is the take's duration in review.
  const total = review ? (safeMillis(durationMs) || safeMillis(captureElapsedMs) || safeMillis(elapsedMs)) : capture.limit;
  // An explicit clock, including a real 0 after a seek or a reset, is
  // authoritative: this take owns it. Only a caller that withholds the clock
  // (the element is holding another note) falls back below.
  const supplied = review && typeof positionMs === "number" && Number.isFinite(positionMs)
    ? clampMillis(positionMs, total)
    : undefined;
  const legacy = review ? Math.round((boundedPercent(percent) / 100) * total) : capture.elapsed;
  // Legacy callers that forward only the playing percent send 0 on pause. Keep
  // their last real preview position for this take, never for an explicit 0.
  const lastReview = useRef(0);
  const lastTotal = useRef(total);
  if (!review || lastTotal.current !== total) {
    lastReview.current = 0;
    lastTotal.current = total;
  }
  if (review) {
    if (supplied !== undefined) lastReview.current = supplied;
    else if (playing || legacy > 0) lastReview.current = legacy;
  }
  const position = review
    ? supplied !== undefined ? supplied
      : playing || legacy > 0 ? legacy
        : Math.min(total, lastReview.current)
    : capture.elapsed;
  const progress = total > 0 ? (position / total) * 100 : 0;
  const finalMinute = review ? false : capture.finalMinute;
  const clock = voiceClock(position, total);
  // One polite notice per phase change, never per tick.
  const status = sending ? "Sending voice message"
    : review ? "Recording paused. Preview, resume or send."
    : phase === "pausing" ? "Preparing preview"
    : finalMinute ? "Recording. One minute left"
    : "Recording";
  return <div className="fb-chat-voice-panel" role="group"
    aria-label={review ? "Voice message ready" : "Recording voice message"} aria-busy={phase === "pausing" || sending}>
    <span className="sr-only" role="status">{status}</span>
    <div className="fb-voice-panel-actions">
      <button type="button" className="fb-voice-panel-discard" aria-label="Discard recording"
        onClick={onDiscard} disabled={sending}>
        <Trash2 size={23} aria-hidden="true" />
      </button>
      {review ? <button type="button" className="fb-voice-panel-preview"
        aria-label={playing ? "Pause voice preview" : "Play voice preview"}
        disabled={!previewReady || sending} onClick={onPreview}>
        {playing ? <Pause size={25} aria-hidden="true" /> : <Play size={25} aria-hidden="true" />}
      </button> : <span className="fb-chat-voice-dot" aria-hidden="true" />}
      <span className="fb-voice-panel-clock">
        <span className="fb-chat-voice-time">{clock.elapsed}</span>
        <span className={finalMinute ? "fb-chat-voice-remaining fb-voice-panel-remaining" : "fb-chat-voice-remaining"}>
          {clock.left}
        </span>
      </span>
      {review
        ? <button type="button" className="fb-voice-panel-resume" aria-label="Resume recording"
            onClick={onResume} disabled={!canResume || sending}><Mic size={22} aria-hidden="true" /></button>
        : <button type="button" className="fb-voice-panel-resume" aria-label="Pause recording"
            onClick={onPause} disabled={phase === "pausing" || sending}><Pause size={24} aria-hidden="true" /></button>}
      <button type="button" className="fb-voice-panel-send"
        aria-label={sending ? "Sending voice message" : "Send voice message"}
        onClick={onSend} disabled={phase === "pausing" || !allowed || sending}>
        {sending ? <LoaderCircle className="fb-voice-sending" size={25} aria-hidden="true" />
          : <SendHorizontal size={25} fill="currentColor" aria-hidden="true" />}
      </button>
    </div>
    <VoiceProgress value={progress} label={review ? "Voice preview progress" : "Recording progress"}
      text={`${clock.elapsed} of ${clock.total}, ${clock.left}`} />
  </div>;
}
