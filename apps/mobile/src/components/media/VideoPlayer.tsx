import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Download, LoaderCircle, Maximize2, Minimize2, Pause, PictureInPicture2, Play,
  TriangleAlert, Volume1, Volume2, VolumeX, X,
} from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useHoverLabel } from "../HoverLabel";
import { registerBackInterceptor } from "../backNavigation";

/**
 * One playback engine for every conversation file that carries a timeline.
 *
 * The element owns the truth (`timeupdate`, `progress`, `volumechange`); this
 * hook only mirrors it into React. No requestAnimationFrame loop exists: a
 * paused or hidden player costs nothing, and a playing one re-renders at the
 * browser's own timeupdate cadence (about four times a second), which is what
 * the clock and the seek bar actually need.
 */

export interface MediaEngine {
  /** Callback ref for the <video>/<audio> element. */
  setElement: (element: HTMLMediaElement | null) => void;
  element: HTMLMediaElement | null;
  playing: boolean;
  /** True once the browser can play through (`canplay`). */
  ready: boolean;
  /** True when the element refused the source (unsupported codec, bad file). */
  failed: boolean;
  time: number;
  duration: number;
  /** End of the buffered range that contains the playhead, in seconds. */
  buffered: number;
  volume: number;
  muted: boolean;
  rate: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  cycleRate: () => void;
}

/** The rates the reader can step through, in order. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

/** `mm:ss`, or `h:mm:ss` once the media is an hour or longer. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

function bufferedEnd(element: HTMLMediaElement): number {
  const ranges = element.buffered;
  if (!ranges || ranges.length === 0) return 0;
  const time = element.currentTime;
  for (let index = 0; index < ranges.length; index += 1) {
    const end = ranges.end(index);
    if (ranges.start(index) <= time && time <= end) return end;
  }
  return ranges.end(ranges.length - 1);
}

export function useMediaEngine(): MediaEngine {
  const [element, setElement] = useState<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!element) return;
    const syncTime = () => {
      setTime(element.currentTime);
      setBuffered(bufferedEnd(element));
    };
    const syncDuration = () => {
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      syncTime();
    };
    const onPlay = () => { setPlaying(true); setFailed(false); };
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setReady(true); };
    const onReady = () => { setReady(true); setFailed(false); syncTime(); };
    const onWaiting = () => setReady(false);
    const onError = () => { setFailed(true); setReady(false); setPlaying(false); };
    const onVolume = () => {
      setVolumeState(element.volume);
      setMuted(element.muted);
    };
    const onRate = () => setRate(element.playbackRate);

    element.addEventListener("loadedmetadata", syncDuration);
    element.addEventListener("durationchange", syncDuration);
    element.addEventListener("timeupdate", syncTime);
    element.addEventListener("progress", syncTime);
    element.addEventListener("seeked", syncTime);
    element.addEventListener("canplay", onReady);
    element.addEventListener("canplaythrough", onReady);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("playing", onReady);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onEnded);
    element.addEventListener("error", onError);
    element.addEventListener("volumechange", onVolume);
    element.addEventListener("ratechange", onRate);
    // The element may already hold metadata by the time React attached these
    // (a cached object URL loads instantly).
    syncDuration();
    onVolume();
    setRate(element.playbackRate);
    setPlaying(!element.paused && element.currentTime > 0);
    return () => {
      element.removeEventListener("loadedmetadata", syncDuration);
      element.removeEventListener("durationchange", syncDuration);
      element.removeEventListener("timeupdate", syncTime);
      element.removeEventListener("progress", syncTime);
      element.removeEventListener("seeked", syncTime);
      element.removeEventListener("canplay", onReady);
      element.removeEventListener("canplaythrough", onReady);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("playing", onReady);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
      element.removeEventListener("volumechange", onVolume);
      element.removeEventListener("ratechange", onRate);
    };
  }, [element]);

  const play = useCallback(() => {
    if (!element) return;
    // A refused play() is a policy answer (autoplay, or the element detached),
    // not a broken file: the poster and the play button stay usable.
    const attempt = element.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => undefined);
  }, [element]);

  const pause = useCallback(() => { element?.pause(); }, [element]);

  const toggle = useCallback(() => {
    if (!element) return;
    if (element.paused) play();
    else element.pause();
  }, [element, play]);

  const seek = useCallback((seconds: number) => {
    if (!element) return;
    const limit = Number.isFinite(element.duration) ? element.duration : seconds;
    const next = Math.max(0, Math.min(limit, seconds));
    element.currentTime = next;
    setTime(next);
  }, [element]);

  const seekBy = useCallback((delta: number) => {
    if (!element) return;
    seek(element.currentTime + delta);
  }, [element, seek]);

  const setVolume = useCallback((value: number) => {
    if (!element) return;
    const next = Math.max(0, Math.min(1, value));
    element.volume = next;
    // Raising the volume is an explicit request to hear it again.
    if (next > 0 && element.muted) element.muted = false;
    setVolumeState(next);
    setMuted(element.muted);
  }, [element]);

  const toggleMute = useCallback(() => {
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
  }, [element]);

  const cycleRate = useCallback(() => {
    if (!element) return;
    const index = PLAYBACK_RATES.indexOf(element.playbackRate as (typeof PLAYBACK_RATES)[number]);
    const next = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]!;
    element.playbackRate = next;
    setRate(next);
  }, [element]);

  return useMemo(() => ({
    setElement, element, playing, ready, failed, time, duration, buffered, volume, muted, rate,
    play, pause, toggle, seek, seekBy, setVolume, toggleMute, cycleRate,
  }), [
    element, playing, ready, failed, time, duration, buffered, volume, muted, rate,
    play, pause, toggle, seek, seekBy, setVolume, toggleMute, cycleRate,
  ]);
}

/** The object URL a chat file hands to the player is saved through this
 * anchor. No window.open, no navigation, no second download of the blob. */
