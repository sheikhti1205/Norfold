import type { ReactNode } from "react";
import { LoaderCircle, Mic, Pause, Play, SendHorizontal, Trash2 } from "lucide-react";
import { VOICE_MAX_MS } from "../services/messaging/voice";
import { formatVoiceDuration, voiceProgressPercent } from "../services/messaging/voicePlayback";
import { peakPercent, VOICE_BARS } from "../services/messaging/voicePeaks";
import "./voiceNote.css";

/** Both the draft and delivered note draw the measured envelope around one
 * centerline. No ID-derived bars and no second, fixture-only player. */
export function VoiceWave({ peaks, percent, cursor = false }: {
  peaks: readonly number[]; percent: number; cursor?: boolean;
}) {
  const bars = peaks.length ? peaks : new Array<number>(VOICE_BARS).fill(0);
  const bounded = Math.min(100, Math.max(0, percent));
  const played = Math.round(bounded / 100 * bars.length);
  return <span className="fb-chat-voice-track" aria-hidden="true">
    {bars.map((peak, index) => <span key={index} className="fb-chat-voice-bar"
      data-played={index < played || undefined} style={{ height: `${peakPercent(peak)}%` }} />)}
    {cursor && <span className="fb-chat-voice-cursor" style={{ insetInlineStart: `calc(${bounded}% - ${bounded / 100 * 9}px)` }} />}
  </span>;
}

export function VoiceMessagePlayer({ peaks, playing, ready, durationMs, positionMs, avatar, rate, onRate, onToggle }: {
  peaks: readonly number[]; playing: boolean; ready: boolean; durationMs: number; positionMs: number;
  avatar: ReactNode; rate: number; onRate: () => void; onToggle: () => void;
}) {
  return <div className="fb-chat-voice">
    <span className="fb-chat-voice-identity">
      {playing ? <button type="button" className="fb-chat-voice-rate" aria-label={`Playback speed ${rate}×`} onClick={onRate}>{rate}×</button>
        : <><span className="fb-chat-voice-avatar">{avatar}</span><Mic className="fb-chat-voice-mic" size={15} aria-hidden="true" /></>}
    </span>
    <button type="button" className="fb-chat-voice-toggle" aria-label={playing ? "Pause voice message" : "Play voice message"}
      disabled={!ready || durationMs <= 0} onClick={onToggle}>
      {playing ? <Pause size={25} aria-hidden="true" /> : <Play size={25} aria-hidden="true" />}
    </button>
    <span className="fb-chat-voice-timeline">
      <VoiceWave peaks={peaks} percent={voiceProgressPercent(positionMs, durationMs)} cursor />
      <span className="fb-chat-voice-time">{durationMs > 0 ? formatVoiceDuration(playing ? positionMs : durationMs) : ""}</span>
    </span>
  </div>;
}

/** One minute of capture is one sweep of the whole track, and the recorder's
 * own ceiling is five minutes, so the same sweep repeats five times at most.
 * Completed minutes are banked as five compact marks, never as slices of the
 * sweep: a slice would read as one five-minute cumulative bar. */
const CAPTURE_SWEEPS = 5;
const CAPTURE_MINUTE_MS = 60_000;

/** The capture clock, never the preview clock. `captureElapsedMs` is the
 * monotonic recorder time, so pause/resume neither rewinds the sweep nor clears
 * a banked minute, and the ceiling leaves the last sweep full. */
function captureTrack(captureElapsedMs: number, captureLimitMs: number, capturing: boolean) {
  const limit = Number.isFinite(captureLimitMs) && captureLimitMs > 0 ? Math.round(captureLimitMs) : VOICE_MAX_MS;
  const elapsed = Number.isFinite(captureElapsedMs) ? Math.min(limit, Math.max(0, Math.round(captureElapsedMs))) : 0;
  const count = Math.min(CAPTURE_SWEEPS, Math.max(1, Math.ceil(limit / CAPTURE_MINUTE_MS)));
  const width = limit / count;
  const atCeiling = elapsed >= limit;
  const completedMinutes = Math.min(count, Math.floor(elapsed / width));
  const minuteProgress = atCeiling ? 1 : (elapsed % width) / width;
  return {
    marks: Array.from({ length: count }, (_, index) => index < completedMinutes),
    minuteProgress,
    active: capturing && minuteProgress > 0 && !atCeiling,
    remainingMs: Math.max(0, limit - elapsed),
    finalMinute: limit - elapsed <= width,
  };
}

