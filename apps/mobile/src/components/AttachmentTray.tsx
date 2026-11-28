import {
  useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import { Plus } from "lucide-react";
import { registerBackInterceptor } from "./backNavigation";
import { useHoverLabel } from "./HoverLabel";
import "./composerDock.css";

/** One attachment shortcut: a capability the surface really has, never a placeholder. */
export interface AttachmentOption {
  id: string;
  /** Accessible name and pointer label, in the product's vocabulary. */
  label: string;
  /** Lucide icon, already `aria-hidden`. */
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface AttachmentTrayProps {
  /** The surface's capability list, in the order it should be read. */
  options: readonly AttachmentOption[];
  /** True while the draft holds text. */
  hasText: boolean;
  /**
   * The draft itself, when the surface owns one. `hasText` alone cannot see an
   * edit that leaves the field non-empty, and the cluster folds on every
   * keystroke, not only on the first. A surface without a draft omits it.
   */
  text?: string;
  /** Optional per-surface extra (a report reference), rendered last. */
  extra?: ReactNode;
  disabled?: boolean;
  /** Accessible name of the disclosure control. */
  label?: string;
  testIdPrefix?: string;
}

/** An expanded inline row needs ~416px: five 40px shortcuts, the field's 72px
 * floor, the picker trigger and Send. Below this the shortcuts cannot sit
 * beside a readable field, so they open as a list instead. */
const INLINE_ROW_REM = 26;

/** The composer surfaces the tray is mounted in. */
const COMPOSER_SELECTOR = ".fb-composer-shell, .fb-peer-composer";

/**
 * Messenger's attachment disclosure, shared by comments and chat so the two
 * cannot drift apart.
 *
 * Collapsed: one `+`. Expanded: the shortcuts sit inline beside the field and
 * the field takes the width they leave. Expansion is the reader's own state,
 * never a focus state: it survives the caret leaving, and a keystroke is the
 * only edit that folds it (Escape and Android Back fold it on request). Any
 * draft text forces the single control back, and emptying the field restores
 * the choice that was folded away.
 *
 * A press while text is present still opens the shortcuts — otherwise a photo
 * with a caption would be unreachable — and the next keystroke folds them
 * again.
 *
 * A composer too narrow for that inline row (under `26rem`, measured on the
 * composer the tray is mounted in, never the window) presents the same
 * capabilities as a labelled floating list anchored to the `+`, so every
 * option is visible with its name instead of hidden behind a horizontal
 * scroll. The list is transient: a choice, Escape or Back, or a press outside
 * closes it, and it is never restored by an emptying field. When no width can
 * be measured at all, the inline strip is the only row rendered, exactly as
 * before.
 */
export function AttachmentTray({
  options, hasText, text, extra, disabled = false, label = "Add attachment",
  testIdPrefix = "attachment-tray",
}: AttachmentTrayProps) {
  const [expanded, setExpanded] = useState(false);
  // True while the composer cannot hold the inline row.
  const [narrow, setNarrow] = useState(false);
  // The reader's last deliberate choice, kept across the folds a draft causes.
  const wantsOpen = useRef(false);
  const disclosure = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLDivElement | null>(null);
  // The composer surface this tray sits in, once the DOM has it. Its identity
  // is the measuring effect's dependency, so a tray mounted in another
  // composer re-observes instead of reporting the row it used to occupy.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const listId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-shortcuts`;
  const { hoverLabel } = useHoverLabel();

  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    tray.current = node;
    setHost(node?.closest<HTMLElement>(COMPOSER_SELECTOR) ?? null);
  }, []);

  // The decision follows the composer, not the viewport: the same conversation
  // composer is ~272px inside a 1400px window. No measurement — no composer
  // ancestor, no ResizeObserver, a 0 or non-finite width — leaves `narrow`
  // false, which is the inline strip every existing test already asserts.
  useEffect(() => {
    if (!host || typeof ResizeObserver !== "function") {
      setNarrow(false);
      return;
    }
    const apply = (width: number) => {
      if (!Number.isFinite(width) || width <= 0) {
        setNarrow(false);
        return;
      }
      const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(width < INLINE_ROW_REM * rootFont);
    };
    // Layout may already be there when the tray mounts (the observer fires
    // after layout in a browser, but this is the value for that first commit).
    apply(host.getBoundingClientRect().width || host.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries?.[0];
      if (entry) apply(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  // Every edit folds the row; an empty field restores the choice. Depending on
  // `text` (not only `hasText`) is what makes the fold happen on the first
  // keystroke of a draft that was already non-empty. The narrow list is a menu,
  // not a sticky cluster: an edit closes it and an emptying field does not
  // reopen it, so nothing is left open behind a send either.
  useEffect(() => {
    if (narrow) {
      wantsOpen.current = false;
      setExpanded(false);
      return;
    }
    setExpanded(hasText ? false : wantsOpen.current);
  }, [hasText, text, narrow]);

  function toggle() {
    if (disabled) return;
    const next = !expanded;
    wantsOpen.current = next;
    setExpanded(next);
  }

  function closeMenu() {
    wantsOpen.current = false;
    setExpanded(false);
  }

  // Android Back folds the shortcuts exactly as the sheet this replaced did:
  // one press, consumed, so the conversation underneath neither leaves nor
  // shows its leave guard for a row that was only open. Registered for exactly
  // the expanded lifetime, so a folded tray owns no press at all.
  useEffect(() => {
    if (!expanded) return;
    return registerBackInterceptor(() => {
      wantsOpen.current = false;
      setExpanded(false);
      disclosure.current?.focus();
      return true;
    });
  }, [expanded]);

  // The narrow list is a real overlay: Escape must close it wherever focus is,
  // and must be consumed before a surface underneath reads the same key as
  // "leave". The inline row keeps its own handler on the tray instead, so the
  // wide behaviour is untouched.
  useEffect(() => {
    if (!narrow || !expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      disclosure.current?.focus();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [narrow, expanded]);

  // A popup list, unlike the inline strip, is dismissed by a press outside
  // itself. The tray owns both the disclosure and the list, so a press on
  // either is not outside.
  useEffect(() => {
    if (!narrow || !expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && tray.current?.contains(target)) return;
      closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [narrow, expanded]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !expanded) return;
    // A visible shortcut row owns this press: folding it must not also close a
    // sheet or leave the surface underneath.
    event.preventDefault();
    event.stopPropagation();
    wantsOpen.current = false;
    setExpanded(false);
    disclosure.current?.focus();
  }

  return (
    <div
      ref={attachRoot}
      className="fb-attachment-tray"
      data-expanded={expanded || undefined}
      data-presentation={narrow ? "narrow" : undefined}
      data-testid={`${testIdPrefix}-tray`}
      onKeyDown={onKeyDown}
    >
      <button
        ref={disclosure}
        type="button"
        className="fb-attachment-disclosure"
        aria-label={label}
        aria-haspopup={narrow ? "menu" : undefined}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        disabled={disabled}
        onClick={toggle}
        {...hoverLabel(label)}
      >
        <Plus size={20} aria-hidden="true" />
      </button>
      {expanded && (narrow ? (
        <div
          id={listId}
          className="fb-picker-layer fb-attachment-menu"
          role="menu"
          aria-label={label}
          data-testid={`${testIdPrefix}-menu`}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className="fb-attachment-menu-item"
              data-testid={`${testIdPrefix}-${option.id}`}
              disabled={option.disabled}
              onClick={() => {
                closeMenu();
                option.onSelect();
              }}
            >
              {option.icon}
              <span>{option.label}</span>
            </button>
          ))}
          {extra ? (
            // The caller owns this control; pressing it is still a choice, so
            // the list closes even though the row's own handler runs first.
            <div className="fb-attachment-menu-extra" onClickCapture={closeMenu}>{extra}</div>
          ) : null}
        </div>
      ) : (
        <div id={listId} className="fb-attachment-shortcuts" role="group" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="fb-attachment-shortcut"
              aria-label={option.label}
              data-testid={`${testIdPrefix}-${option.id}`}
              disabled={option.disabled}
              onClick={option.onSelect}
              {...hoverLabel(option.label)}
            >
              {option.icon}
            </button>
          ))}
          {extra}
        </div>
      ))}
    </div>
  );
}
