import type { ReactNode } from "react";
import { LoaderCircle, Mic, Pause, Play, SendHorizontal, Trash2 } from "lucide-react";
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

/** Replaces (never stacks above) the text composer. Native buttons retain
 * keyboard names/focus; waveform/timer updates do not flood a live region. */
export function VoiceRecordingPanel({ phase, peaks, elapsedMs, percent, playing, previewReady = false,
  canResume = false, sending = false, allowed = true, onPreview, onPause, onResume, onDiscard, onSend }: {
  phase: "recording" | "pausing" | "review";
  peaks: readonly number[]; elapsedMs: number; percent: number; playing: boolean;
  previewReady?: boolean; canResume?: boolean; sending?: boolean; allowed?: boolean;
  onPreview: () => void; onPause: () => void; onResume: () => void; onDiscard: () => void; onSend: () => void;
}) {
  const review = phase === "review";
  return <div className="fb-chat-voice-panel" role="group"
    aria-label={review ? "Voice message ready" : "Recording voice message"} aria-busy={phase === "pausing" || sending}>
    <span className="sr-only" role="status">{sending ? "Sending voice message" : review ? "Recording paused. Preview, resume or send." : phase === "pausing" ? "Preparing preview" : "Recording"}</span>
    <div className="fb-voice-panel-wave">
      {review ? <button type="button" className="fb-voice-panel-preview" aria-label={playing ? "Pause voice preview" : "Play voice preview"}
        disabled={!previewReady || sending} onClick={onPreview}>
        {playing ? <Pause size={25} aria-hidden="true" /> : <Play size={25} aria-hidden="true" />}
      </button> : <span className="fb-chat-voice-dot" aria-hidden="true" />}
      <VoiceWave peaks={peaks} percent={percent} cursor={review} />
      <span className="fb-chat-voice-time">{formatVoiceDuration(elapsedMs)}</span>
    </div>
    <div className="fb-voice-panel-actions">
      <button type="button" className="fb-voice-panel-discard" aria-label="Discard recording" onClick={onDiscard} disabled={sending}>
        <Trash2 size={23} aria-hidden="true" />
      </button>
      {review ? <button type="button" className="fb-voice-panel-resume" aria-label="Resume recording" onClick={onResume}
        disabled={!canResume || sending}><Mic size={22} aria-hidden="true" /><span>Resume</span></button>
        : <button type="button" className="fb-voice-panel-resume" aria-label="Pause recording" onClick={onPause}
          disabled={phase === "pausing"}><Pause size={24} aria-hidden="true" /></button>}
      <button type="button" className="fb-voice-panel-send" aria-label={sending ? "Sending voice message" : "Send voice message"}
        onClick={onSend} disabled={!review || !allowed || sending}>
        {sending ? <LoaderCircle className="fb-voice-sending" size={25} aria-hidden="true" /> : <SendHorizontal size={25} fill="currentColor" aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