export function downloadMedia(src: string, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.download = name;
  anchor.rel = "noreferrer";
  anchor.click();
}

export type VideoPlayerMode = "inline" | "expanded" | "mini";

export interface VideoPlayerProps {
  src: string;
  name: string;
  poster?: string | null;
  mode: VideoPlayerMode;
  onMinimize: () => void;
  onExpand: () => void;
  onClose: () => void;
}

const TRANSPORT_SELECTOR = "input, textarea, select, [contenteditable='true']";
const CONTROL_SELECTOR = "button, a, [role='button']";

/**
 * The one video surface. Its DOM subtree never moves between presentations —
 * only classes and a few siblings change — so the <video> node, its decoder
 * and its playhead survive inline → expanded → mini.
 */
export function VideoPlayer({ src, name, poster, mode, onMinimize, onExpand, onClose }: VideoPlayerProps) {
  const engine = useMediaEngine();
  const { hoverLabel } = useHoverLabel();
  const {
    setElement, element, playing, ready, failed, time, duration, buffered, volume, muted, rate,
    play, toggle, seek, seekBy, setVolume, toggleMute, cycleRate,
  } = engine;
  const rootRef = useRef<HTMLDivElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const expanded = mode === "expanded";

  // Escape minimises through the app's one modal layer stack, Tab wraps, and
  // focus returns to whatever launched the overlay when it leaves.
  const focusTrapRef = useFocusTrap(
    rootRef as React.RefObject<HTMLElement | null>,
    onMinimize,
    expanded,
  );

  const [chromeVisible, setChromeVisible] = useState(true);
  const [focusWithin, setFocusWithin] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const stateRef = useRef({ playing, failed, focusWithin });
  stateRef.current = { playing, failed, focusWithin };

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  // Restart the idle countdown. While a control holds focus the bar stays put:
  // hiding the thing the keyboard is on would be a trap, not a courtesy.
  const scheduleHide = useCallback(() => {
    clearHideTimer();
    const current = stateRef.current;
    if (!current.playing || current.failed) return;
    hideTimer.current = window.setTimeout(() => {
      if (!stateRef.current.focusWithin) setChromeVisible(false);
    }, 2500);
  }, [clearHideTimer]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    setChromeVisible(true);
    scheduleHide();
    return clearHideTimer;
  }, [playing, failed, focusWithin, scheduleHide, clearHideTimer, mode]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  // A full-viewport player owns the page underneath it: the transcript must not
  // scroll behind the scrim, and Android Back minimises instead of leaving the
  // conversation with a movie still playing off-screen.
  useEffect(() => {
    if (!expanded) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const offBack = registerBackInterceptor(() => {
      onMinimize();
      return true;
    });
    return () => {
      document.body.style.overflow = overflow;
      offBack();
    };
  }, [expanded, onMinimize]);

  // Start on open (and on every new source). The listener pair also resumes if
  // a dock/expand swap has to re-create the element before the source settles.
  const autoplayRef = useRef(true);
  useEffect(() => {
    if (!element) return;
    autoplayRef.current = true;
    const attempt = () => {
      if (!autoplayRef.current) return;
      autoplayRef.current = false;
      const result = element.play();
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    };
    if (element.readyState >= 2) attempt();
    element.addEventListener("loadeddata", attempt);
    element.addEventListener("canplay", attempt);
    return () => {
      element.removeEventListener("loadeddata", attempt);
      element.removeEventListener("canplay", attempt);
    };
  }, [element, src]);

  // A keyboard reader who pressed the tile keeps their place in the player.
  useEffect(() => {
    if (mode === "inline") playButtonRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const chromeShown = chromeVisible || !playing || failed || focusWithin;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement | null;
    // Typing is never playback control, and a range slider owns its arrows.
    if (target?.closest?.(TRANSPORT_SELECTOR)) return;
    const onControl = !!target?.closest?.(CONTROL_SELECTOR);
    switch (event.key) {
      case " ":
      case "k":
      case "K":
        if (onControl && event.key === " ") return;
        event.preventDefault();
        toggle();
        revealChrome();
        return;
      case "ArrowLeft":
        event.preventDefault();
        seekBy(-5);
        revealChrome();
        return;
      case "ArrowRight":
        event.preventDefault();
        seekBy(5);
        revealChrome();
        return;
      case "ArrowUp":
        event.preventDefault();
        setVolume((element?.volume ?? volume) + 0.1);
        revealChrome();
        return;
      case "ArrowDown":
        event.preventDefault();
        setVolume((element?.volume ?? volume) - 0.1);
        revealChrome();
        return;
      case "m":
      case "M":
        event.preventDefault();
        toggleMute();
        revealChrome();
        return;
      case "f":
      case "F":
        event.preventDefault();
        if (expanded) onMinimize();
        else onExpand();
        return;
      case "Escape":
        event.preventDefault();
        if (expanded) onMinimize();
        else onClose();
        return;
      default:
    }
  };

  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(`${CONTROL_SELECTOR}, input`)) return;
    if (!chromeShown) revealChrome();
    else toggle();
  };

  const ratio = (value: number) => (duration > 0 ? Math.max(0, Math.min(100, (value / duration) * 100)) : 0);
  const seekLabel = `${formatTime(time)} of ${formatTime(duration)}`;
  const volumeLabel = muted || volume === 0 ? "Unmute" : "Mute";
  const canPictureInPicture = expanded && typeof document !== "undefined"
    && document.pictureInPictureEnabled === true;

  const enterPictureInPicture = (): void => {
    if (!(element instanceof HTMLVideoElement)) return;
    if (!document.pictureInPictureEnabled) return;
    void element.requestPictureInPicture().catch(() => undefined);
  };

  return <div
    ref={(node) => { rootRef.current = node; focusTrapRef(node); }}
    className={`fb-vp fb-vp--${mode}${chromeShown ? "" : " fb-vp--idle"}`}
    data-mode={mode}
    role={expanded ? "dialog" : "group"}
    aria-modal={expanded || undefined}
    aria-label={expanded ? `Video: ${name}` : `Video player: ${name}`}
    tabIndex={-1}
    onKeyDown={onKeyDown}
    onPointerMove={revealChrome}
    onPointerDown={revealChrome}
    onFocus={() => { setFocusWithin(true); setChromeVisible(true); scheduleHide(); }}
    onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setFocusWithin(false);
    }}
  >
    {expanded ? <div className="fb-vp-top">
      <div className="fb-vp-top-actions">
        <button type="button" className="fb-vp-icon fb-vp-icon--overlay" onClick={onClose}
          aria-label="Close video"><X size={20} aria-hidden="true" /></button>
      </div>
      <p className="fb-vp-title" title={name}>{name}</p>
    </div> : null}

    <div className="fb-vp-stage" onClick={onStageClick}>
      <video
        ref={setElement}
        className="fb-vp-video"
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
      />

      {failed ? <div className="fb-vp-error" role="alert">
        <TriangleAlert size={20} aria-hidden="true" />
        <p>This video can&apos;t play here.</p>
        <button type="button" className="fb-vp-error-action" onClick={() => downloadMedia(src, name)}>
          <Download size={16} aria-hidden="true" /> Download
        </button>
      </div> : !ready ? <div className="fb-vp-loading" data-testid="video-loading">
        <LoaderCircle className="fb-vp-spin" size={22} aria-hidden="true" />
        <span className="fb-vp-sr">Loading video</span>
      </div> : null}

      {!failed && ready && !playing ? <button type="button" className="fb-vp-bigplay"
        onClick={(event) => { event.stopPropagation(); play(); }} aria-label={`Play ${name}`}>
        <Play size={expanded ? 30 : 22} aria-hidden="true" />
      </button> : null}

      {mode === "mini" ? null : <div className="fb-vp-bar" data-controls={chromeShown ? "shown" : "hidden"}>
        <div className="fb-vp-track">
          <span className="fb-vp-rail" aria-hidden="true" />
          <span className="fb-vp-buffered" style={{ width: `${ratio(buffered)}%` }} aria-hidden="true" />
          <span className="fb-vp-played" style={{ width: `${ratio(time)}%` }} aria-hidden="true" />
          <input
            type="range"
            className="fb-vp-seek"
            min={0}
            max={duration > 0 ? duration : 0}
            step={0.1}
            value={duration > 0 ? Math.min(time, duration) : 0}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label={`Seek in ${name}`}
            aria-valuetext={seekLabel}
            disabled={duration <= 0}
          />
        </div>
        <div className="fb-vp-row">
          <button ref={playButtonRef} type="button" className="fb-vp-icon" onClick={toggle}
            aria-label={playing ? "Pause" : "Play"} {...hoverLabel(playing ? "Pause" : "Play")}>
            {playing ? <Pause size={expanded ? 20 : 18} aria-hidden="true" />
              : <Play size={expanded ? 20 : 18} aria-hidden="true" />}
          </button>
          <span className="fb-vp-time" aria-hidden="true">{formatTime(time)} / {formatTime(duration)}</span>
          <span className="fb-vp-spacer" />
          <button type="button" className="fb-vp-icon" onClick={toggleMute} aria-label={volumeLabel}
            {...hoverLabel(volumeLabel)}>
            {muted || volume === 0 ? <VolumeX size={18} aria-hidden="true" />
              : volume < 0.5 ? <Volume1 size={18} aria-hidden="true" />
                : <Volume2 size={18} aria-hidden="true" />}
          </button>
          {expanded ? <input
            type="range"
            className="fb-vp-volume"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label={`Volume for ${name}`}
          /> : null}
          <button type="button" className="fb-vp-icon fb-vp-rate" onClick={cycleRate}
            aria-label={`Playback speed ${rate}×`} {...hoverLabel(`Playback speed ${rate}×`)}>{rate}×</button>
          {canPictureInPicture ? <button type="button" className="fb-vp-icon"
            onClick={enterPictureInPicture} aria-label="Picture in picture"
            {...hoverLabel("Picture in picture")}>
            <PictureInPicture2 size={18} aria-hidden="true" />
          </button> : null}
          {expanded ? <button type="button" className="fb-vp-icon"
            onClick={() => downloadMedia(src, name)} aria-label={`Download ${name}`}
            {...hoverLabel(`Download ${name}`)}>
            <Download size={18} aria-hidden="true" />
          </button> : null}
          {expanded
            ? <button type="button" className="fb-vp-icon" onClick={onMinimize} aria-label="Minimize player"
              {...hoverLabel("Minimize player")}>
              <Minimize2 size={18} aria-hidden="true" />
            </button>
            : <>
              <button type="button" className="fb-vp-icon" onClick={onExpand} aria-label="Expand video"
                {...hoverLabel("Expand video")}>
                <Maximize2 size={18} aria-hidden="true" />
              </button>
              <button type="button" className="fb-vp-icon" onClick={onClose} aria-label="Close video"
                {...hoverLabel("Close video")}>
                <X size={18} aria-hidden="true" />
              </button>
            </>}
        </div>
      </div>}
    </div>

    {mode === "mini" ? <>
      <div className="fb-vp-mini-progress" aria-hidden="true">
        <span style={{ width: `${ratio(time)}%` }} />
      </div>
      <div className="fb-vp-mini-actions">
        <button type="button" className="fb-vp-icon" onClick={toggle}
          aria-label={playing ? `Pause ${name}` : `Play ${name}`}
          {...hoverLabel(playing ? `Pause ${name}` : `Play ${name}`)}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <span className="fb-vp-mini-name" title={name}>{name}</span>
        <button type="button" className="fb-vp-icon" onClick={onExpand} aria-label="Expand video"
          {...hoverLabel("Expand video")}>
          <Maximize2 size={16} aria-hidden="true" />
        </button>
        <button type="button" className="fb-vp-icon" onClick={onClose} aria-label="Close video"
          {...hoverLabel("Close video")}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </> : null}

    {expanded ? <div className="fb-vp-backdrop" aria-hidden="true" onClick={onMinimize} /> : null}
  </div>;
}
