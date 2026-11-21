import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, DialogTrigger } from "react-aria-components";
import { LayeredPopover } from "./overlayFoundation";
import { useHoverLabel } from "./HoverLabel";
import { Notifications } from "../screens/Notifications";
import { ReportSheet } from "./ReportSheet";

const PANEL_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A quick inbox presentation, not a second data cache or mutation owner.
 *
 * The bell is a disclosure: a second press closes the inbox it opened (owner
 * seq 17460). Two things follow from that and both are load-bearing:
 *
 * - The surface is non-modal. A modal React Aria popover makes its trigger
 *   inert while open, which is exactly the press the reader needs to close it,
 *   so this one owns its outside-press dismissal instead.
 * - The panel is a plain `role="dialog"` region, not React Aria's `Dialog`:
 *   that Dialog focuses itself and turns its overlay into a focus trap, which
 *   would take the bell away from the keyboard again. The panel is portalled,
 *   so Tab order is stitched back below instead.
 */
export function NotificationPopover({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const { hoverLabel } = useHoverLabel();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const changeOpen = (next: boolean) => {
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    // A non-modal popover does not dismiss itself. One press outside the panel
    // and its bell closes it; a press inside the bell belongs to the toggle,
    // and a press inside a sheet drawn over the inbox belongs to that sheet.
    const dismissOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (triggerRef.current?.contains(target)) return;
      if (target.closest(".fb-notification-popover, .fb-modal-backdrop")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", dismissOnOutsidePress, true);
  }, [open]);

  useEffect(() => {
    if (!open || reportId !== null) return;
    // The panel portals to the body, so Tab would otherwise step over it and
    // walk the rest of the page. The two edges of the disclosure meet: Tab on
    // the bell enters the inbox, Shift+Tab on its first control returns to it.
    const keepDisclosureInOrder = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const first = panelRef.current?.querySelector<HTMLElement>(PANEL_FOCUSABLE);
      if (!first) return;
      if (!event.shiftKey && document.activeElement === triggerRef.current) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", keepDisclosureInOrder);
    return () => document.removeEventListener("keydown", keepDisclosureInOrder);
  }, [open, reportId]);

  // 440px is the whole panel: ~94px header and filters, a 44px "See all"
  // footer, and ~300px of scrolling activity (3-4 rows). The quick inbox is a
  // preview, not a second route, so it must not claim the window.
  return <><DialogTrigger isOpen={open} onOpenChange={changeOpen}>
    <Button ref={triggerRef} aria-label="Notifications" className="fb-icon-control relative" {...hoverLabel("Notifications")}>{trigger}</Button>
    <LayeredPopover isNonModal placement="bottom end" offset={6} maxHeight={440} className="fb-notification-popover">
      <section ref={panelRef} role="dialog" aria-label="Notifications" className="fb-notification-dialog">
        <Notifications preview onNavigate={() => changeOpen(false)} onReport={setReportId} />
      </section>
    </LayeredPopover>
  </DialogTrigger>
  <ReportSheet open={reportId !== null} target={reportId ? { targetType: "POST", targetId: reportId } : null}
    onClose={() => setReportId(null)} returnFocusRef={triggerRef} />
  </>;
}
