import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "react-aria-components";
import type { Attachment, PostItem } from "@norfold/shared";
import { useFinePointer } from "./inputCapabilities";
import { useMediaUrl } from "../services/media/privateMedia";
import "./ReportPhotoPreview.css";

/**
 * A report photo's hover card (owner direction 2026-11-18).
 *
 * Search results are masonry cards where the photo is small. Resting on one
 * opens the same kind of card a person gets: a larger view of the photo and
 * the few facts that identify the report. It never replaces the tap — the
 * card is not interactive, and the photograph underneath still opens the
 * report. Touch has no hover, so phones keep the direct tap.
 */
const OPEN_MS = 220;
const CLOSE_MS = 140;

export function ReportPhotoPreview({ post, children }: { post: PostItem; children: ReactNode }) {
  const finePointer = useFinePointer();
  const image = post.attachments.find((item) => item.mimeType.startsWith("image/"));
  if (!finePointer || !image) return <>{children}</>;
  return <PreviewLayer post={post} image={image}>{children}</PreviewLayer>;
}

function PreviewLayer({ post, image, children }: { post: PostItem; image: Attachment; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const src = useMediaUrl(image.fileUrl);

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const close = useCallback(() => {
    cancelOpen();
    cancelClose();
    setOpen(false);
  }, [cancelClose, cancelOpen]);

  useEffect(() => () => { cancelOpen(); cancelClose(); }, [cancelOpen, cancelClose]);

  // The card belongs to the row under the pointer, not to a scroll position.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  return (
    <span
      ref={triggerRef}
      className="fb-report-preview-trigger"
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        cancelClose();
        if (open) return;
        cancelOpen();
        openTimer.current = setTimeout(() => { openTimer.current = null; setOpen(true); }, OPEN_MS);
      }}
      onPointerLeave={() => {
        cancelOpen();
        cancelClose();
        closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); }, CLOSE_MS);
      }}
    >
      {children}
      {open && (
        <Popover
          isOpen
          onOpenChange={(next) => { if (!next) close(); }}
          triggerRef={triggerRef}
          isNonModal
          placement="bottom start"
          offset={10}
          className="fb-popover fb-report-preview-panel"
        >
          <div className="fb-report-preview" role="dialog" aria-label={`Preview of ${post.title}`}
            onPointerEnter={cancelClose} onPointerLeave={() => { cancelOpen(); setOpen(false); }}>
            <span className="fb-report-preview-photo">
              <img src={src} alt={`Photo for ${post.title}`} />
            </span>
            <span className="fb-report-preview-body">
              <span className="fb-report-preview-title">{post.title}</span>
              <span className="fb-report-preview-meta">
                <span className="fb-report-preview-type">{post.type === "LOST" ? "Lost" : "Found"}</span>
                <span>{post.category}</span>
                {post.locationLabel && <span className="fb-report-preview-place">{post.locationLabel}</span>}
              </span>
            </span>
          </div>
        </Popover>
      )}
    </span>
  );
}