/** Replaces (never stacks above) the text composer. Native buttons retain
 * keyboard names/focus; waveform/timer updates do not flood a live region.
 *
 * `elapsedMs` is the clock on screen: the preview position while a finished
 * take plays, otherwise its total. `captureElapsedMs` is the separate,
 * monotonic capture clock that drives the minute sweep and the last-minute
 * countdown; it defaults to `elapsedMs` for callers that never preview. */
export function VoiceRecordingPanel({ phase, peaks, elapsedMs, percent, captureElapsedMs, captureLimitMs = VOICE_MAX_MS,
  playing, previewReady = false, canResume = false, sending = false, allowed = true,
  onPreview, onPause, onResume, onDiscard, onSend }: {
  phase: "recording" | "pausing" | "review";
  peaks: readonly number[]; elapsedMs: number; percent: number; playing: boolean;
  captureElapsedMs?: number; captureLimitMs?: number;
  previewReady?: boolean; canResume?: boolean; sending?: boolean; allowed?: boolean;
  onPreview: () => void; onPause: () => void; onResume: () => void; onDiscard: () => void; onSend: () => void;
}) {
  const review = phase === "review";
  const capture = captureTrack(captureElapsedMs ?? elapsedMs, captureLimitMs, !review);
  // One polite notice per phase change, never per tick: the last-minute warning
  // is derived from the threshold, so the text holds for the whole minute.
  const status = sending ? "Sending voice message"
    : review ? "Recording paused. Preview, resume or send."
    : phase === "pausing" ? "Preparing preview"
    : capture.finalMinute ? "Recording. One minute left"
    : "Recording";
  return <div className="fb-chat-voice-panel" role="group"
    aria-label={review ? "Voice message ready" : "Recording voice message"} aria-busy={phase === "pausing" || sending}>
    <span className="sr-only" role="status">{status}</span>
    <div className="fb-voice-panel-wave">
      {review ? <button type="button" className="fb-voice-panel-preview" aria-label={playing ? "Pause voice preview" : "Play voice preview"}
        disabled={!previewReady || sending} onClick={onPreview}>
        {playing ? <Pause size={25} aria-hidden="true" /> : <Play size={25} aria-hidden="true" />}
      </button> : <span className="fb-chat-voice-dot" aria-hidden="true" />}
      <span className="fb-voice-capture-track">
        <VoiceWave peaks={peaks} percent={review ? percent : 0} cursor={review} />
        {!review && <span className="fb-voice-capture-fill" aria-hidden="true"
          data-active={capture.active || undefined} style={{ width: `${Math.round(capture.minuteProgress * 100)}%` }} />}
      </span>
      <span className="fb-voice-panel-clock">
        <span className="fb-chat-voice-time">
          {formatVoiceDuration(elapsedMs)}
          {!review && capture.finalMinute && <span className="fb-voice-panel-remaining"> / {formatVoiceDuration(capture.remainingMs)} left</span>}
        </span>
        <span className="fb-voice-capture-marks" aria-hidden="true">
          {capture.marks.map((complete, index) => <span key={index} className="fb-voice-capture-mark"
            data-complete={complete || undefined} />)}
        </span>
      </span>
    </div>
    <div className="fb-voice-panel-actions">
      <button type="button" className="fb-voice-panel-discard" aria-label="Discard recording" onClick={onDiscard} disabled={sending}>
        <Trash2 size={23} aria-hidden="true" />
      </button>
      {review ? <button type="button" className="fb-voice-panel-resume" aria-label="Resume recording" onClick={onResume}
        disabled={!canResume || sending}><Mic size={22} aria-hidden="true" /><span>Resume</span></button>
        : <button type="button" className="fb-voice-panel-resume" aria-label="Pause recording" onClick={onPause}
          disabled={phase === "pausing" || sending}><Pause size={24} aria-hidden="true" /></button>}
      <button type="button" className="fb-voice-panel-send" aria-label={sending ? "Sending voice message" : "Send voice message"}
        onClick={onSend} disabled={phase === "pausing" || !allowed || sending}>
        {sending ? <LoaderCircle className="fb-voice-sending" size={25} aria-hidden="true" /> : <SendHorizontal size={25} fill="currentColor" aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
