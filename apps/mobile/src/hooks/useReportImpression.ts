import { useEffect, useRef } from "react";
import { recordReportView } from "../services/reportViews";

/**
 * A report counts as seen when at least half of its card is on screen.
 *
 * Owner direction 2026-11-18: the view count follows visibility, not only the
 * detail page. `findback_record_report_view` inserts at most one row per
 * reader, report and day, so the feed, search results, profile lists and the
 * detail page can all record without double counting.
 *
 * There is deliberately no dwell timer: "visible" is the condition the owner
 * stated, and the server deduplication makes a fast scroll harmless. Without
 * `IntersectionObserver` the hook records nothing rather than guessing that an
 * off-screen card was seen.
 */
export function useReportImpression(reportId: string | undefined) {
  const node = useRef<HTMLDivElement | null>(null);
  const counted = useRef<string | null>(null);

  useEffect(() => {
    const element = node.current;
    if (!element || !reportId) return;
    if (counted.current === reportId) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (counted.current === reportId) return;
      if (!entries.some((entry) => entry.isIntersecting)) return;
      counted.current = reportId;
      observer.disconnect();
      void recordReportView(reportId);
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reportId]);

  return node;
}
