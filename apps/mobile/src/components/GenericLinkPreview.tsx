import { useEffect, useRef, useState } from "react";
import {
  fetchLinkPreview,
  isAllowedPreviewImage,
  normalizePreviewUrl,
  type LinkPreview,
} from "../services/linkPreview";
import "./GenericLinkPreview.css";

/**
 * One automatic generic-site preview for one already-safe chat link.
 *
 * The anchor is always present and always navigates to the normalized
 * destination, so the parent can omit the duplicate inline URL while metadata is
 * pending or unavailable. The request starts only when the card is near the
 * viewport and the document is visible; a hidden or very long transcript does
 * not eagerly contact the service for every link it contains.
 *
 * An address this module cannot preview (HTTP, credentials, an internal host)
 * renders nothing here at all: the parent keeps its own safe anchor as the only
 * representation. A link whose metadata failed keeps that same single anchor
 * with the destination host as its title; there is no status line and no retry
 * control under a failed link.
 *
 * Invariant for the parent: whenever `isPreviewableLink(href)` is true this
 * component renders exactly one anchor, so hiding the inline URL for that
 * segment is always safe.
 */

type PreviewState =
  | { kind: "loading"; url: string }
  | { kind: "ready"; url: string; preview: LinkPreview }
  | { kind: "unavailable"; url: string };

/** Start slightly before the card is on screen so the row rarely reflows. */
const VISIBILITY_MARGIN = "100px";

function hostnameOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function GenericLinkPreview({ href }: { href: string }) {
  const requestUrl = normalizePreviewUrl(href);
  const host = requestUrl ? hostnameOf(requestUrl) : "";
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const requestId = useRef(0);
  const [state, setState] = useState<PreviewState | null>(null);
  const [brokenImage, setBrokenImage] = useState<string | null>(null);

  useEffect(() => {
    const element = anchorRef.current;
    if (!element || !requestUrl) return;
    let disposed = false;
    let started = false;
    let nearby = false;
    const controller = new AbortController();
    const id = ++requestId.current;

    const begin = () => {
      if (disposed || started || !nearby) return;
      if (document.visibilityState === "hidden") return;
      started = true;
      setState((previous) => (
        previous && previous.url === requestUrl && previous.kind === "ready"
          ? previous
          : { kind: "loading", url: requestUrl }
      ));
      void fetchLinkPreview(requestUrl, { signal: controller.signal }).then((preview) => {
        if (disposed || requestId.current !== id) return;
        setState(preview
          ? { kind: "ready", url: requestUrl, preview }
          : { kind: "unavailable", url: requestUrl });
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") begin();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let disconnect: (() => void) | null = null;
    if (typeof IntersectionObserver === "undefined") {
      // Older WebView and jsdom: one ordinary request once this effect runs.
      nearby = true;
      begin();
    } else {
      const observer = new IntersectionObserver((entries) => {
        nearby = entries.some((entry) => entry.isIntersecting);
        if (nearby) begin();
      }, { rootMargin: VISIBILITY_MARGIN });
      observer.observe(element);
      disconnect = () => observer.disconnect();
    }

    return () => {
      disposed = true;
      disconnect?.();
      document.removeEventListener("visibilitychange", onVisibility);
      controller.abort();
      requestId.current += 1;
    };
  }, [requestUrl]);

  // Not previewable: the parent's own safe anchor is the only representation,
  // so this component contributes no wrapper and no duplicate link.
  if (!requestUrl) return null;

  const current = state?.url === requestUrl ? state : null;
  const preview = current?.kind === "ready" ? current.preview : null;
  // Silent in-flight state: it only sets `aria-busy`; nothing extra is painted.
  const loading = current?.kind === "loading";
  const imageSrc = preview && preview.imageDataUrl !== brokenImage
    && isAllowedPreviewImage(preview.imageDataUrl)
    ? preview.imageDataUrl
    : null;
  const title = preview?.title ?? host;
  const domain = preview && preview.title.toLowerCase() !== host.toLowerCase() ? host : null;

  return (
    <div className="fb-linkp">
      <a
        ref={anchorRef}
        className="fb-linkp-link"
        href={requestUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-busy={loading}
      >
        {imageSrc ? (
          <img
            className="fb-linkp-thumb"
            src={imageSrc}
            alt=""
            width={76}
            height={76}
            loading="lazy"
            decoding="async"
            onError={() => setBrokenImage(imageSrc)}
          />
        ) : <span className="fb-linkp-thumb" aria-hidden="true" />}
        <span className="fb-linkp-text" dir="auto">
          <span className="fb-linkp-title">{title}</span>
          {preview?.description ? <span className="fb-linkp-description">{preview.description}</span> : null}
          {domain ? <span className="fb-linkp-domain">{domain}</span> : null}
        </span>
      </a>
    </div>
  );
}
