import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "react-aria/FocusScope";
import { AnimatePresence, motion } from "framer-motion";
import { extractYouTubeId } from "@norfold/shared";
import { ExternalLink, Maximize2, PlayCircle, X } from "lucide-react";
import { useHoverLabel } from "./HoverLabel";
import { motionDurations, motionEasings } from "./uiMotion";
import "./YouTubeEmbed.css";

/** Poster fades out as the player fades in, inside the reserved aspect-video box. */
const posterTransition = {
  type: "tween",
  duration: motionDurations.standard,
  ease: motionEasings.out,
} as const;

const playerTransition = {
  type: "tween",
  duration: motionDurations.standard,
  ease: motionEasings.inOut,
} as const;

/**
 * Fixed metadata endpoint. The query is rebuilt from the validated id, so a
 * pasted tracking query or fragment is never forwarded to YouTube.
 */
const OEMBED_ENDPOINT = "https://www.youtube.com/oembed";
const TITLE_TIMEOUT_MS = 5_000;
const TITLE_MAX_LENGTH = 200;
const TITLE_CACHE_LIMIT = 50;

/**
 * Successful provider titles only, keyed by the validated id. A failed lookup
 * is not cached, so the next mount may retry; the map is bounded because chat
 * threads can mention many videos.
 */
const titleCache = new Map<string, string>();

function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * The poster is addressed from the validated id on YouTube's image CDN. mq is
 * the 16:9 frame the card reserves; hq is the 4:3 fallback, cropped back to the
 * same frame by `object-fit: cover`. No provider-supplied thumbnail URL is used.
 */
function posterSource(videoId: string, stage: "mq" | "hq") {
  return stage === "mq"
    ? { src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, width: 320, height: 180 }
    : { src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 };
}

/** Provider title accepted only as a bounded plain string, never as markup. */
function realTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 0 && title.length <= TITLE_MAX_LENGTH ? title : null;
}

function rememberTitle(videoId: string, title: string): void {
  if (titleCache.size >= TITLE_CACHE_LIMIT) {
    const oldest = titleCache.keys().next();
    if (oldest.done === false) titleCache.delete(oldest.value);
  }
  titleCache.set(videoId, title);
}

