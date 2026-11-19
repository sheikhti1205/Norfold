import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  Archive, Download, File as FileIcon, FileText, Film, Images, LoaderCircle, Music, Pause, Play,
} from "lucide-react";
import { downloadChatFile, type ChatFileMeta } from "../services/messaging/files";
import { probeDimensions, readExifOrientation, sniffImage } from "../services/media/importImage";
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

/** Sniffed raster formats the private viewer may render. SVG/HTML never join. */
const INLINE_RASTER_MIME: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const INLINE_RASTER_MAX_EDGE = 8192;

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
  if (INLINE_RASTER_MIME.has(meta.mime)) return <ChatImageFile meta={meta} />;
  return <ChatDocument meta={meta} />;
}

/**
 * A GIF/WebP/APNG/JPEG travelled here through the private file lane. The bytes
 * stay untouched until an explicit press fetches them; the preview is only
 * mounted for a sniffed, allowlisted raster, and its one object URL is reused
 * for a download and revoked on hide or unmount. Animation is the content the
 * sender chose: there is no fake pause control. A file that sniffs as some
 * other format is not called missing: the row says the preview is unsupported
 * and still offers the download.
 */
function ChatImageFile({ meta }: { meta: ChatFileMeta }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unsupported" | "missing">("idle");
  const [view, setView] = useState<{ url: string; width: number; height: number } | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  // One URL per mounted row: created on the first explicit press, shared by
  // View and Download, and revoked by hide() or unmount so nothing leaks.
  const cacheRef = useRef<{ blob: Blob; url: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    // StrictMode runs setup → cleanup → setup on the same instance, so the
    // setup must re-arm the liveness flag the cleanup clears; otherwise a
    // later press would drop its fetched preview.
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
      release();
    };
  }, []);

  function release() {
    const cache = cacheRef.current;
    cacheRef.current = null;
    if (cache) URL.revokeObjectURL(cache.url);
  }

  function hide() {
    generation.current += 1;
    release();
    setView(null);
    setState("idle");
  }

  async function ensureCache(): Promise<{ blob: Blob; url: string } | null> {
    if (cacheRef.current) return cacheRef.current;
    const attempt = ++generation.current;
    setState("loading");
    try {
      const blob = await downloadChatFile(meta.key);
      if (!alive.current || attempt !== generation.current) return null;
      const cache = { blob, url: URL.createObjectURL(blob) };
      cacheRef.current = cache;
      return cache;
    } catch {
      if (alive.current && attempt === generation.current) setState("missing");
      return null;
    }
  }

  async function preview() {
    if (busy.current) return;
    if (view) { hide(); return; }
    busy.current = true;
    try {
      const cache = await ensureCache();
      if (!cache) return;
      const bytes = new Uint8Array(await cache.blob.arrayBuffer());
      if (!alive.current) return;
      const kind = sniffImage(bytes);
      const base = kind?.replace("-animated", "");
      if (!kind || !base || !["jpeg", "png", "gif", "webp"].includes(base)) throw new Error("unsupported");
      const dimensions = probeDimensions(bytes, kind);
      if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0
        || dimensions.width > INLINE_RASTER_MAX_EDGE || dimensions.height > INLINE_RASTER_MAX_EDGE) {
        throw new Error("unsupported");
      }
      // A JPEG stores its SOF width and height unrotated while the browser
      // paints it by EXIF orientation, so an unadjusted frame would disagree
      // with the picture. Swap the display geometry for the quarter turns,
      // exactly as the import path does. The stored bytes stay untouched.
      const orientation = kind === "jpeg" ? readExifOrientation(bytes) : 1;
      const width = orientation >= 5 ? dimensions.height : dimensions.width;
      const height = orientation >= 5 ? dimensions.width : dimensions.height;
      setView({ url: cache.url, width, height });
      setState("ready");
    } catch {
      if (alive.current) setState("unsupported");
    } finally {
      busy.current = false;
    }
  }

  async function download() {
    if (busy.current) return;
    busy.current = true;
    try {
      const cache = await ensureCache();
      if (!cache || !alive.current) return;
      triggerDownload(cache.url, meta.name);
      setState((current) => (current === "loading" ? "idle" : current));
    } finally {
      busy.current = false;
    }
  }

  // The card keeps the shared media width for its row; the frame takes the
  // picture's own shape, so a tall portrait centres instead of widening the
  // row or leaving an enlarged empty box.
  return (
    <div className="fb-chat-image" data-kind="image"
      style={view === null ? undefined : { "--fb-chat-image-ratio": String(view.width / view.height) } as CSSProperties}>
      <div className="fb-chat-file">
        <span className="fb-chat-file-icon"><Images size={22} aria-hidden="true" /></span>
        <span className="fb-chat-file-copy">
          <span className="fb-chat-file-name" title={meta.name}>{meta.name}</span>
          <span className="fb-chat-file-size">{humanSize(meta.byteSize)}</span>
        </span>
        <span className="fb-chat-image-actions">
          <button type="button" className="fb-chat-file-action" onClick={() => void preview()}
            aria-label={view ? `Hide ${meta.name}` : `View ${meta.name}`} disabled={state === "loading"}>
            {state === "loading" ? <LoaderCircle className="fb-chat-video-spin" size={16} aria-hidden="true" />
              : view ? "Hide" : "View"}
          </button>
          <button type="button" className="fb-chat-image-download" onClick={() => void download()}
            aria-label={`Download ${meta.name}`} disabled={state === "loading"}>
            <Download size={18} aria-hidden="true" />
          </button>
        </span>
      </div>
      {view && (
        <div className="fb-chat-image-frame">
          <img src={view.url} alt={meta.name} />
        </div>
      )}
      {state === "unsupported" && (
        <p role="status" className="fb-chat-file-error">This image can&apos;t be previewed here. Download it instead.</p>
      )}
      {state === "missing" && <p role="status" className="fb-chat-file-error">That file is no longer available.</p>}
    </div>
  );
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
 * A sent video stays a compact, honest file row until the reader presses play:
 * the film mark below is a kind label, never a fabricated poster, and mounting
 * the row fetches nothing. Once fetched, the blob URL belongs to the global
 * player until it is closed. The message frame reserves the shared chat media
 * width only while that player is actually here, and follows the source's own
 * measured ratio, so the real video paints at a useful size instead of an
 * empty enlarged box.
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
  // Until this source's own metadata arrives the familiar 16:9 frame stands
  // in; a measured ratio only applies while the player is painted here.
  const measured = inlineHere && player.aspect && Number.isFinite(player.aspect) && player.aspect > 0
    ? player.aspect
    : 16 / 9;

  // Latest API without re-running effects on every playback tick.
  const apiRef = useRef(player);
  apiRef.current = player;

  // StrictMode runs setup → cleanup → setup on this instance: the cleanup
  // clears liveness, so setup must re-arm it or a resumed download is dropped.
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Leaving the transcript docks the player instead of silencing it; the URL
  // stays the player's to revoke.
  useEffect(() => () => {
    const api = apiRef.current;
    if (api.video?.id === id) api.minimize();
  }, [id]);

  // The player closed (or moved to another message): that URL is gone, so the
  // row returns to idle instead of offering a dead source.
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

  return <div className="fb-chat-video" data-kind="video"
    style={inlineHere ? { "--fb-chat-video-ratio": String(measured) } as CSSProperties : undefined}>
    <div className="fb-chat-video-frame" ref={slotRef} data-active={inlineHere ? "true" : undefined}>
      {!inlineHere && <button type="button" className="fb-chat-video-launch" disabled={status === "loading"}
        onClick={() => void start()}
        aria-label={mine ? `Show ${meta.name} in the conversation` : `Play ${meta.name}`}>
        <span className="fb-chat-video-play" aria-hidden="true">
          {status === "loading" ? <LoaderCircle className="fb-chat-video-spin" size={18} />
            : <Play size={18} fill="currentColor" />}
        </span>
        <span className="fb-chat-video-copy">
          <span className="fb-chat-video-name" title={meta.name}>{meta.name}</span>
          <span className="fb-chat-video-size">{humanSize(meta.byteSize)}</span>
        </span>
      </button>}
    </div>
    {inlineHere && <div className="fb-chat-video-meta">
      <Film size={14} aria-hidden="true" />
      <span className="fb-chat-video-name" title={meta.name}>{meta.name}</span>
      <span className="fb-chat-video-size">{humanSize(meta.byteSize)}</span>
    </div>}
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

  useEffect(() => {
    // StrictMode's setup → cleanup → setup must re-arm liveness; otherwise the
    // resumed download is discarded and the row silently never plays.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    };
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
