import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Info, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useContentWidth, useRootFontPx } from "./responsive";
import { clampPaneWidth, CHAT_DETAILS_PANE, readPanePreference, writePanePreference } from "./panePreference";
import "./chatDetailsLayout.css";

/** Drag distance that still counts as a tap on the divider, in pixels. */
const TAP_SLOP_PX = 3;

/**
 * The conversation's third pane, inside SplitView's detail column.
 *
 * Only layout lives here: the caller renders the same actions in this pane and
 * in its compact task sheet, so nothing is duplicated. The transcript never
 * moves or remounts, and the width/collapse habit is local to this device
 * (`CHAT_DETAILS_PANE`), never account data.
 *
 * Collapsed means gone for assistive tech and for the tab order (`inert` +
 * `aria-hidden`), while the CSS grid still animates the column to zero width.
 */
export function ChatDetailsLayout({ children, details, identity, onCompactOpen }: {
  children: (toggle: ReactNode) => ReactNode;
  details: ReactNode;
  identity?: ReactNode;
  onCompactOpen: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // Measure the actual detail column, after the conversation list/nav rail,
  // rather than promising three usable panes from viewport width alone.
  const width = useContentWidth(container, 0);
  const rootFont = useRootFontPx();
  const wide = width >= Math.max(760, 47.5 * rootFont);
  const [pref, setPref] = useState(() => readPanePreference(CHAT_DETAILS_PANE));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number; moved: boolean; previous: typeof pref } | null>(null);
  const expanded = wide && !pref.collapsed;
  const detailsWidth = wide ? clampPaneWidth(pref.width, CHAT_DETAILS_PANE) : 0;
  const id = useId();
  const focusInDetails = useRef(false);

  useLayoutEffect(() => {
    if (!expanded && focusInDetails.current) {
      toggle.current?.focus({ preventScroll: true });
      focusInDetails.current = false;
    }
  }, [expanded]);

  // Leaving the pane open when the window narrows would reserve zero usable
  // width for the transcript; the compact entry point owns it from then on.
  useLayoutEffect(() => {
    if (!wide && focusInDetails.current) {
      toggle.current?.focus({ preventScroll: true });
      focusInDetails.current = false;
    }
  }, [wide]);

  function persist(next: typeof pref) {
    setPref(next);
    writePanePreference(next, CHAT_DETAILS_PANE);
  }
  function collapse() {
    persist({ ...pref, collapsed: true });
  }
  function expand() {
    persist({ ...pref, collapsed: false });
  }

  const control = <button ref={toggle} type="button" className="fb-chat-icon"
    aria-label={wide ? expanded ? "Hide conversation details" : "Show conversation details" : "Conversation options"}
    aria-expanded={wide ? expanded : undefined} aria-controls={wide ? id : undefined}
    onClick={wide ? (expanded ? collapse : expand) : onCompactOpen}>
    {wide ? expanded ? <PanelRightClose size={21} aria-hidden="true" /> : <PanelRightOpen size={21} aria-hidden="true" /> : <Info size={21} aria-hidden="true" />}
  </button>;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!expanded || event.button !== 0) return;
    event.preventDefault();
    drag.current = { x: event.clientX, width: detailsWidth, moved: false, previous: pref };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    const delta = start.x - event.clientX;
    if (Math.abs(delta) > TAP_SLOP_PX) start.moved = true;
    setPref({ width: clampPaneWidth(start.width + delta, CHAT_DETAILS_PANE), collapsed: false });
  }
  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    drag.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!start.moved) { setPref(start.previous); return; }
    writePanePreference(pref, CHAT_DETAILS_PANE);
  }
  function onDividerKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); collapse(); return; }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      persist({ width: clampPaneWidth(event.key === "Home" ? CHAT_DETAILS_PANE.minWidth : CHAT_DETAILS_PANE.maxWidth, CHAT_DETAILS_PANE), collapsed: false });
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 16;
    persist({ width: clampPaneWidth(detailsWidth + (event.key === "ArrowLeft" ? step : -step), CHAT_DETAILS_PANE), collapsed: false });
  }

  const style = { "--fb-details-w": `${expanded ? detailsWidth : 0}px` } as CSSProperties;

  return <div ref={container} style={style}
    className={`fb-chat-workspace${expanded ? " fb-chat-workspace-details" : ""}${dragging ? " fb-chat-workspace-dragging" : ""}`}>
    {children(control)}
    <aside ref={sidebar} id={id} className="fb-chat-details" aria-label="Conversation info"
      aria-hidden={expanded ? undefined : true} inert={!expanded}
      onFocusCapture={() => { focusInDetails.current = true; }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) focusInDetails.current = false; }}
      onKeyDown={event => {
        // React portal events can bubble from a nested dialog whose DOM is not
        // in this pane. Escape there belongs to that dialog, not the sidebar.
        if (event.key === "Escape" && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) {
          event.preventDefault(); collapse(); toggle.current?.focus({ preventScroll: true });
        }
      }}>
      <header className="fb-chat-details-heading"><h2>Conversation info</h2></header>
      {identity && <div className="fb-chat-details-person">{identity}</div>}
      {details}
    </aside>
    {wide && <div role="separator" aria-orientation="vertical" aria-label="Resize conversation details"
      aria-valuenow={detailsWidth} aria-valuemin={CHAT_DETAILS_PANE.minWidth} aria-valuemax={CHAT_DETAILS_PANE.maxWidth}
      aria-valuetext={`${detailsWidth} pixels`} aria-hidden={expanded ? undefined : true}
      tabIndex={expanded ? 0 : -1} className="fb-chat-details-resize"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onDividerKey} />}
  </div>;
}
