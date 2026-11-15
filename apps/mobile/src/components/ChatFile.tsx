import { useEffect, useId, useRef, useState } from "react";
import {
  Archive, Download, File as FileIcon, FileText, Film, LoaderCircle, Music, Pause, Play,
} from "lucide-react";
import { downloadChatFile, type ChatFileMeta } from "../services/messaging/files";
import { formatTime, useMediaEngine } from "./media/VideoPlayer";
import { useVideoPlayer } from "./media/VideoPlayerProvider";
import "./ChatFile.css";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function IconFor({ kind }: { kind: ChatFileMeta["kind"] }) {
  if (kind === "video") return <Film size={22} aria-hidden="true" />;
  if (kind === "audio") return <Music size={22} aria-hidden="true" />;
  if (kind === "archive") return <Archive size={22} aria-hidden="true" />;
  if (kind === "pdf" || kind === "document") return <FileText size={22} aria-hidden="true" />;
  return <FileIcon size={22} aria-hidden="true" />;
}

function triggerDownload(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noreferrer";
  anchor.click();
}

/**
 * One ordinary file in the transcript. Nothing is fetched until the reader
 * asks: a 20 MB video must not download because a thread opened.
 *
 * Video and audio do not use the browser's own controls. Video hands its blob
 * URL to the app-wide player (which revokes it on close, so this bubble must
 * NOT revoke it again); audio stays here as a compact row over the shared
 * playback engine. Documents still open through a download, which is
 * deliberate: the file is data, not a page.
 */
export function ChatFile({ meta }: { meta: ChatFileMeta }) {
  if (meta.kind === "video") return <ChatVideo meta={meta} />;
  if (meta.kind === "audio") return <ChatAudio meta={meta} />;
  return <ChatDocument meta={meta} />;
}

