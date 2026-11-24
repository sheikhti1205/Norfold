import { useEffect, useRef, useState } from "react";
import { ACTION_NEXT, ACTION_PREV, useEvents, useLightboxState } from "yet-another-react-lightbox";
import { ImageOff } from "lucide-react";
import { useShouldReduceMotion } from "./uiMotion";
import type { MediaViewerSlide } from "./MediaViewer";
import "./ViewerFilmstrip.css";

function FilmstripThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return !src || failed ? <ImageOff size={20} aria-hidden="true" />
    : <img src={src} alt="" className="fb-viewer-thumbnail" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/** Every photo in the conversation, in one horizontally scrollable row.
 *
 * The library's Thumbnails plugin renders a three-photo window around the
 * current slide (`preload` is pinned to 1 so the full-size slides are not all
 * fetched) and its stylesheet hides itself on phones, so opening a photo only
 * ever showed its neighbours. The strip lists every previous and next photo
 * and is browsed by scrolling it.
 *
 * The strip owns no index. A tap publishes the engine's own navigation action
 * with the distance to the target, so the lightbox state, the counter and the
 * carousel stay the single owner of which photo is current.
 */
export function ViewerFilmstrip() {
  const { currentIndex, slides: stateSlides } = useLightboxState();
  const slides = stateSlides as readonly MediaViewerSlide[];
  const { publish } = useEvents();
  const reduced = useShouldReduceMotion();
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const button = activeRef.current;
    // jsdom has no scrollIntoView; the guard keeps the mount effect inert there.
    if (!button || typeof button.scrollIntoView !== "function") return;
    button.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" });
  }, [currentIndex, reduced]);

  if (slides.length < 2) return null;

  const jump = (index: number) => {
    if (index === currentIndex) return;
    if (index > currentIndex) publish(ACTION_NEXT, { count: index - currentIndex });
    else publish(ACTION_PREV, { count: currentIndex - index });
  };

  return <div className="fb-viewer-filmstrip" data-viewer-keep
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onPointerMove={(event) => event.stopPropagation()}
    onPointerUp={(event) => event.stopPropagation()}
    onPointerCancel={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}>
    <nav className="fb-viewer-filmstrip-track" aria-label="Thumbnails">
      {slides.map((slide, index) => {
        const active = index === currentIndex;
        return <button key={`${index}|${slide.thumbnail ?? slide.src}`} type="button"
          ref={active ? activeRef : null} className="fb-viewer-filmstrip-thumb"
          aria-label={`${index + 1} of ${slides.length}`} aria-current={active ? "true" : undefined}
          onClick={() => jump(index)}>
          <FilmstripThumb key={slide.thumbnail ?? slide.src} src={slide.thumbnail ?? slide.src} />
        </button>;
      })}
    </nav>
  </div>;
}
