import { useEffect, useId, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { copyReportLink, shareReport } from "../utils/shareReport";
import { announce } from "./LiveRegion";
import { AdaptiveTaskSurface } from "./AdaptiveTaskSurface";
import { useHoverLabel } from "./HoverLabel";

/**
 * The one share control: copies the canonical link and opens the platform's
 * own share sheet in the same tap. No intermediate Share/Copy menu.
 *
 * HONESTY: a capability that is missing is never dressed up as success. The
 * share path reports what actually happened (shared / dismissed / copied) and
 * the copy path falls back to a selectable field when the platform exposes no
 * working clipboard — it never claims a copy it did not make.
 */
export function ReportShareButton({ postId, title }: { postId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const fieldId = useId();
  const { hoverLabel } = useHoverLabel();

  // Lifetime: an async share/copy may finish after this control has been
  // reused for another report or removed from the screen. Neither the
  // previous report's manual link nor its announcement may leak into the
  // current one. The epoch moves on both identity replacement and unmount.
  const epoch = useRef(0);
  const identity = useRef(postId);
  const mounted = useRef(true);
  if (identity.current !== postId) {
    identity.current = postId;
    epoch.current += 1;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);

  useEffect(() => {
    setBusy(false);
    setError(null);
    setManualLink(null);
  }, [postId]);

  async function onShare() {
    if (busy) return;
    const startedAt = epoch.current;
    const reportId = postId;
    const live = () => mounted.current && identity.current === reportId && epoch.current === startedAt;
    setBusy(true);
    setError(null);
    try {
      const message = await shareReport(reportId, title);
      if (!live()) return;
      announce(message);
    } catch {
      if (!live()) return;
      // Neither the sheet nor the clipboard worked. Build the link and let the
      // reader copy it by hand instead of pretending the tap did something.
      try {
        const result = await copyReportLink(reportId);
        if (!live()) return;
        if (result.status === "manual") {
          setManualLink(result.url);
          announce("Sharing isn't available here. The link is ready to copy.");
        } else {
          announce("Link copied to clipboard.");
        }
      } catch {
        if (!live()) return;
        const message = "Couldn't build the link for this report.";
        setError(message);
        announce(message);
      }
    } finally {
      if (live()) setBusy(false);
    }
  }

  return (
    <div className="fb-post-action-share relative" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => void onShare()}
        disabled={busy}
        aria-busy={busy}
        aria-label="Share report"
        data-action="share"
        className="fb-report-action"
        {...hoverLabel("Share")}
      >
        <Share2 size={24} aria-hidden />
        <span>Share</span>
      </button>
      {error && (
        <p
          role="alert"
          className="absolute bottom-full right-0 z-10 mb-1 w-max max-w-56 rounded-m3-sm border border-error bg-surface px-2 py-1 text-xs text-error shadow-sm"
        >
          {error}
        </p>
      )}
      {manualLink && (
        <AdaptiveTaskSurface open onClose={() => setManualLink(null)} title="Copy link" width="compact">
          <div className="mt-1 flex min-w-0 flex-col gap-1">
            <label htmlFor={fieldId} className="text-xs text-on-surface-variant">
              Report link
            </label>
            <input
              id={fieldId}
              readOnly
              value={manualLink}
              onFocus={(event) => {
                try { event.currentTarget.select(); }
                catch { announce("Automatic selection isn't available. Press and hold the link to select it."); }
              }}
              className="min-h-[44px] w-full min-w-0 rounded-m3-sm border border-outline-variant bg-surface px-2 text-sm text-on-surface"
            />
            <p className="text-xs text-on-surface-variant">Select the link to copy it.</p>
          </div>
        </AdaptiveTaskSurface>
      )}
    </div>
  );
}