function ChatDocument({ meta }: { meta: ChatFileMeta }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [src, setSrc] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  async function open() {
    if (state === "loading") return;
    if (state === "ready" && src) {
      triggerDownload(src, meta.name);
      return;
    }
    setState("loading");
    try {
      const blob = await downloadChatFile(meta.key);
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setSrc(url);
      setState("ready");
      triggerDownload(url, meta.name);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="fb-chat-file" data-kind={meta.kind}>
      <span className="fb-chat-file-icon"><IconFor kind={meta.kind} /></span>
      <span className="fb-chat-file-copy">
        <span className="fb-chat-file-name" title={meta.name}>{meta.name}</span>
        <span className="fb-chat-file-size">{humanSize(meta.byteSize)}</span>
      </span>
      <button type="button" className="fb-chat-file-action" onClick={() => void open()}
        aria-label={`Open ${meta.name}`} disabled={state === "loading"}>
        {state === "loading" ? "Opening…" : state === "error" ? "Unavailable" : <><Download size={18} aria-hidden="true" /> Open</>}
      </button>
      {state === "error" && <p role="status" className="fb-chat-file-error">That file is no longer available.</p>}
    </div>
  );
}

/**
 * The video tile. It is a poster frame, not a download: pressing play is the
 * only thing that fetches bytes. Once fetched, the blob URL belongs to the
 * global player until the reader closes it.
 */
function ChatVideo({ meta }: { meta: ChatFileMeta }) {
  const player = useVideoPlayer();
  const id = useId();
  const slotRef = useRef<HTMLDivElement | null>(null);
  const srcRef = useRef<string | null>(null);
  const statusRef = useRef<"idle" | "loading" | "ready" | "error">("idle");
  const aliveRef = useRef(true);
  const [status, setStatus] = useState(statusRef.current);

  const mine = player.video?.id === id;
  const inlineHere = mine && player.mode === "inline";

  // Latest API without re-running effects on every playback tick.
  const apiRef = useRef(player);
  apiRef.current = player;

  useEffect(() => () => { aliveRef.current = false; }, []);

  // Leaving the transcript docks the player instead of silencing it; the URL
  // stays the player's to revoke.
  useEffect(() => () => {
    const api = apiRef.current;
    if (api.video?.id === id) api.minimize();
  }, [id]);

  // The player closed (or moved to another message): that URL is gone, so the
  // tile returns to its poster instead of offering a dead source.
  useEffect(() => {
    if (mine || statusRef.current === "idle") return;
    srcRef.current = null;
    statusRef.current = "idle";
    setStatus("idle");
  }, [mine]);

  function updateStatus(next: "idle" | "loading" | "ready" | "error") {
    statusRef.current = next;
    setStatus(next);
  }

  async function start() {
    if (statusRef.current === "loading") return;
    if (statusRef.current === "ready" && srcRef.current) {
      // Same media, re-homed: the provider moves the existing element back.
      player.open({ id, src: srcRef.current, name: meta.name, slot: slotRef.current, revokeOnClose: true });
      return;
    }
    updateStatus("loading");
    try {
      const blob = await downloadChatFile(meta.key);
      if (!aliveRef.current) return;
      const url = URL.createObjectURL(blob);
      srcRef.current = url;
      updateStatus("ready");
      player.open({ id, src: url, name: meta.name, slot: slotRef.current, revokeOnClose: true });
    } catch {
      if (aliveRef.current) updateStatus("error");
    }
  }

  return <div className="fb-chat-video" data-kind="video">
    <div className="fb-chat-video-frame" ref={slotRef}>
      {!inlineHere && <button type="button" className="fb-chat-video-launch" disabled={status === "loading"}
        onClick={() => void start()}
        aria-label={mine ? `Show ${meta.name} in the conversation` : `Play ${meta.name}`}>
        <span className="fb-chat-video-art" aria-hidden="true"><Film size={26} /></span>
        <span className="fb-chat-video-play" aria-hidden="true">
          {status === "loading" ? <LoaderCircle className="fb-chat-video-spin" size={18} />
            : <Play size={18} fill="currentColor" />}
        </span>
      </button>}
    </div>
    <div className="fb-chat-video-meta">
      <Film size={14} aria-hidden="true" />
      <span className="fb-chat-video-name" title={meta.name}>{meta.name}</span>
      <span className="fb-chat-video-size">{humanSize(meta.byteSize)}</span>
    </div>
    {status === "error" && <p role="status" className="fb-chat-file-error">That file is no longer available.</p>}
  </div>;
}

/**
 * A compact audio row over the same engine as the video player. The blob is
 * fetched on the first press and this row owns (and revokes) it, because an
 * audio file never leaves the bubble.
 */
function ChatAudio({ meta }: { meta: ChatFileMeta }) {
  const engine = useMediaEngine();
  const { setElement, element, playing, failed, time, duration, buffered } = engine;
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const srcRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const autoplayRef = useRef(false);

  useEffect(() => () => {
    aliveRef.current = false;
    if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    srcRef.current = null;
  }, []);

  // The element only has the new source after this commit.
  useEffect(() => {
    if (!src || !autoplayRef.current) return;
    autoplayRef.current = false;
    const attempt = element?.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => undefined);
  }, [src, element]);

  async function ensureSource(): Promise<string | null> {
    if (srcRef.current) return srcRef.current;
    setLoading(true);
    setError(false);
    try {
      const blob = await downloadChatFile(meta.key);
      if (!aliveRef.current) return null;
      const url = URL.createObjectURL(blob);
      srcRef.current = url;
      setSrc(url);
      setLoading(false);
      return url;
    } catch {
      if (aliveRef.current) { setError(true); setLoading(false); }
      return null;
    }
  }

  async function togglePlay() {
    if (src) { engine.toggle(); return; }
    if (loading) return;
    autoplayRef.current = true;
    const url = await ensureSource();
    if (!url) autoplayRef.current = false;
  }

  async function save() {
    const url = src ?? await ensureSource();
    if (url) triggerDownload(url, meta.name);
  }

  const played = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const loaded = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const label = failed ? "This audio can't play here" : playing ? "Pause" : "Play";

  return <div className="fb-chat-audio" data-kind="audio">
    <audio ref={setElement} className="fb-chat-audio-el" src={src ?? undefined} preload="metadata" />
    <button type="button" className="fb-chat-audio-play" onClick={() => void togglePlay()}
      aria-label={`${label} ${meta.name}`}>
      {loading ? <LoaderCircle className="fb-chat-video-spin" size={18} aria-hidden="true" />
        : failed ? <Music size={18} aria-hidden="true" />
          : playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
    </button>
    <span className="fb-chat-audio-body">
      <span className="fb-chat-audio-head">
        <span className="fb-chat-audio-name" title={meta.name}>{meta.name}</span>
        <span className="fb-chat-audio-size">{humanSize(meta.byteSize)}</span>
      </span>
      <span className="fb-chat-audio-track">
        <span className="fb-chat-audio-rail" aria-hidden="true" />
        <span className="fb-chat-audio-buffered" aria-hidden="true" style={{ width: `${loaded}%` }} />
        <span className="fb-chat-audio-played" aria-hidden="true" style={{ width: `${played}%` }} />
        <input type="range" className="fb-chat-audio-seek" min={0} max={duration > 0 ? duration : 0} step={0.1}
          value={duration > 0 ? Math.min(time, duration) : 0}
          onChange={(event) => engine.seek(Number(event.target.value))}
          aria-label={`Seek in ${meta.name}`}
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          disabled={duration <= 0} />
      </span>
      <span className="fb-chat-audio-time" aria-hidden="true">{formatTime(time)} / {formatTime(duration)}</span>
    </span>
    <button type="button" className="fb-chat-audio-save" onClick={() => void save()}
      aria-label={`Download ${meta.name}`}><Download size={16} aria-hidden="true" /></button>
    {error && <p role="status" className="fb-chat-file-error">That file is no longer available.</p>}
    {failed && !error && <p role="status" className="fb-chat-file-error">This audio can&apos;t play here. Download it instead.</p>}
  </div>;
}
