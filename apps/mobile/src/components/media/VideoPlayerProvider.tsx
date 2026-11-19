import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { VideoPlayer, type VideoPlayerMode } from "./VideoPlayer";
import "./videoPlayer.css";

/**
 * The one owner of video playback for the whole app (owner requirement
 * 2026-11-15: a real player with a YouTube-style pop-out).
 *
 * There is exactly ONE <video> element, so "only one video plays at a time" is
 * structural rather than a rule to remember. It never remounts between the
 * transcript bubble, the full-viewport overlay and the docked mini-player: the
 * provider owns a stable host node and MOVES that node between the bubble's
 * slot and <body>. React keeps rendering into the same container, so the
 * element, its decoder and its playhead survive every presentation change.
 *
 * Object-URL ownership is explicit: a surface that hands a blob URL over marks
 * it `revokeOnClose`, and this provider revokes it after the element has
 * unmounted. The surface must not revoke it too.
 */

export interface VideoPlayerSource {
  /** Stable identity of the surface that opened this media. */
  id: string;
  /** Object URL or ordinary URL. */
  src: string;
  name: string;
  poster?: string | null;
  /** True when `src` is an object URL this provider must revoke on close. */
  revokeOnClose?: boolean;
  /** The element the compact inline presentation renders into. */
  slot?: HTMLElement | null;
}

export interface VideoPlayerApi {
  video: VideoPlayerSource | null;
  mode: VideoPlayerMode;
  /**
   * The open source's own width/height ratio, measured from the one playing
   * element's real metadata. Null until that measurement exists, and always
   * tied to the source it was measured from.
   */
  aspect: number | null;
  open: (source: VideoPlayerSource) => void;
  minimize: () => void;
  expand: () => void;
  close: () => void;
}

const VideoPlayerContext = createContext<VideoPlayerApi | null>(null);

function revokeSource(source: VideoPlayerSource | null): void {
  if (!source?.revokeOnClose) return;
  if (!source.src.startsWith("blob:")) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(source.src);
}

export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ source: VideoPlayerSource | null; mode: VideoPlayerMode }>({
    source: null,
    mode: "inline",
  });
  // A measurement always carries the src it came from, so replacing the video
  // cannot inherit the previous source's shape.
  const [aspectSample, setAspectSample] = useState<{ src: string; ratio: number } | null>(null);
  // Created imperatively on purpose: React portals keep the container's own
  // parent in their bookkeeping, so a React-owned host cannot be moved between
  // the bubble and <body> without breaking unmount. This host is invisible to
  // React; only the player inside it is rendered by React.
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (hostRef.current === null && typeof document !== "undefined") {
    const host = document.createElement("div");
    host.className = "fb-vp-host";
    host.setAttribute("data-testid", "video-player-host");
    hostRef.current = host;
  }

  // The measurement callback can land a tick after the source changed, so it
  // compares against the source open right now, not the render that made it.
  const sourceRef = useRef<VideoPlayerSource | null>(null);
  sourceRef.current = state.source;

  // An inline presentation with nowhere to sit is the docked player: the
  // bubble can unmount while a message is playing.
  const mode: VideoPlayerMode = state.source
    ? (state.mode === "inline" && !state.source.slot ? "mini" : state.mode)
    : "inline";

  const open = useCallback((source: VideoPlayerSource) => {
    // A replacement starts with an unknown shape; a same-src re-home keeps the
    // measurement this video already earned.
    setAspectSample((current) => (current && current.src === source.src ? current : null));
    setState((current) => {
      if (current.source && current.source.id === source.id && current.source.src === source.src) {
        // Same media, re-homed: keep the element and the playhead.
        return {
          source: { ...current.source, slot: source.slot ?? current.source.slot, name: source.name },
          mode: "inline",
        };
      }
      return { source, mode: "inline" };
    });
  }, []);

  const minimize = useCallback(() => {
    setState((current) => (current.source ? { ...current, mode: "mini" } : current));
  }, []);

  const expand = useCallback(() => {
    setState((current) => (current.source ? { ...current, mode: "expanded" } : current));
  }, []);

  const close = useCallback(() => {
    setAspectSample(null);
    setState((current) => (current.source ? { source: null, mode: "inline" } : current));
  }, []);

  const reportAspect = useCallback((ratio: number | null, measuredSrc: string) => {
    // Keyed by source: a late frame from the video that was just replaced must
    // never set the replacement's frame.
    if (sourceRef.current?.src !== measuredSrc) return;
    setAspectSample((current) => {
      if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) {
        return current && current.src === measuredSrc ? null : current;
      }
      if (current && current.src === measuredSrc && current.ratio === ratio) return current;
      return { src: measuredSrc, ratio };
    });
  }, []);

  // Revoke only after React removed the element that was reading the blob, and
  // only when the outgoing source is not the one still on screen.
  const previousSource = useRef<VideoPlayerSource | null>(null);
  useEffect(() => {
    const before = previousSource.current;
    previousSource.current = state.source;
    if (before && before.src !== state.source?.src) revokeSource(before);
  }, [state.source]);

  // Move the stable host, never the player inside it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const target = state.source && mode === "inline" && state.source.slot
      ? state.source.slot
      : document.body;
    if (host.parentElement !== target) target.appendChild(host);
  }, [mode, state.source]);

  useEffect(() => {
    const host = hostRef.current;
    return () => { host?.remove(); };
  }, []);

  const aspect = state.source && aspectSample && aspectSample.src === state.source.src
    ? aspectSample.ratio
    : null;

  const api = useMemo<VideoPlayerApi>(() => ({
    video: state.source, mode, aspect, open, minimize, expand, close,
  }), [state.source, mode, aspect, open, minimize, expand, close]);

  const host = hostRef.current;
  return <VideoPlayerContext.Provider value={api}>
    {children}
    {host === null ? null : createPortal(state.source ? <VideoPlayer
      src={state.source.src}
      name={state.source.name}
      poster={state.source.poster}
      mode={mode}
      onMinimize={minimize}
      onExpand={expand}
      onClose={close}
      onAspect={reportAspect}
    /> : null, host)}
  </VideoPlayerContext.Provider>;
}

export function useVideoPlayer(): VideoPlayerApi {
  const api = useContext(VideoPlayerContext);
  if (!api) throw new Error("useVideoPlayer must be used inside <VideoPlayerProvider>");
  return api;
}