async function fetchYouTubeTitle(videoId: string, signal: AbortSignal): Promise<string | null> {
  const cached = titleCache.get(videoId);
  if (cached) return cached;
  try {
    const query = new URLSearchParams({ url: canonicalWatchUrl(videoId), format: "json" });
    const response = await fetch(`${OEMBED_ENDPOINT}?${query.toString()}`, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const title = realTitle((payload as { title?: unknown }).title);
    if (title) rememberTitle(videoId, title);
    return title;
  } catch {
    // CORS, offline and aborts are all "no title": playback must not depend on
    // this request, and the card states an honest fallback instead.
    return null;
  }
}

/**
 * One iframe factory. The source is always built from the validated 11-char
 * id and the fixed embed origin: a raw pasted URL never reaches `src`.
 */
function EmbedFrame({ videoId, title }: { videoId: string; title: string }) {
  return (
    <iframe
      className="h-full w-full"
      src={`https://www.youtube.com/embed/${videoId}`}
      title={title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

/**
 * Lite-embed pattern: a real poster holds the 16:9 area and the iframe only
 * mounts once playback is requested, crossfading in. The iframe never animates
 * continuously, a YouTube player and transforms don't mix.
 *
 * `compact` is the chat bubble variant: one 320px card with the provider
 * thumbnail, title and domain, no duplicated watch footer and a small expand
 * control. Without it the component keeps the post/editor layout.
 *
 * The expand control opens the same embed in a temporary overlay at a much
 * larger size. That is the pop-out path a phone needs: the report keeps its
 * compact inline player, and watching properly is one deliberate press away.
 */
export function YouTubeEmbed({ url, compact = false }: { url: string; compact?: boolean }) {
  const videoId = extractYouTubeId(url);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [poster, setPoster] = useState<{ id: string; stage: "mq" | "hq" | "failed" } | null>(null);
  const [meta, setMeta] = useState<{ id: string; title: string } | null>(null);
  const requestRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const { hoverLabel } = useHoverLabel();

  // A different video (or a cleared field) returns to the poster state.
  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    setExpanded(false);
  }, [videoId]);

  // A compact card names the video when the provider answers. The generation
  // fence means a late or wrong-id response can never repaint the next video.
  useEffect(() => {
    if (!compact || !videoId) return;
    const request = ++requestRef.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
    let alive = true;
    void fetchYouTubeTitle(videoId, controller.signal).then((title) => {
      clearTimeout(timeout);
      if (!alive || !title || requestRef.current !== request) return;
      setMeta({ id: videoId, title });
    });
    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [compact, videoId]);

  // Overlay owns Escape, scroll lock and focus; the trigger gets focus back.
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreRef.current = previous;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [expanded]);

  if (!videoId) return null;
  const watchUrl = canonicalWatchUrl(videoId);
  const posterStage = poster !== null && poster.id === videoId ? poster.stage : "mq";
  const thumbnail = posterStage === "failed" ? null : posterSource(videoId, posterStage);
  const metaTitle = meta !== null && meta.id === videoId ? meta.title : null;
  const title = metaTitle ?? "YouTube video";

  const handlePosterError = () => {
    setPoster({ id: videoId, stage: posterStage === "mq" ? "hq" : "failed" });
  };

  const player = playing && !expanded ? (
    <motion.div
      key="player"
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={playerTransition}
      data-testid="youtube-player"
    >
      <EmbedFrame videoId={videoId} title="Embedded YouTube video" />
    </motion.div>
  ) : null;

  const overlay = createPortal(
    <AnimatePresence>
      {expanded && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={playerTransition}
          role="dialog"
          aria-modal="true"
          aria-label="Video player"
          data-testid="youtube-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setExpanded(false);
          }}
        >
          <FocusScope contain restoreFocus autoFocus>
            <div className="w-full max-w-[1100px]">
              <div className="mb-2 flex items-center justify-end">
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close video"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  {...hoverLabel("Close video")}
                >
                  <X size={22} aria-hidden />
                </button>
              </div>
              <div className="aspect-video w-full overflow-hidden rounded-m3-md bg-black">
                <EmbedFrame videoId={videoId} title="Embedded YouTube video" />
              </div>
              <a
                href={watchUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs text-white/80 hover:text-white"
              >
                <ExternalLink size={14} aria-hidden />
                Watch on YouTube
              </a>
            </div>
          </FocusScope>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  if (failed) {
    if (compact) {
      return (
        <div className="fb-yt-preview fb-yt-blocked">
          <span>Playback is blocked here.</span>
          <a className="fb-yt-domain" href={watchUrl} target="_blank" rel="noopener noreferrer">
            YouTube
          </a>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-2 rounded-m3-md border border-outline-variant p-4 text-sm text-on-surface-variant">
        <span>Embedded playback is blocked here.</span>
        <a
          href={watchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-on-surface"
        >
          <ExternalLink size={16} aria-hidden /> Open on YouTube
        </a>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="fb-yt-preview">
        <div className="fb-yt-media">
          <AnimatePresence initial={false}>
            {player}
            {!playing && (
              <motion.button
                key="poster"
                type="button"
                className="fb-yt-poster"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={posterTransition}
                onClick={() => setPlaying(true)}
                aria-label="Play video"
                data-testid="youtube-poster"
              >
                {thumbnail ? (
                  <img
                    className="fb-yt-thumb"
                    src={thumbnail.src}
                    alt=""
                    width={thumbnail.width}
                    height={thumbnail.height}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={handlePosterError}
                  />
                ) : (
                  <span className="fb-yt-fallback">Preview unavailable</span>
                )}
                {thumbnail ? <span className="fb-yt-scrim" aria-hidden /> : null}
                <span className="fb-yt-play" aria-hidden>
                  <PlayCircle size={28} />
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <div className="fb-yt-meta">
          <span className="fb-yt-text">
            <span className="fb-yt-title">{title}</span>
            <a className="fb-yt-domain" href={watchUrl} target="_blank" rel="noopener noreferrer">
              YouTube
            </a>
          </span>
          <button
            type="button"
            onClick={() => {
              restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setExpanded(true);
            }}
            aria-label="Watch larger"
            className="fb-yt-expand"
            {...hoverLabel("Watch larger")}
          >
            <Maximize2 size={18} aria-hidden />
          </button>
        </div>
        {overlay}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-m3-md border border-outline-variant">
      <div className="relative aspect-video w-full bg-black">
        <AnimatePresence initial={false}>
          {/* The overlay owns playback while it is open. Keeping the inline
              iframe mounted would stream the same video twice: YouTube has no
              cross-frame pause, so both players keep audio running. It unmounts
              instead and comes back from the poster when the overlay closes. */}
          {player}
          {!playing && (
            <motion.button
              key="poster"
              type="button"
              className="absolute inset-0 flex w-full flex-col items-center justify-center gap-2 overflow-hidden bg-black text-white"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={posterTransition}
              onClick={() => setPlaying(true)}
              aria-label="Play video"
              data-testid="youtube-poster"
            >
              {thumbnail ? (
                <img
                  className="absolute inset-0 h-full w-full object-cover"
                  src={thumbnail.src}
                  alt=""
                  width={thumbnail.width}
                  height={thumbnail.height}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={handlePosterError}
                />
              ) : null}
              <span className="absolute inset-0 bg-black/60" aria-hidden />
              <span className="relative z-10 flex flex-col items-center gap-2">
                <PlayCircle size={48} aria-hidden />
                <span className="text-xs">Play video</span>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <a
          href={watchUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center gap-2 text-xs text-on-surface-variant"
        >
          <PlayCircle size={14} aria-hidden />
          Watch on YouTube
        </a>
        <button
          type="button"
          onClick={() => {
            restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setExpanded(true);
          }}
          aria-label="Watch larger"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          {...hoverLabel("Watch larger")}
        >
          <Maximize2 size={18} aria-hidden />
        </button>
      </div>
      {overlay}
    </div>
  );
}
