import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "react-aria/FocusScope";
import { AnimatePresence, motion } from "framer-motion";
import { extractYouTubeId } from "@norfold/shared";
import { ExternalLink, Maximize2, PlayCircle, X } from "lucide-react";
import { useHoverLabel } from "./HoverLabel";
import { motionDurations, motionEasings } from "./uiMotion";

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
 * Lite-embed pattern: a poster placeholder holds the 16:9 area and the iframe
 * only mounts once playback is requested, crossfading in. The iframe never
 * animates continuously, a YouTube player and transforms don't mix.
 *
 * The expand control opens the same embed in a temporary overlay at a much
 * larger size. That is the pop-out path a phone needs: the report keeps its
 * compact inline player, and watching properly is one deliberate press away.
 */
export function YouTubeEmbed({ url }: { url: string }) {
  const videoId = extractYouTubeId(url);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const { hoverLabel } = useHoverLabel();

  // A different video (or a cleared field) returns to the poster state.
  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    setExpanded(false);
  }, [videoId]);

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
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  if (failed) {
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

  return (
    <div className="overflow-hidden rounded-m3-md border border-outline-variant">
      <div className="relative aspect-video w-full bg-black">
        <AnimatePresence initial={false}>
          {/* The overlay owns playback while it is open. Keeping the inline
              iframe mounted would stream the same video twice: YouTube has no
              cross-frame pause, so both players keep audio running. It unmounts
              instead and comes back from the poster when the overlay closes. */}
          {playing && !expanded && (
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
          )}
          {!playing && (
            <motion.button
              key="poster"
              type="button"
              className="absolute inset-0 flex w-full flex-col items-center justify-center gap-2 bg-black text-white"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={posterTransition}
              onClick={() => setPlaying(true)}
              aria-label="Play video"
              data-testid="youtube-poster"
            >
              <PlayCircle size={48} aria-hidden />
              <span className="text-xs">Play video</span>
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
      {createPortal(
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
      )}
    </div>
  );
}
