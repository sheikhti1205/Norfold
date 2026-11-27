import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalBack } from "../hooks/useModalBack";
import { isTopModalLayer, useModalLayer } from "../hooks/modalLayers";
import { ArrowLeft, Bold, Check, Heading1, Heading2, Heading3, Italic, Link2, List, MoreHorizontal, Pilcrow, Undo2 } from "lucide-react";
import { Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import {
  fromMarkdown,
  isSafeRichTextHref,
  looksLikeMarkdown,
  measureDescription,
  toMarkdown,
  type InlineNode,
  type RichTextDocument,
} from "../services/richText";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  FloatingPortal,
} from "@floating-ui/react";
import { motion } from "framer-motion";
import { motionDurations, popoverVariants, pressFeedback } from "./uiMotion";
import { FormattingMenu } from "./FormattingMenu";
import { FORMATTING_COMMANDS } from "./formattingCommands";
import { useSlashCommands } from "../hooks/useSlashCommands";
import { KEYBOARD_OPEN_THRESHOLD_PX, useKeyboardInset } from "../hooks/keyboardInset";
import { subscribeNativeIme, type NativeImeState } from "../native/ime";

export const RICH_TEXT_DEBOUNCE_MS = 300;

/**
 * Actions behind the rail's trailing slot. The rail itself keeps the actions a
 * writer presses while composing; history replay, block insertion, clipboard
 * and the full-screen mode are a second tap, not a hidden feature.
 */
const MORE_COMMAND_IDS: ReadonlyArray<string> = ["redo", "list.number", "quote", "paste.markdown", "clear", "expand"];

// Portalled layers. The report form owns the modal ladder's first slot
// (70 + depth x 10 = 80) and a dialog opened from it takes 90; FormattingMenu
// stays at 92. The full-screen editor is opened from either, so it sits between
// them, and the link dialog it can open sits just above its own menus.
const EDITOR_OVERLAY_Z_INDEX = 91;
const EDITOR_MENU_Z_INDEX = 92;
const EDITOR_DIALOG_Z_INDEX = 93;
/** Above the report form, below every portalled menu/dialog. */
const INLINE_RAIL_Z_INDEX = 30;
/** Border (1px) + the 48px action row. */
const INLINE_RAIL_FLOW_HEIGHT_PX = 49;

/** `inputCapabilities` tracks the fine pointer; this hook needs the opposite. */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * A soft keyboard, not a narrower viewport.
 *
 * The Android shell answers *whether* directly (`WindowInsetsCompat.Type.ime()`
 * through `src/native/ime.ts`), because its resizing window reports the same
 * layout and visual height with the keyboard up. Everywhere else two honest
 * geometries answer it, because browsers split on which viewport they resize:
 *
 * - an overlaying IME shrinks only `visualViewport`, so `useKeyboardInset`
 *   measures the covered band directly and the rail docks to its top;
 * - a resizing IME (`interactive-widget=resizes-content`) shrinks the layout
 *   viewport itself, so the covered band is `visualViewport`-invisible. There
 *   the keyboard is proved by a large, transient layout-height loss on a
 *   coarse-pointer device whose width did not change (a rotation or a desktop
 *   window drag resets the baseline, a hardware keyboard never shrinks the
 *   layout at all).
 *
 * Ordinary browser chrome moves the layout height by tens of pixels and pinch
 * zoom changes `visualViewport.scale`, so neither summons a rail.
 */
function currentOrientationAngle(): number | null {
  if (typeof window === "undefined") return null;
  const angle = window.screen?.orientation?.angle;
  return typeof angle === "number" ? angle : null;
}

interface LayoutBaseline {
  width: number;
  height: number;
  angle: number | null;
}

interface LayoutLoss {
  /** On this device that loss is a keyboard, not browser chrome. */
  keyboard: boolean;
}

const NO_LAYOUT_LOSS: LayoutLoss = { keyboard: false };

/**
 * The Android shell's own IME reading, or `known: false` everywhere else. It is
 * the authority on *whether* a keyboard is up; the WebView's own geometry only
 * decides where the rail sits.
 */
function useNativeIme(): NativeImeState {
  const [state, setState] = useState<NativeImeState>({ known: false, visible: false });
  useEffect(() => subscribeNativeIme(setState), []);
  return state;
}

function useSoftKeyboard(): { open: boolean; insetPx: number } {
  const inset = useKeyboardInset();
  const nativeIme = useNativeIme();
  const [zoomed, setZoomed] = useState(() => {
    if (typeof window === "undefined") return false;
    return (window.visualViewport?.scale ?? 1) > 1.01;
  });
  const [layout, setLayout] = useState<LayoutLoss>(NO_LAYOUT_LOSS);
  const baselineRef = useRef<LayoutBaseline>({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    angle: currentOrientationAngle(),
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const updateZoom = () => setZoomed(viewport ? (viewport.scale ?? 1) > 1.01 : false);
    updateZoom();
    viewport?.addEventListener("resize", updateZoom);
    viewport?.addEventListener("scroll", updateZoom);

    const updateLayout = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const angle = currentOrientationAngle();
      const baseline = baselineRef.current;
      // Rotation, a desktop window drag or any real layout change other than a
      // keyboard moves the width too; re-learn the resting height from there.
      if (angle !== baseline.angle || Math.abs(width - baseline.width) > 2) {
        baselineRef.current = { width, height, angle };
        setLayout(NO_LAYOUT_LOSS);
        return;
      }
      if (height >= baseline.height) {
        baselineRef.current = { ...baseline, height };
        setLayout(NO_LAYOUT_LOSS);
        return;
      }
      const coveredPx = baseline.height - height;
      const coarse = typeof window.matchMedia === "function"
        && window.matchMedia(COARSE_POINTER_QUERY).matches;
      setLayout({
        keyboard: coarse
          && coveredPx > KEYBOARD_OPEN_THRESHOLD_PX
          // A keyboard never eats nearly the whole window; a window that did is
          // not one (rotation and desktop drags are already excluded above).
          && coveredPx < baseline.height * 0.85,
      });
    };
    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    return () => {
      viewport?.removeEventListener("resize", updateZoom);
      viewport?.removeEventListener("scroll", updateZoom);
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
    };
  }, []);

  // Native, where available, is the authority on *whether*: `adjustResize`
  // leaves the layout and visual viewports equal even with the keyboard up, so
  // geometry would call a proven-open IME closed. A proven native IME also
  // outranks pinch zoom, which is a geometry artefact, not a keyboard state.
  const open = nativeIme.known
    ? nativeIme.visible
    : !zoomed && (inset.open || layout.keyboard);
  // Native never says *where*. Its root IME inset is measured before a resizing
  // window consumes it, so subtracting it again would lift the rail into the
  // form. The CSS offset is the WebView's measured occlusion only: zero when
  // the layout and visual viewports already end together at the IME's top, the
  // covered band when the IME overlays the page.
  const insetPx = open ? inset.insetPx : 0;
  return { open, insetPx };
}

/**
 * Whether this field is the active one. Only elements inside the field's own
 * root prove it — the editor, its inline rail, its hint. `body`/`null` never
 * do: nothing is focused, so any keyboard on screen belongs to something else.
 * Portalled menus and the link dialog live outside the root and are owned by
 * their open state instead (see `railAnchored`).
 */
function useDescriptionActive(rootRef: RefObject<HTMLDivElement | null>): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      const element = document.activeElement;
      setActive(element instanceof Node && root.contains(element));
    };
    sync();
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    };
  }, [rootRef]);
  return active;
}

interface LinkSelection {
  from: number;
  to: number;
  text: string;
  doc: Editor["state"]["doc"];
  href: string;
}

function LinkSheet({ selection, triggerRef, fallbackElement, onCancel, onSave, onRemove }: {
  selection: LinkSelection;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** Stable in-page anchor when the rail has unmounted (keyboard closed). */
  fallbackElement?: HTMLElement;
  onCancel: () => void;
  onSave: (url: string) => string | null;
  onRemove: () => void;
}) {
  const id = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const editing = selection.href !== "";
  const [url, setUrl] = useState(selection.href || "https://");
  const [message, setMessage] = useState<string | null>(null);
  const [isImeOpen, setIsImeOpen] = useState(false);

  // The trap's callback ref (not the plain ref): FloatingPortal mounts its
  // children after the parent's passive effects, so the compat sync would
  // never see the element and the dialog would silently lose its Escape
  // handling, focus trap and top-layer registration.
  const setTrapRef = useFocusTrap(sheetRef, onCancel);
  useModalBack(true, onCancel);

  // Detect IME/keyboard open state using visualViewport
  useEffect(() => {
    const handleResize = () => {
      const viewport = window.visualViewport;
      if (viewport) {
        const heightRatio = viewport.height / window.innerHeight;
        setIsImeOpen(heightRatio < 0.75);
      }
    };
    window.visualViewport?.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("scroll", handleResize);
    handleResize();
    return () => {
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
    };
  }, []);

  const { refs, floatingStyles } = useFloating({
    open: true,
    onOpenChange: onCancel,
    placement: isImeOpen ? "bottom" : "top",
    middleware: [
      offset(8),
      flip({
        crossAxis: "alignment",
        fallbackAxisSideDirection: isImeOpen ? "none" : "start",
        padding: 8,
      }),
      shift({ padding: 8, crossAxis: true }),
      size({
        apply({ availableHeight, elements }: { availableHeight: number; elements: { floating: HTMLElement } }) {
          const maxHeight = Math.max(0, availableHeight - 16);
          elements.floating.style.maxHeight = `${maxHeight}px`;
          elements.floating.style.overflowY = "auto";
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    // The rail only exists above a soft keyboard, so it can unmount while this
    // dialog is open. Measure live: the tapped button while it is connected,
    // otherwise the editor box, instead of anchoring to a detached node.
    refs.setReference({
      getBoundingClientRect: () => {
        const trigger = triggerRef?.current;
        if (trigger?.isConnected) return trigger.getBoundingClientRect();
        if (fallbackElement?.isConnected) return fallbackElement.getBoundingClientRect();
        // Neither node survived (no rail, editor unmounted): centre on the
        // window instead of anchoring to the origin. A plain rect, not DOMRect,
        // so the dialog does not depend on that constructor existing.
        const x = Math.max(0, window.innerWidth / 2);
        const y = Math.max(0, window.innerHeight / 2);
        return { x, y, width: 0, height: 0, top: y, right: x, bottom: y, left: x };
      },
    });
  }, [refs, triggerRef, fallbackElement]);

  return (
    <FloatingPortal>
      <div
        ref={(el) => {
          refs.setFloating(el);
          setTrapRef(el);
        }}
        style={{ ...floatingStyles, zIndex: EDITOR_DIALOG_Z_INDEX }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-md rounded-m3-lg bg-surface shadow-xl"
        tabIndex={-1}
      >
        <div className="space-y-4 p-5">
          <h2 id={`${id}-title`} className="text-lg font-semibold">{editing ? "Edit link" : "Add link"}</h2>
          <label className="block text-sm" htmlFor={`${id}-text`}>Selected text</label>
          <input id={`${id}-text`} value={selection.text} readOnly className="w-full rounded-m3-xs border border-outline-variant bg-surface-container p-3" />
          {/* Deliberately NOT a <form>: this dialog renders inside ancestor
            forms (e.g. the Report form) via FloatingPortal, and portal events
            bubble through the React tree — an inner submit would propagate to
            the outer form and could publish the report. Enter saves via the
            input key handler instead. */}
          <div>
            <label htmlFor={`${id}-url`} className="block text-sm">URL</label>
            <input
              id={`${id}-url`}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  const error = onSave(url.trim());
                  if (error) setMessage(error);
                }
              }}
              aria-invalid={message != null}
              aria-describedby={message ? `${id}-error` : undefined}
              className="w-full rounded-m3-xs border border-outline-variant p-3"
            />
            {message && <p id={`${id}-error`} role="alert" className="text-sm text-error">{message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              {editing && isSafeRichTextHref(selection.href) && (
                <a
                  href={selection.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open link ${selection.href} in a new tab`}
                  className="mr-auto inline-flex min-h-[48px] min-w-[48px] items-center px-3 underline"
                >
                  Open link
                </a>
              )}
              <button type="button" onClick={onCancel} className="min-h-[48px] min-w-[48px] px-3">Cancel</button>
              {editing && (
                <button type="button" onClick={onRemove} aria-label="Remove link" className="min-h-[48px] min-w-[48px] rounded-m3-xs border border-outline-variant px-3">Remove link</button>
              )}
              <button
                type="button"
                onClick={() => {
                  const error = onSave(url.trim());
                  if (error) setMessage(error);
                }}
                className="min-h-[48px] min-w-[48px] rounded-m3-xs bg-on-surface px-3 text-surface"
              >
                {editing ? "Save link" : "Add link"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}

interface FloatingMenuProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /**
   * Live anchor, re-read on every reposition. The trigger is inside the rail,
   * which unmounts with the keyboard, so it can be gone while this menu is open.
   */
  getAnchorRect: () => DOMRect | null;
  children: React.ReactNode;
  label: string;
  placement?: "top" | "bottom";
}

function FloatingMenu({ open, onClose, triggerRef, getAnchorRect, children, label, placement = "top" }: FloatingMenuProps) {
  const floatingRef = useRef<HTMLDivElement>(null);
  const { refs, floatingStyles } = useFloating({
    open,
    onOpenChange: onClose,
    placement,
    middleware: [
      offset(4),
      flip({
        crossAxis: "alignment",
        fallbackAxisSideDirection: "start",
        padding: 8,
      }),
      shift({ padding: 8, crossAxis: true }),
      size({
        apply({ availableHeight, elements }: { availableHeight: number; elements: { floating: HTMLElement } }) {
          const maxHeight = Math.max(0, availableHeight - 16);
          elements.floating.style.maxHeight = `${maxHeight}px`;
          elements.floating.style.overflowY = "auto";
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!open) return;
    // A virtual element re-reads the anchor on every measurement, exactly like
    // FormattingMenu and the link sheet: a detached trigger measures as zero and
    // would drop the menu at the viewport origin.
    refs.setReference({
      getBoundingClientRect: () => getAnchorRect() ?? new DOMRect(0, 0, 0, 0),
    });
  }, [open, refs, getAnchorRect]);

  // Auto-focus the selected/first menu item when menu opens - using ref callback for synchronous focus
  const setFloatingRef = (el: HTMLDivElement | null) => {
    refs.setFloating(el);
    floatingRef.current = el;
    if (el && open) {
      // Focus synchronously when element is mounted
      const checkedItem = el.querySelector('[role="menuitemradio"][aria-checked="true"]') as HTMLElement;
      const firstItem = el.querySelector('[role="menuitem"], [role="menuitemradio"]') as HTMLElement;
      const target = checkedItem || firstItem;
      if (target) {
        target.focus();
      }
    }
  };

  // Handle keyboard navigation within the menu
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = event.currentTarget;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]'));
    const enabledItems = items.filter(item => !item.disabled);
    const activeIndex = enabledItems.findIndex(item => item === document.activeElement);

    if (activeIndex === -1) return;

    let nextIndex = activeIndex;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        nextIndex = (activeIndex + 1) % enabledItems.length;
        break;
      case "ArrowUp":
        event.preventDefault();
        nextIndex = (activeIndex - 1 + enabledItems.length) % enabledItems.length;
        break;
      case "Home":
        event.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        event.preventDefault();
        nextIndex = enabledItems.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      default:
        return;
    }

    enabledItems[nextIndex]?.focus();
  };

  if (!open) return null;

  return (
    <FloatingPortal>
      {/* Positioning shell only: floating-ui owns this element's transform for
        anchoring, so the enter animation lives on the inner motion element
        (transform/opacity only, anchored at the trigger edge). */}
      <div ref={setFloatingRef} style={{ ...floatingStyles, zIndex: EDITOR_MENU_Z_INDEX }}>
        <motion.div
          role="menu"
          aria-label={label}
          className="max-w-[calc(100vw-2rem)] w-64 max-h-[min(20rem,40vh)] overflow-y-auto rounded-m3-sm border border-outline-variant bg-surface p-1 shadow-xl"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          initial="hidden"
          animate="visible"
          variants={popoverVariants}
          transition={{ duration: motionDurations.fast }}
          style={{ transformOrigin: placement === "top" ? "bottom center" : "top center" }}
        >
          {children}
        </motion.div>
      </div>
    </FloatingPortal>
  );
}

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  editorRef?: RefObject<Editor | null>;
  error?: string;
  required?: boolean;
  maxLength?: number;
  inputId?: string;
  disabled?: boolean;
}

interface PMTextMark {
  type: string;
  attrs?: { href?: string };
}

interface PMNode {
  type: string;
  attrs?: { level?: number; href?: string; start?: number };
  text?: string;
  marks?: PMTextMark[];
  content?: PMNode[];
}

function markForRun(run: InlineNode): PMTextMark[] | undefined {
  switch (run.type) {
    case "Bold":
      return [{ type: "bold" }];
    case "Italic":
      return [{ type: "italic" }];
    case "BoldItalic":
      return [{ type: "bold" }, { type: "italic" }];
    case "Link":
      return isSafeRichTextHref(run.href) ? [{ type: "link", attrs: { href: run.href } }] : undefined;
    case "BoldLink":
      return isSafeRichTextHref(run.href)
        ? [
            { type: "bold" },
            { type: "link", attrs: { href: run.href } },
          ]
        : [{ type: "bold" }];
    case "ItalicLink":
      return isSafeRichTextHref(run.href)
        ? [
            { type: "italic" },
            { type: "link", attrs: { href: run.href } },
          ]
        : [{ type: "italic" }];
    case "BoldItalicLink":
      return isSafeRichTextHref(run.href)
        ? [{ type: "bold" }, { type: "italic" }, { type: "link", attrs: { href: run.href } }]
        : [{ type: "bold" }, { type: "italic" }];
    case "InlineText":
      return undefined;
  }
}

function runsToPM(runs: InlineNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const run of runs) {
    const segments = run.text.split("\n");
    segments.forEach((segment, index) => {
      if (index > 0) out.push({ type: "hardBreak" });
      if (segment !== "") {
        const node: PMNode = { type: "text", text: segment };
        const marks = markForRun(run);
        if (marks) node.marks = marks;
        out.push(node);
      }
    });
  }
  return out;
}

/** Markdown (interchange) -> Tiptap doc JSON. Never throws. */
export function markdownToTiptap(md: string): JSONContent {
  try {
    const doc = fromMarkdown(md);
    const content: PMNode[] = [];
    for (const block of doc.blocks) {
      switch (block.type) {
        case "Paragraph": {
          const inline = runsToPM(block.runs);
          content.push({ type: "paragraph", ...(inline.length > 0 ? { content: inline } : {}) });
          break;
        }
        case "Heading":
          content.push({ type: "heading", attrs: { level: block.level }, content: runsToPM(block.runs) });
          break;
        case "BulletList":
          content.push({
            type: "bulletList",
            content: block.items.map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: runsToPM(item) }] })),
          });
          break;
        case "OrderedList":
          content.push({
            type: "orderedList",
            attrs: { start: block.start },
            content: block.items.map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: runsToPM(item) }] })),
          });
          break;
        case "Quote": {
          const lines: Array<Array<{ text: string; marks: PMTextMark[] | undefined }>> = [[]];
          for (const run of block.runs) {
            const segments = run.text.split("\n");
            segments.forEach((segment, index) => {
              if (index > 0) lines.push([]);
              if (segment !== "") lines[lines.length - 1]?.push({ text: segment, marks: markForRun({ ...run, text: segment }) });
            });
          }
          const paras: PMNode[] = lines.map((parts) => {
            const node: PMNode = { type: "paragraph" };
            const children: PMNode[] = [];
            for (const part of parts) {
              const child: PMNode = { type: "text", text: part.text };
              if (part.marks) child.marks = part.marks;
              children.push(child);
            }
            if (children.length > 0) node.content = children;
            return node;
          });
          content.push({ type: "blockquote", content: paras.length > 0 ? paras : [{ type: "paragraph" }] });
          break;
        }
      }
    }
    return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
  } catch {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
}

function nodeText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(nodeText).join("");
}

function inlineToRuns(content: PMNode[] | undefined): InlineNode[] {
  const runs: InlineNode[] = [];
  for (const node of content ?? []) {
    if (node.type === "hardBreak") {
      runs.push({ type: "InlineText", text: "\n" });
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string" || node.text === "") continue;
    const marks = node.marks ?? [];
    const link = marks.find((m) => m.type === "link");
    const linkHref = link?.attrs?.href;
    if (typeof linkHref === "string" && isSafeRichTextHref(linkHref)) {
      const href = linkHref.trim();
      if (marks.some((m) => m.type === "bold") && marks.some((m) => m.type === "italic")) runs.push({ type: "BoldItalicLink", href, text: node.text });
      else if (marks.some((m) => m.type === "bold")) runs.push({ type: "BoldLink", href, text: node.text });
      else if (marks.some((m) => m.type === "italic")) runs.push({ type: "ItalicLink", href, text: node.text });
      else runs.push({ type: "Link", href, text: node.text });
      continue;
    }
    if (marks.some((m) => m.type === "bold") && marks.some((m) => m.type === "italic")) runs.push({ type: "BoldItalic", text: node.text });
    else if (marks.some((m) => m.type === "bold")) runs.push({ type: "Bold", text: node.text });
    else if (marks.some((m) => m.type === "italic")) runs.push({ type: "Italic", text: node.text });
    else runs.push({ type: "InlineText", text: node.text });
  }
  const merged: InlineNode[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev?.type === "InlineText" && run.type === "InlineText") prev.text += run.text;
    else if (prev?.type === "Bold" && run.type === "Bold") prev.text += run.text;
    else if (prev?.type === "Italic" && run.type === "Italic") prev.text += run.text;
    else if (prev?.type === "BoldItalic" && run.type === "BoldItalic") prev.text += run.text;
    else if (prev?.type === "Link" && run.type === "Link" && prev.href === run.href) prev.text += run.text;
    else if (prev?.type === "BoldLink" && run.type === "BoldLink" && prev.href === run.href) prev.text += run.text;
    else if (prev?.type === "ItalicLink" && run.type === "ItalicLink" && prev.href === run.href) prev.text += run.text;
    else if (prev?.type === "BoldItalicLink" && run.type === "BoldItalicLink" && prev.href === run.href) prev.text += run.text;
    else merged.push({ ...run });
  }
  return merged.length > 0 ? merged : [{ type: "InlineText", text: "" }];
}

/**
 * Flatten one Tiptap list node to v1 codec items without losing text (ED-09).
 * Each listItem's direct paragraphs join with a single space; nested lists
 * recurse into sibling blocks appended after the parent list. Blank items
 * (no text, no nested content) are skipped. Never throws.
 */
function listNodeToItems(node: PMNode): { items: InlineNode[][]; nested: RichTextDocument["blocks"] } {
  const items: InlineNode[][] = [];
  const nested: RichTextDocument["blocks"] = [];
  try {
    for (const item of node.content ?? []) {
      if (typeof item !== "object" || item === null || item.type !== "listItem") continue;
      const paraChunks: PMNode[][] = [];
      for (const child of item.content ?? []) {
        if (typeof child !== "object" || child === null || typeof child.type !== "string") continue;
        if (child.type === "paragraph") {
          paraChunks.push(child.content ?? []);
        } else if (child.type === "bulletList" || child.type === "orderedList") {
          const inner = listNodeToItems(child);
          if (inner.items.length > 0) {
            nested.push(
              child.type === "bulletList"
                ? { type: "BulletList", items: inner.items }
                : { type: "OrderedList", start: child.attrs?.start ?? 1, items: inner.items },
            );
          }
          nested.push(...inner.nested);
        } else if (nodeText(child) !== "") {
          paraChunks.push([{ type: "text", text: nodeText(child) }]);
        }
      }
      const combined: PMNode[] = [];
      paraChunks.forEach((chunk, index) => {
        if (index > 0) combined.push({ type: "text", text: " " });
        combined.push(...chunk);
      });
      const runs = inlineToRuns(combined);
      if (runs.some((run) => run.text !== "")) items.push(runs);
    }
  } catch {
    // Fall through with whatever was collected; caller still emits text.
  }
  return { items, nested };
}

/**
 * Reports whether the given Tiptap doc JSON simplifies list structure when
 * saved through the flat v1 codec (ED-09): any list item with more than one
 * non-empty paragraph, any nested list, or any other text-bearing non-
 * paragraph child. Pure and never throws; used for the user-visible notice.
 */
export function tiptapListsWereSimplified(json: unknown): boolean {
  try {
    if (typeof json !== "object" || json === null || !Array.isArray((json as { content?: unknown }).content)) return false;
    const nodes = (json as { content: PMNode[] }).content;
    for (const node of nodes) {
      if (typeof node !== "object" || node === null) continue;
      if (node.type !== "bulletList" && node.type !== "orderedList") continue;
      for (const item of node.content ?? []) {
        if (typeof item !== "object" || item === null || item.type !== "listItem") continue;
        let textParagraphs = 0;
        for (const child of item.content ?? []) {
          if (typeof child !== "object" || child === null || typeof child.type !== "string") continue;
          if (child.type === "paragraph") {
            if (nodeText(child) !== "") textParagraphs += 1;
          } else if (child.type === "bulletList" || child.type === "orderedList") {
            return true;
          } else if (nodeText(child) !== "") {
            return true;
          }
        }
        if (textParagraphs > 1) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Tiptap doc JSON -> Markdown via the richText codec. Never throws. */
export function tiptapToMarkdown(json: unknown): string {
  try {
    if (typeof json !== "object" || json === null || !Array.isArray((json as { content?: unknown }).content)) return "";
    const nodes = (json as { content: PMNode[] }).content;
    const blocks: RichTextDocument["blocks"] = [];
    for (const node of nodes) {
      if (typeof node !== "object" || node === null || typeof node.type !== "string") continue;
      switch (node.type) {
        case "paragraph":
          blocks.push({ type: "Paragraph", runs: inlineToRuns(node.content) });
          break;
        case "heading":
          if (node.attrs?.level === 1 || node.attrs?.level === 2 || node.attrs?.level === 3) {
            blocks.push({ type: "Heading", level: node.attrs.level, runs: inlineToRuns(node.content) });
          } else {
            blocks.push({ type: "Paragraph", runs: inlineToRuns(node.content) });
          }
          break;
        case "bulletList": {
          // ED-09: the v1 codec is flat (one inline-run array per item), so a
          // list item with several paragraphs is joined with a space (never
          // concatenated word-to-word) and nested lists become following
          // sibling blocks. Text is always preserved; nesting flattens.
          const { items, nested } = listNodeToItems(node);
          if (items.length > 0) blocks.push({ type: "BulletList", items });
          blocks.push(...nested);
          break;
        }
        case "orderedList": {
          const { items, nested } = listNodeToItems(node);
          if (items.length > 0) blocks.push({ type: "OrderedList", start: node.attrs?.start ?? 1, items });
          blocks.push(...nested);
          break;
        }
        case "blockquote": {
          const runs = inlineToRuns(
            (node.content ?? [])
              .filter((child) => child.type === "paragraph")
              .flatMap((child, index) => (index > 0 ? [{ type: "hardBreak" } as PMNode, ...(child.content ?? [])] : (child.content ?? []))),
          );
          blocks.push({ type: "Quote", runs });
          break;
        }
        default:
          if (nodeText(node) !== "") blocks.push({ type: "Paragraph", runs: [{ type: "InlineText", text: nodeText(node) }] });
          break;
      }
    }
    if (blocks.length === 0) return "";
    while (blocks.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last?.type !== "Paragraph" || !last.runs.every((run) => run.text === "")) break;
      blocks.pop();
    }
    if (blocks.length === 0) return "";
    return toMarkdown({ v: 1, blocks });
  } catch {
    return "";
  }
}

/**
 * YAGNI rich-text editor: Paragraph/Heading/BulletList/Quote blocks plus
 * Bold/Italic/Link marks. Markdown is the interchange format. Edits report to
 * the parent immediately so no keystroke is lost on submit or unmount, while
 * external value changes (draft restore, reset) replace the editor content.
 *
 * Rail: seven stable slots for the actions used while composing (Undo, block
 * type, Bold, Italic, Bullets, Link, More); the trailing menu holds history
 * replay, block-level insertion, clipboard, cleanup and full screen. The rail
 * is not permanent chrome: it exists only while this Description owns focus AND
 * a real soft keyboard is proved — by the Android shell's WindowInsets reading,
 * by an overlaying IME that shrinks the visible viewport, or by a resizing IME
 * that shrinks the layout on a touch device — and is docked to the IME's top
 * edge. Without that proof (desktop web, a hardware keyboard, an IME that
 * changes no measurable geometry) a line-leading "/" still opens the same
 * actions as a typed command menu, and a short hint names it. A menu opened from
 * the rail outlives the keyboard, but the rail itself never does.
 *
 * Selection safety (ED-04): a toolbar `pointerdown` captures the pending range
 * before Android/WebView focus loss collapses the DOM selection; the stashed
 * range additionally guards with a doc-identity + text check, is cleared on
 * intentional editor pointer/keyboard navigation, external content
 * replacement, and after every operation. A collapsed caret with no pending
 * range only toggles the stored mark for future typing — never stale text.
 */
export function RichTextEditor({ label, value, onChange, placeholder, editorRef, error, required, maxLength, inputId, disabled = false }: RichTextEditorProps) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const clipboardGeneration = useRef(0);
  const [empty, setEmpty] = useState(true);
  const [counts, setCounts] = useState({ stored: 0, visible: 0 });
  const [, refreshSelection] = useState(0);
  const [linkSelection, setLinkSelection] = useState<LinkSelection | null>(null);
  const [openMenu, setOpenMenu] = useState<null | "block" | "more">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [moreActive, setMoreActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayPreviouslyFocusedRef = useRef<HTMLElement | null>(null);
  const initialFocusClaimedRef = useRef(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const softKeyboard = useSoftKeyboard();
  const descriptionActive = useDescriptionActive(rootRef);
  const setOverlayRef = useFocusTrap(overlayRef, () => setIsExpanded(false), isExpanded, overlayPreviouslyFocusedRef);
  useModalBack(isExpanded, () => setIsExpanded(false));

  // Restore focus to expand button when overlay closes
  useEffect(() => {
    if (!isExpanded && overlayPreviouslyFocusedRef.current) {
      const previous = overlayPreviouslyFocusedRef.current;
      overlayPreviouslyFocusedRef.current = null;
      if (document.contains(previous)) {
        previous.focus();
      } else if (moreButtonRef.current) {
        // The More slot is the one trigger that stays mounted, so it is the
        // stable place to return focus when the remember-ed element is gone.
        moreButtonRef.current.focus();
      }
    }
  }, [isExpanded]);

  // The dialog itself owns the initial focus, not the first control the trap
  // finds: that control is the close button, and an opener who tapped Expand
  // must not see a keyboard ring on a button they never aimed at. The trap
  // focuses it from a passive effect, so the first focus to land anywhere in
  // the overlay is moved to the container; Tab reaches the header controls in
  // order from there.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!isExpanded || !overlay) {
      initialFocusClaimedRef.current = false;
      return;
    }
    const claim = () => {
      if (initialFocusClaimedRef.current) return;
      initialFocusClaimedRef.current = true;
      if (document.activeElement !== overlay) overlay.focus();
    };
    overlay.addEventListener("focusin", claim);
    // A trap that focused before this effect committed leaves its control
    // focused without a later focus event to hear.
    if (overlay.contains(document.activeElement)) claim();
    return () => overlay.removeEventListener("focusin", claim);
  }, [isExpanded]);
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const countId = `${baseId}-count`;
  const statusId = `${baseId}-status`;
  const hintId = `${baseId}-slash-hint`;
  // A portalled menu or the link dialog belongs to this field while it is open,
  // even though it lives outside the root. Ownership is not visibility: the
  // rail itself is never shown without a proved IME (see `showInlineRail`).
  const railAnchored = openMenu !== null || linkSelection !== null;
  // The hint is the fallback surface when no rail can be shown: it is never a
  // permanent rail, and it stays out of the way while the rail is on screen or
  // a menu opened from the field is already explaining its actions.
  const showHint = !disabled && !softKeyboard.open && !railAnchored;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  interface RangedSelection { from: number; to: number; doc: Editor["state"]["doc"]; text: string; }
  // Last non-collapsed selection + the pending toolbar-capture range.
  // Native Android selection/clipboard behavior is untouched; these only
  // remember ProseMirror offsets to re-apply formatting to the right range.
  const savedRangeRef = useRef<RangedSelection | null>(null);
  const pendingToolbarRangeRef = useRef<RangedSelection | null>(null);
  const selectionRafRef = useRef(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const blockButtonRef = useRef<HTMLButtonElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const lastMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  const initialContent = useMemo(() => markdownToTiptap(value), []);

  function snapshotRange(from: number, to: number, doc: Editor["state"]["doc"]): RangedSelection | null {
    try {
      return { from, to, doc, text: doc.textBetween(from, to) };
    } catch {
      return null;
    }
  }

  function refreshCounts(ed: Editor) {
    try {
      const measured = measureDescription(tiptapToMarkdown(ed.getJSON()));
      setCounts({ stored: measured.storedLength, visible: measured.visibleLength });
    } catch {
      const text = ed.getText().length;
      setCounts({ stored: text, visible: text });
    }
    try {
      setListNotice(tiptapListsWereSimplified(ed.getJSON()));
    } catch {
      setListNotice(false);
    }
  }

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          underline: false,
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true, isAllowedUri: (url) => isSafeRichTextHref(url) },
        }),
      ],
      content: initialContent,
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
         attributes: {
           role: "textbox",
           "aria-multiline": "true",
           "aria-label": label,
           class: `tiptap min-h-[120px] max-h-[240px] rounded-m3-sm border bg-surface px-3.5 py-3 text-base focus:border-on-surface focus:outline-none overflow-y-auto overscroll-contain ${error ? "border-error" : "border-outline-variant"}`,
        },
        handlePaste: (view, event) => {
          if (disabledRef.current) return true;
          // Priority 1: trustworthy rich clipboard keeps the native path
          // (schema + safe-link allowlist apply as usual).
          const clipboard = event.clipboardData;
          if (!clipboard || clipboard.getData("text/html")) return false;
          // Priority 2: recognizably-Markdown plain text (ChatGPT-style
          // exports) parses into editor nodes over the selected range only.
          // Ordinary prose and ambiguous asterisks stay literal.
          const text = clipboard.getData("text/plain");
          if (!looksLikeMarkdown(text)) return false;
          try {
            const doc = view.state.schema.nodeFromJSON(markdownToTiptap(text));
            view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)));
            return true;
          } catch {
            return false;
          }
        },
        handleKeyDown: (_view, event) => {
          // Never intercept Backspace: Tiptap's Android delete plugin force-
          // flushes the DOM observer on deleteContentBackward, and steering it
          // here desyncs the view. The trigger is text, so Backspace closes the
          // menu the same way any other edit does.
          if (event.isComposing) return false;
          const slashState = slashRef.current;
          if (!slashState.open || slashState.items.length === 0) return false;
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              slashState.move(1);
              return true;
            case "ArrowUp":
              event.preventDefault();
              slashState.move(-1);
              return true;
            case "Enter":
              event.preventDefault();
              slashState.accept(slashState.activeIndex);
              return true;
            case "Escape":
              event.preventDefault();
              // Escape must stop at the menu: the form dialog or the
              // full-screen overlay beneath it also listens on document, and
              // dismissing a menu must not dismiss the surface around it.
              event.stopPropagation();
              slashState.dismiss();
              return true;
            case "Tab":
              // Closing without preventing default keeps Tab's focus move.
              slashState.dismiss();
              return false;
            default:
              return false;
          }
        },
      },
      onCreate: ({ editor: created }) => {
        setEmpty(created.isEmpty);
        refreshCounts(created);
        if (editorRef) editorRef.current = created;
      },
      onTransaction: ({ transaction }) => {
        // Collapsed mark toggles only change storedMarks, not the document or
        // selection. Refresh pressed styling even when status text is unchanged.
        if (transaction.storedMarksSet) refreshSelection((revision) => revision + 1);
      },
      onUpdate: ({ editor: updated }) => {
        if (disabledRef.current) return;
        setEmpty(updated.isEmpty);
        refreshCounts(updated);
        const markdown = tiptapToMarkdown(updated.getJSON());
        if (markdown !== valueRef.current) onChangeRef.current(markdown);
      },
      onSelectionUpdate: ({ editor: updated }) => {
        const { from, to, empty: isEmpty } = updated.state.selection;
        if (!isEmpty) {
          const snapshot = snapshotRange(from, to, updated.state.doc);
          if (snapshot) savedRangeRef.current = snapshot;
        }
        // Long-press drag on Android fires selection updates every frame; a
        // full editor re-render per tick janks and risks compositor churn, so
        // toolbar-state renders coalesce on the animation frame. The range
        // snapshot above stays synchronous so formatting never loses its target.
        if (selectionRafRef.current === 0) {
          selectionRafRef.current = requestAnimationFrame(() => {
            selectionRafRef.current = 0;
            if (!updated.isDestroyed) refreshSelection((revision) => revision + 1);
          });
        }
      },
    },
    [],
  );

  useLayoutEffect(() => {
    editor?.setEditable(!disabled, false);
    editor?.view.dom.setAttribute("aria-disabled", String(disabled));
    if (disabled) {
      clipboardGeneration.current += 1;
      setOpenMenu(null);
      setLinkSelection(null);
      savedRangeRef.current = null;
      pendingToolbarRangeRef.current = null;
    }
  }, [editor, disabled]);
  useEffect(() => () => { clipboardGeneration.current += 1; }, []);

  useEffect(() => {
    if (!editor) return;
    if (editorRef) editorRef.current = editor;
    if (tiptapToMarkdown(editor.getJSON()) !== value) {
      editor.commands.setContent(markdownToTiptap(value));
      savedRangeRef.current = null;
      pendingToolbarRangeRef.current = null;
    }
    setEmpty(editor.isEmpty);
    refreshCounts(editor);
  }, [editor, value]);

  useEffect(() => {
    const dom = editor?.view.dom as HTMLElement | undefined;
    if (!dom) return;
    const describedBy = [error ? errorId : null, countId, showHint ? hintId : null].filter(Boolean).join(" ");
    dom.setAttribute("aria-describedby", describedBy);
    if (error) dom.setAttribute("aria-invalid", "true");
    else dom.removeAttribute("aria-invalid");
    if (required) dom.setAttribute("aria-required", "true");
    else dom.removeAttribute("aria-required");
    if (inputId) dom.setAttribute("id", inputId);
    else dom.removeAttribute("id");
  }, [editor, error, required, inputId, errorId, countId, hintId, showHint]);

  useEffect(() => {
    const dom = editor?.view.dom as HTMLElement | undefined;
    if (!dom) return;
    // A single Tiptap instance moves between the inline field and the overlay.
    // Remove the inline height cap while expanded; the flex parent owns the
    // one scrolling region and ProseMirror grows with min-height so expanding
    // content is never trapped inside a fixed-height box.
    dom.classList.toggle("max-h-[240px]", !isExpanded);
    dom.classList.toggle("min-h-[120px]", !isExpanded);
    dom.classList.toggle("min-h-full", isExpanded);
    dom.classList.toggle("overflow-y-auto", !isExpanded);
    dom.classList.toggle("overflow-y-visible", isExpanded);
    return () => {
      dom.classList.remove("min-h-full");
      dom.classList.remove("overflow-y-visible");
      dom.classList.add("overflow-y-auto");
      dom.classList.add("max-h-[240px]", "min-h-[120px]");
    };
  }, [editor, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const viewport = window.visualViewport;
    const update = () => {
      overlay.style.setProperty("--fb-visible-height", `${Math.max(1, viewport?.height ?? window.innerHeight)}px`);
      overlay.style.setProperty("--fb-visible-top", `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [isExpanded]);

  // Close menus on outside tap or Escape, restoring focus to the menu button.
  // The open menu registers on the modal Escape stack above the fullscreen
  // overlay trap, so one Escape closes only the menu — never the overlay
  // beneath it. (The link dialog uses useFocusTrap, which stacks the same way.)
  const menuLayerId = useModalLayer(openMenu !== null);
  useEffect(() => {
    if (!openMenu) return;
    function onDocPointerDown(event: PointerEvent) {
      // The menus are portalled, so the toolbar cannot contain their targets.
      // Match each panel by its own role/name instead of every listbox on the
      // page, so picking from an unrelated control still dismisses this one.
      const target = event.target as Node;
      const element = target instanceof Element ? target : null;
      const inMenu = element?.closest('[role="menu"], [aria-label="More formatting actions"]') != null;
      // The rail unmounts with the keyboard, so a missing toolbar means the
      // press cannot be inside it; it still dismisses the menu.
      const inRail = toolbarRef.current?.contains(target) === true;
      if (!inRail && !inMenu) setOpenMenu(null);
    }
    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isTopModalLayer(menuLayerId)) return;
        event.preventDefault();
        setOpenMenu(null);
        lastMenuButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [openMenu, menuLayerId]);

  // Move focus into the open menu (checked item first) so keyboard and
  // screen-reader users land on the current choice, not behind the button.
  useEffect(() => {
    if (!openMenu || !toolbarRef.current) return;
    const menu = toolbarRef.current.querySelector('[role="menu"]');
    const target =
      menu?.querySelector('button[aria-checked="true"]:not([disabled])') ??
      menu?.querySelector("button:not([disabled])");
    (target as HTMLElement | null)?.focus();
  }, [openMenu]);

  /** Roving ArrowUp/Down (wrapping, skipping disabled), Home/End, Tab-close. */
  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const panel = event.currentTarget;
    const items = Array.from(panel.querySelectorAll("button:not([disabled])")) as HTMLButtonElement[];
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active as HTMLButtonElement) : -1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpenMenu(null);
    }
    // Escape is handled by the document listener (close + focus restore).
  }

  function rangeSnapshotValid(snapshot: RangedSelection | null): { from: number; to: number } | null {
    if (!editor || !snapshot) return null;
    // Doc-version guard: any intervening edit/replacement invalidates positions.
    if (editor.state.doc !== snapshot.doc) return null;
    const max = editor.state.doc.content.size;
    if (snapshot.from < 0 || snapshot.to > max || snapshot.from >= snapshot.to) return null;
    try {
      if (editor.state.doc.textBetween(snapshot.from, snapshot.to) !== snapshot.text) return null;
    } catch {
      return null;
    }
    return { from: snapshot.from, to: snapshot.to };
  }

  function validSavedRange(): { from: number; to: number } | null {
    const valid = rangeSnapshotValid(savedRangeRef.current);
    if (!valid) savedRangeRef.current = null;
    return valid;
  }

  /** Capture the pending toolbar range BEFORE focus loss collapses the DOM
   * selection (pointer/mouse/touch capture on the toolbar root). Never clears
   * an already-captured pending range on failure. */
  function captureToolbarRange() {
    if (!editor) return;
    const { from, to, empty: isEmpty } = editor.state.selection;
    if (!isEmpty) {
      const snapshot = snapshotRange(from, to, editor.state.doc);
      if (snapshot) {
        savedRangeRef.current = snapshot;
        pendingToolbarRangeRef.current = snapshot;
      }
      return;
    }
    const saved = rangeSnapshotValid(savedRangeRef.current);
    if (saved && savedRangeRef.current) {
      pendingToolbarRangeRef.current = { ...savedRangeRef.current };
    }
  }

  function takePendingRange(): { from: number; to: number } | null {
    const pending = rangeSnapshotValid(pendingToolbarRangeRef.current);
    pendingToolbarRangeRef.current = null;
    return pending;
  }

  function resolveFormatRange(): { from: number; to: number } | null {
    if (!editor) return null;
    const pending = takePendingRange();
    if (pending) return pending;
    const { from, to, empty: isEmpty } = editor.state.selection;
    if (!isEmpty) {
      const snapshot = snapshotRange(from, to, editor.state.doc);
      if (snapshot) savedRangeRef.current = snapshot;
      return { from, to };
    }
    return validSavedRange();
  }

  /** Intentional editor pointer/keyboard navigation invalidates the stash. */
  function handleEditorIntentionalInteraction() {
    savedRangeRef.current = null;
    pendingToolbarRangeRef.current = null;
  }

  function finishOperation(message: string) {
    savedRangeRef.current = null;
    pendingToolbarRangeRef.current = null;
    setStatus(message);
  }

  /** Restore a stashed/captured range so block commands hit the right block. */
  function focusRangeOrCurrent(range: { from: number; to: number } | null) {
    if (!editor) return;
    if (range && editor.state.selection.empty) {
      try {
        editor.chain().focus().setTextSelection(range).run();
        return;
      } catch {
        // Fall through to plain focus.
      }
    }
    editor.commands.focus();
  }

  function toggleMarkWithSavedSelection(mark: "bold" | "italic") {
    if (!editor || disabledRef.current) return;
    const range = resolveFormatRange();
    if (range && editor.state.selection.empty) {
      if (mark === "bold") editor.chain().focus().setTextSelection(range).toggleBold().run();
      else editor.chain().focus().setTextSelection(range).toggleItalic().run();
    } else if (mark === "bold") editor.chain().focus().toggleBold().run();
    else editor.chain().focus().toggleItalic().run();
    finishOperation(mark === "bold" ? "Bold applied" : "Italic applied");
  }

  function applyBlock(kind: "body" | 1 | 2 | 3) {
    if (!editor || disabledRef.current) return;
    const range = resolveFormatRange();
    focusRangeOrCurrent(range);
    // setHeading (not toggle): re-choosing the current level keeps it (ED-02).
    if (kind === "body") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: kind }).run();
    setOpenMenu(null);
    finishOperation(kind === "body" ? "Body style applied" : `Heading ${kind} applied`);
  }

  function applyList(kind: "bullet" | "ordered") {
    if (!editor || disabledRef.current) return;
    const range = resolveFormatRange();
    focusRangeOrCurrent(range);
    if (kind === "bullet") editor.chain().focus().toggleBulletList().run();
    else editor.chain().focus().toggleOrderedList().run();
    setOpenMenu(null);
    finishOperation(kind === "bullet" ? "Bullet list toggled" : "Numbered list toggled");
  }

  function applyQuote() {
    if (!editor || disabledRef.current) return;
    const range = resolveFormatRange();
    focusRangeOrCurrent(range);
    editor.chain().focus().toggleBlockquote().run();
    setOpenMenu(null);
    finishOperation("Quote applied");
  }

  function applyClearAll() {
    if (!editor || disabledRef.current) return;
    // Clear-all targets the selection when present, else the current block.
    editor.chain().focus().clearNodes().unsetAllMarks().run();
    setOpenMenu(null);
    finishOperation("All formatting cleared");
  }

  function applyUndo() {
    if (!editor || disabledRef.current) return;
    editor.chain().focus().undo().run();
    setOpenMenu(null);
    finishOperation("Undone");
  }

  /**
   * Explicit "Paste as Markdown" for clipboards that arrive without usable
   * metadata on Android: parses the clipboard span through the stored-
   * description codec and inserts it at the selection, preserving caret and
   * undo history. Genuine user gesture (menu tap) satisfies clipboard policy.
   */
  async function pasteClipboardAsMarkdown() {
    if (!editor || disabledRef.current) return;
    const generation = clipboardGeneration.current;
    const range = resolveFormatRange();
    const doc = editor.state.doc;
    setOpenMenu(null);
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (editor.isDestroyed || disabledRef.current || generation !== clipboardGeneration.current) return;
      setStatus("Clipboard is unavailable");
      return;
    }
    if (editor.isDestroyed || disabledRef.current || generation !== clipboardGeneration.current) return;
    if (text.trim() === "") {
      setStatus("Clipboard is empty");
      return;
    }
    if (editor.state.doc !== doc) {
      setStatus("The selected text changed. Select it again to paste.");
      return;
    }
    if (range) editor.chain().focus().insertContentAt(range, markdownToTiptap(text)).run();
    else editor.chain().focus().insertContent(markdownToTiptap(text)).run();
    finishOperation("Pasted as Markdown");
  }

  function applyRedo() {
    if (!editor || disabledRef.current) return;
    editor.chain().focus().redo().run();
    setOpenMenu(null);
    finishOperation("Redone");
  }

  function applyLink() {
    if (!editor || disabledRef.current) return;
    const { empty: collapsed } = editor.state.selection;
    // Caret inside an existing link opens the edit dialog (ED-07) —
    // never an instant destructive unset.
    if (collapsed && editor.isActive("link")) {
      try {
        editor.chain().focus().extendMarkRange("link").run();
      } catch {
        return;
      }
      const { from, to, empty: stillCollapsed } = editor.state.selection;
      if (stillCollapsed) return;
      let text: string;
      try {
        text = editor.state.doc.textBetween(from, to);
      } catch {
        return;
      }
      setLinkSelection({
        from, to, text, doc: editor.state.doc,
        href: (editor.getAttributes("link")["href"] as string | undefined) ?? "",
      });
      return;
    }
    const range = resolveFormatRange();
    if (!range) {
      setStatus("Select text to add a link");
      return;
    }
    let text: string;
    try {
      text = editor.state.doc.textBetween(range.from, range.to);
    } catch {
      return;
    }
    setLinkSelection({
      from: range.from, to: range.to, text, doc: editor.state.doc,
      href: (editor.getAttributes("link")["href"] as string | undefined) ?? "",
    });
  }

  /**
   * Slash command executor. A chainable command deletes the typed trigger and
   * acts in ONE transaction closed into its own history group, so one undo
   * restores the "/query" the user typed. Two commands cannot honour that and
   * say so where they are implemented: `undo` (the trigger is the step it
   * reverts) and `link` (the dialog spans two transactions).
   */
  function runSlashCommand(target: Editor, commandId: string, range: { from: number; to: number }): boolean {
    if (disabledRef.current) return false;
    // closeHistory keeps the acceptance out of the surrounding typing group.
    // Without it the deletion is adjacent to the typing and merges into that
    // history event, so one undo would erase the characters instead of
    // restoring the trigger.
    const removeTrigger = () => target.chain().focus()
      .command(({ tr }) => {
        closeHistory(tr);
        return true;
      })
      .deleteRange(range);
    switch (commandId) {
      case "bold":
        return removeTrigger().toggleBold().run();
      case "italic":
        return removeTrigger().toggleItalic().run();
      case "block.body":
        return removeTrigger().setParagraph().run();
      case "block.h1":
        return removeTrigger().setHeading({ level: 1 }).run();
      case "block.h2":
        return removeTrigger().setHeading({ level: 2 }).run();
      case "block.h3":
        return removeTrigger().setHeading({ level: 3 }).run();
      case "list.bullet":
        return removeTrigger().toggleBulletList().run();
      case "list.number":
        return removeTrigger().toggleOrderedList().run();
      case "quote":
        return removeTrigger().toggleBlockquote().run();
      case "clear":
        return removeTrigger().clearNodes().unsetAllMarks().run();
      case "expand": {
        if (isExpanded) return false;
        if (!removeTrigger().run()) return false;
        openExpandedEditor();
        return true;
      }
      case "undo": {
        if (!target.can().undo()) return false;
        // prosemirror-history dispatches its own transaction and ignores the
        // chain's, so the trigger cannot be removed in the same step. The typed
        // trigger belongs to the newest history event, so this undo removes it.
        return target.chain().focus().undo().run();
      }
      case "paste.markdown": {
        // The clipboard read is async, so deletion waits for the insertion:
        // both leave in one chain once the text arrives, and the menu closes
        // now so the picked row responds immediately.
        slash.dismiss();
        void pasteQueryAsMarkdown(target, range);
        return true;
      }
      case "link": {
        // The menu only opens at a collapsed caret, so the only range worth
        // linking is an existing link under that caret. Anything else leaves
        // the trigger intact for the user to finish or dismiss.
        if (!target.isActive("link")) return false;
        // The trigger is deleted when the dialog opens, so cancelling leaves it
        // gone and saving the link is a second undo step: a dialog spanning two
        // transactions cannot be one.
        removeTrigger().run();
        applyLink();
        return true;
      }
      default:
        return false;
    }
  }

  async function pasteQueryAsMarkdown(target: Editor, range: { from: number; to: number }): Promise<void> {
    const generation = clipboardGeneration.current;
    const doc = target.state.doc;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (!target.isDestroyed && generation === clipboardGeneration.current) setStatus("Clipboard is unavailable");
      return;
    }
    if (target.isDestroyed || disabledRef.current || generation !== clipboardGeneration.current) return;
    if (text.trim() === "") {
      setStatus("Clipboard is empty");
      return;
    }
    if (target.state.doc !== doc) {
      setStatus("The selected text changed. Paste again.");
      return;
    }
    // One chain, one transaction: the trigger leaves and the parsed markdown
    // arrives together, so one undo restores the typed query.
    target.chain().focus()
      .command(({ tr }) => {
        closeHistory(tr);
        return true;
      })
      .deleteRange(range)
      .insertContentAt(range.from, markdownToTiptap(text))
      .run();
    finishOperation("Pasted as Markdown");
  }

  function openExpandedEditor() {
    if (disabledRef.current) return;
    const active = document.activeElement;
    // The inline route to full screen is the More menu, and its rows unmount
    // with the menu. Remember the trigger only when it survives; otherwise
    // focus returns to the always-mounted More slot instead of to <body>.
    overlayPreviouslyFocusedRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : moreButtonRef.current;
    setOpenMenu(null);
    setIsExpanded(true);
  }

  /** Runs an action picked from the rail's trailing menu. */
  function runMoreCommand(commandId: string): boolean {
    if (!editor || disabledRef.current) return false;
    // The menu is a picker, not a toggle panel: every row closes it.
    setOpenMenu(null);
    switch (commandId) {
      case "redo":
        if (!canRedo) return false;
        applyRedo();
        return true;
      case "list.number":
        applyList("ordered");
        return true;
      case "quote":
        applyQuote();
        return true;
      case "paste.markdown":
        void pasteClipboardAsMarkdown();
        return true;
      case "clear":
        applyClearAll();
        return true;
      case "expand":
        if (isExpanded) return false;
        openExpandedEditor();
        return true;
      default:
        return false;
    }
  }

  function pickMore(index: number): void {
    const command = moreCommands[index];
    if (command) runMoreCommand(command.id);
  }

  /** Arrow keys, Enter and Tab reach the More menu from the focused trigger. */
  function handleMoreKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab" && openMenu === "more") {
      // Closing without preventing default keeps Tab's focus move; a listbox
      // must not outlive the keyboard leaving it, matching the Block menu.
      setOpenMenu(null);
      return;
    }
    if (event.key === "Enter" && openMenu === "more") {
      event.preventDefault();
      const command = moreCommands[moreActiveIndex];
      if (command) runMoreCommand(command.id);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (openMenu !== "more") {
      lastMenuButtonRef.current = moreButtonRef.current;
      setMoreActive(event.key === "ArrowDown" ? 0 : Math.max(0, moreCommands.length - 1));
      setOpenMenu("more");
      return;
    }
    if (moreCommands.length === 0) return;
    setMoreActive((index) => {
      const current = Math.min(Math.max(index, 0), moreCommands.length - 1);
      return (current + (event.key === "ArrowDown" ? 1 : -1) + moreCommands.length) % moreCommands.length;
    });
  }

  function saveLink(href: string): string | null {
    if (disabledRef.current) return "The editor is currently read-only.";
    if (!editor || !linkSelection) return "Selection is no longer available.";
    if (!isSafeRichTextHref(href) || /\s/.test(href) || Array.from(href).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return "Enter a safe HTTP(S) URL.";
    const { from, to, doc, text } = linkSelection;
    if (editor.state.doc !== doc) {
      return "The selected text changed. Cancel and select it again.";
    }
    try {
      if (editor.state.doc.textBetween(from, to) !== text) {
        return "The selected text changed. Cancel and select it again.";
      }
    } catch {
      return "The selected text changed. Cancel and select it again.";
    }
    editor.chain().focus().setTextSelection({ from, to }).setLink({ href }).run();
    setLinkSelection(null);
    finishOperation("Link saved");
    queueMicrotask(() => editor.commands.focus());
    return null;
  }

  function removeLink() {
    if (!editor || !linkSelection || disabledRef.current) return;
    const { from, to, doc, text } = linkSelection;
    if (editor.state.doc === doc) {
      try {
        if (editor.state.doc.textBetween(from, to) === text) {
          editor.chain().focus().setTextSelection({ from, to }).unsetLink().run();
        }
      } catch {
        // Keep display text untouched when the range is stale.
      }
    }
    setLinkSelection(null);
    finishOperation("Link removed");
    queueMicrotask(() => editor.commands.focus());
  }

  const canUndo = editor?.can().chain().focus().undo().run() ?? false;
  const canRedo = editor?.can().chain().focus().redo().run() ?? false;
  // Keep Link enabled when a stashed word-range survives toolbar focus loss;
  // otherwise a collapsed visible selection would disable the button and the
  // pre-dialog range could never be applied.
  const linkDisabled = editor
    ? editor.state.selection.empty && !editor.isActive("link") && !validSavedRange()
    : true;

  // One editor instance serves the inline field and the full-screen overlay, so
  // the trigger is enabled wherever that editor is editable; gating on
  // `isExpanded` would switch the menu off exactly while it is on screen.
  const slash = useSlashCommands({
    editor,
    enabled: Boolean(editor) && !disabled,
    runCommand: runSlashCommand,
    // The menu is portalled outside this component's subtree; mark it so an
    // outside press can tell it apart from the form around it. Never key this
    // off the accessible name: renaming the menu must not make its rows dead.
    isMenuTarget: (target) =>
      target instanceof Element
      && target.closest("[data-formatting-menu]") !== null,
  });

  // A command that is guaranteed to no-op is not offered at all. Redo is never
  // offered here: typing the trigger is itself an addToHistory transaction, so
  // the redo stack is already empty before the row could act. Redo stays in the
  // trailing rail menu, where opening the menu is not an edit.
  const slashItems = useMemo(
    () => slash.items.filter((command) => {
      if (command.id === "redo") return false;
      if (command.id === "undo") return canUndo;
      return true;
    }),
    [slash.items, canUndo],
  );
  const slashActiveId = slash.items[slash.activeIndex]?.id;
  const slashActiveIndex = slashItems.length === 0
    ? -1
    : Math.max(0, slashItems.findIndex((command) => command.id === slashActiveId));

  /** Indices differ because unavailable history rows are filtered out. */
  function hookIndexFor(visibleIndex: number): number {
    const command = slashItems[visibleIndex];
    if (!command) return -1;
    return slash.items.findIndex((item) => item.id === command.id);
  }

  function acceptSlash(visibleIndex: number): boolean {
    const hookIndex = hookIndexFor(visibleIndex);
    if (hookIndex < 0) return false;
    return slash.accept(hookIndex);
  }

  function moveSlashActive(delta: number): void {
    if (slashItems.length === 0) return;
    const current = slashActiveIndex < 0 ? (delta > 0 ? -1 : 0) : slashActiveIndex;
    const next = ((current + delta) % slashItems.length + slashItems.length) % slashItems.length;
    const hookIndex = hookIndexFor(next);
    if (hookIndex >= 0) slash.setActiveIndex(hookIndex);
  }

  // The editor's key handler is created once, so it reads the live menu state
  // through a ref rather than a stale first render.
  const slashRef = useRef({
    open: false,
    items: slashItems,
    activeIndex: 0,
    move: moveSlashActive,
    accept: acceptSlash,
    dismiss: slash.dismiss,
  });
  slashRef.current = {
    open: slash.open,
    items: slashItems,
    activeIndex: slashActiveIndex,
    move: moveSlashActive,
    accept: acceptSlash,
    dismiss: slash.dismiss,
  };

  const moreCommands = useMemo(
    () => FORMATTING_COMMANDS.filter((command) => {
      if (!MORE_COMMAND_IDS.includes(command.id)) return false;
      if (command.id === "redo") return canRedo;
      if (command.id === "expand") return !isExpanded;
      return true;
    }),
    [canRedo, isExpanded],
  );
  const moreActiveIndex = moreCommands.length === 0 ? -1 : Math.min(moreActive, moreCommands.length - 1);

  // A typed slash query takes over from a rail menu that is already open.
  useEffect(() => {
    if (slash.open) setOpenMenu(null);
  }, [slash.open]);

  const currentBlock: "Body" | "Heading 1" | "Heading 2" | "Heading 3" =
    editor?.isActive("heading", { level: 1 }) ? "Heading 1"
    : editor?.isActive("heading", { level: 2 }) ? "Heading 2"
    : editor?.isActive("heading", { level: 3 }) ? "Heading 3"
    : "Body";
  const bulletActive = editor?.isActive("bulletList") ?? false;
  const boldActive = editor?.isActive("bold") ?? false;
  const italicActive = editor?.isActive("italic") ?? false;
  const linkActive = editor?.isActive("link") ?? false;

  const toolButtonCls = (active: boolean) =>
    `flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1 rounded-m3-xs px-2 text-on-surface-variant hover:bg-surface-container ${
      active ? "bg-surface-container-high text-on-surface outline outline-1 outline-outline" : ""
    }`;
  const menuItemCls =
    "flex min-h-[48px] w-full items-center gap-2 rounded-m3-xs px-3 text-left text-on-surface hover:bg-surface-container";

  /**
   * Where a rail menu points. The rail only exists above the IME, so its button
   * can vanish while the menu it opened is still up (Android dismisses the IME
   * as soon as the block menu takes focus). Fall back to the editor box — the
   * surface the menu acts on — instead of anchoring to a detached node.
   */
  function menuAnchorRect(button: HTMLButtonElement | null): DOMRect | null {
    if (button?.isConnected) return button.getBoundingClientRect();
    const dom = editor?.view.dom as HTMLElement | undefined;
    return dom?.isConnected ? dom.getBoundingClientRect() : null;
  }

  function toggleMenu(kind: "block" | "more", button: RefObject<HTMLButtonElement | null>) {
    if (disabledRef.current) return;
    if (openMenu === kind) {
      setOpenMenu(null);
    } else {
      lastMenuButtonRef.current = button.current;
      if (kind === "more") setMoreActive(0);
      setOpenMenu(kind);
    }
  }

  const blockOptions: Array<{ name: "Body" | "Heading 1" | "Heading 2" | "Heading 3"; kind: "body" | 1 | 2 | 3; preview: { fontSize: string; fontWeight: number } }> = [
    { name: "Body", kind: "body", preview: { fontSize: "1rem", fontWeight: 400 } },
    { name: "Heading 1", kind: 1, preview: { fontSize: "1.5rem", fontWeight: 700 } },
    { name: "Heading 2", kind: 2, preview: { fontSize: "1.25rem", fontWeight: 600 } },
    { name: "Heading 3", kind: 3, preview: { fontSize: "1.1rem", fontWeight: 600 } },
  ];

  /**
   * The rail's two portalled menus. They are rendered outside the rail on
   * purpose: only a proved soft keyboard docks the rail, and Android dismisses
   * the IME as soon as the Block menu takes focus. Unmounting the rail must not
   * take an open menu with it — the menu is anchored through `menuAnchorRect`,
   * which falls back to the editor box once the trigger is gone.
   */
  function renderRailMenus() {
    return (
      <>
        <FloatingMenu open={!disabled && openMenu === "block"} onClose={() => setOpenMenu(null)}
          triggerRef={blockButtonRef} getAnchorRect={() => menuAnchorRect(blockButtonRef.current)}
          label="Block type" placement="top">
          <div onKeyDown={handleMenuKeyDown}>
            {blockOptions.map((option) => {
              const checked = currentBlock === option.name;
              return <button key={option.name} type="button" role="menuitemradio" aria-checked={checked}
                aria-label={option.name} onClick={() => applyBlock(option.kind)} className={menuItemCls}>
                <span aria-hidden className="w-5 shrink-0">{checked ? "✓" : ""}</span>
                <span style={option.preview}>{option.name}</span>
              </button>;
            })}
          </div>
        </FloatingMenu>
        <FormattingMenu
          open={!disabled && openMenu === "more"}
          items={moreCommands}
          activeIndex={moreActiveIndex}
          getAnchorRect={() => menuAnchorRect(moreButtonRef.current)}
          onHover={setMoreActive}
          onPick={pickMore}
          label="More formatting actions"
        />
      </>
    );
  }

  function renderFormattingRail(inline: boolean) {
    // A read-only editor has no rail: a strip of disabled buttons is dead
    // chrome, and the full-screen route lives inside its More menu.
    if (disabled) return null;
    // Rail buttons keep their stable slot (no layout animation) and confirm
    // every press with a fast spring scale plus the active background.
    const action = (name: string, Icon: typeof Bold, onClick: () => void, active = false, unavailable = false) => (
      <motion.button type="button" title={name} aria-label={name} aria-pressed={active}
        disabled={!editor || disabled || unavailable} onClick={onClick} className={toolButtonCls(active)}
        whileTap={pressFeedback.rail} transition={{ duration: motionDurations.instant }}>
        <Icon size={18} aria-hidden />
      </motion.button>
    );
    // Preserve the caret and selection when a control is pressed, but let a
    // finger pan the narrow-width action row. Preventing pointerdown on the
    // scroller itself would turn horizontal overflow into a dead strip.
    const preventFocusLoss = (event: React.SyntheticEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button, a")) event.preventDefault();
    };
    // The block style is shown by its level, so the slot stays 48px wide
    // instead of spending 63px on a text label.
    const BlockTypeIcon = currentBlock === "Heading 1" ? Heading1
      : currentBlock === "Heading 2" ? Heading2
      : currentBlock === "Heading 3" ? Heading3
      : Pilcrow;
    return (
      <div ref={toolbarRef} data-testid="rich-text-rail" data-docked={inline ? "true" : undefined}
        className={`${inline ? "fixed inset-x-0" : "relative flex-shrink-0"} border-t border-outline-variant bg-surface-container px-2 shadow-[0_-4px_16px_rgba(0,0,0,0.12)]`}
        style={inline
          // The soft keyboard owns the bottom edge. `insetPx` is the covered
          // area measured once from the visual viewport: using it alone keeps
          // the rail exactly on the IME top, never a second subtraction.
          ? { bottom: `${softKeyboard.insetPx}px`, zIndex: INLINE_RAIL_Z_INDEX }
          // The overlay already ends at the IME top, so the rail is flush: no
          // bottom safe area and no spacer between it and the keyboard.
          : { paddingBottom: "0px" }}>
        {/* One action row. More stays outside the overflow scroller: at 320px
          the six composing slots can be panned, and the full command menu is
          always one visible tap away — no squeezed or clipped target. */}
        <div role="toolbar" aria-label={`${label} formatting`}
          className="flex flex-nowrap items-center gap-0.5"
          onPointerDownCapture={captureToolbarRange} onMouseDownCapture={captureToolbarRange} onTouchStartCapture={captureToolbarRange}
          onMouseDown={preventFocusLoss}
          onPointerDown={preventFocusLoss}>
          <div
            data-testid="rich-text-rail-scroll"
            role="group"
            aria-label={`${label} formatting actions`}
            tabIndex={0}
            className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain"
          >
            {action("Undo", Undo2, applyUndo, false, !canUndo)}
            <motion.button ref={blockButtonRef} type="button" title={`Block type: ${currentBlock}`}
              aria-label={`Block type: ${currentBlock}`} aria-haspopup="menu" aria-expanded={openMenu === "block"}
              disabled={!editor || disabled} onClick={() => toggleMenu("block", blockButtonRef)}
              className={toolButtonCls(currentBlock !== "Body")}
              whileTap={pressFeedback.rail} transition={{ duration: motionDurations.instant }}>
              <BlockTypeIcon size={18} aria-hidden />
            </motion.button>
            {action("Bold", Bold, () => toggleMarkWithSavedSelection("bold"), boldActive)}
            {action("Italic", Italic, () => toggleMarkWithSavedSelection("italic"), italicActive)}
            {action("Bullets", List, () => applyList("bullet"), bulletActive)}
            <motion.button ref={linkButtonRef} type="button" title={linkDisabled ? "Select text to add a link" : "Link"}
              aria-label="Link" aria-pressed={linkActive} disabled={!editor || disabled || linkDisabled}
              onClick={applyLink} className={toolButtonCls(linkActive)}
              whileTap={pressFeedback.rail} transition={{ duration: motionDurations.instant }}><Link2 size={18} aria-hidden /></motion.button>
          </div>
          <motion.button ref={moreButtonRef} type="button" title="More" aria-label="More"
            aria-haspopup="listbox" aria-expanded={openMenu === "more"}
            disabled={!editor || disabled} onClick={() => toggleMenu("more", moreButtonRef)}
            onKeyDown={handleMoreKeyDown} className={`${toolButtonCls(openMenu === "more")} shrink-0`}
            whileTap={pressFeedback.rail} transition={{ duration: motionDurations.instant }}>
            <MoreHorizontal size={18} aria-hidden />
          </motion.button>
        </div>
      </div>
    );
  }

  const countText =
    maxLength !== undefined
      ? `${counts.stored} / ${maxLength} ${counts.stored === 1 ? "character" : "characters"}${counts.stored !== counts.visible ? ` (${counts.visible} visible)` : ""}`
      : `${counts.stored} ${counts.stored === 1 ? "character" : "characters"}${counts.stored !== counts.visible ? ` (${counts.visible} visible)` : ""}`;

  const railActive = descriptionActive || railAnchored;
  // The rail is a keyboard companion, not permanent chrome: no proved soft
  // keyboard, no dock, even while a menu it opened is still up. That menu keeps
  // working from its own live anchor (menuAnchorRect), never from a rail left
  // behind over a keyboard that is gone.
  const showInlineRail = !disabled && !isExpanded && softKeyboard.open && railActive;
  const showExpandedRail = !disabled && isExpanded && softKeyboard.open;

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <span className="text-sm font-medium text-on-surface">{label}</span>
      <div
        className="relative"
        onPointerDown={handleEditorIntentionalInteraction}
        onTouchStart={handleEditorIntentionalInteraction}
        onKeyDown={handleEditorIntentionalInteraction}
      >
        {!isExpanded && <EditorContent editor={editor} />}
        {(!editor || empty) && placeholder && !isExpanded ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 px-3.5 py-3 text-base text-on-surface-variant">
            {placeholder}
          </div>
        ) : null}
      </div>
      {showHint && !isExpanded && (
        <p id={hintId} data-testid="rich-text-slash-hint" className="text-xs leading-5 text-on-surface-variant">
          Type <kbd className="rounded-m3-xs border border-outline-variant px-1 font-mono">/</kbd> for formatting
        </p>
      )}
      {showInlineRail && (
        // The rail is fixed to the IME top, so this in-flow dock keeps its old
        // height and opening the keyboard does not pull the fields below up.
        <div data-testid="rich-text-rail-dock" style={{ height: INLINE_RAIL_FLOW_HEIGHT_PX }}>
          {renderFormattingRail(true)}
        </div>
      )}
      {/* Independent of the rail: an open menu outlives a keyboard dismissal. */}
      {renderRailMenus()}
      <FormattingMenu
        open={!disabled && slash.open && slashItems.length > 0}
        items={slashItems}
        activeIndex={slashActiveIndex}
        getAnchorRect={slash.getAnchorRect}
        onHover={(index) => {
          const hookIndex = hookIndexFor(index);
          if (hookIndex >= 0) slash.setActiveIndex(hookIndex);
        }}
        onPick={acceptSlash}
        label="Formatting commands"
      />
      {linkSelection && <LinkSheet selection={linkSelection} triggerRef={linkButtonRef} fallbackElement={editor?.view.dom as HTMLElement | undefined} onCancel={() => setLinkSelection(null)} onSave={saveLink} onRemove={removeLink} />}
      {listNotice ? (
        <p role="status" aria-label="List simplification notice" className="text-xs text-on-surface-variant">
          Nested or multi-part list items are saved as a simple flat list.
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
      <span id={countId} role="status" aria-label="Character count" className="text-xs text-on-surface-variant">
        {countText}
      </span>
      {status ? (
        <span id={statusId} role="status" aria-label="Formatting status" className="text-xs text-on-surface-variant">
          {status}
        </span>
      ) : null}
      {isExpanded && createPortal(
        <div
          ref={setOverlayRef}
          id="report-editor-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-editor-overlay-title"
          tabIndex={-1}
          className="fixed inset-0 flex flex-col bg-surface"
          style={{
            zIndex: EDITOR_OVERLAY_Z_INDEX,
            height: "var(--fb-visible-height, 100vh)",
            top: "var(--fb-visible-top, 0)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <header
            className="grid grid-cols-[48px_minmax(0,1fr)_48px] items-center px-2 py-3 border-b border-outline-variant flex-shrink-0"
            // The overlay portal lives outside Shell's .fb-app-viewport, so it
            // takes the same safe-area owner token directly (no double padding:
            // shell insets never apply to this detached root).
            style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))" }}
          >
            <button
              type="button"
              aria-label="Close full-screen editor"
              onClick={() => setIsExpanded(false)}
              className="min-h-[48px] min-w-[48px] flex items-center justify-center"
            >
              <ArrowLeft size={20} aria-hidden />
            </button>
            <h2 id="report-editor-overlay-title" className="min-w-0 text-center text-base font-semibold [overflow-wrap:anywhere]">Description</h2>
            <button
              type="button"
              title="Done"
              aria-label="Done"
              onClick={() => setIsExpanded(false)}
              className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-m3-xs bg-primary text-on-primary"
            >
              <Check size={20} aria-hidden />
            </button>
          </header>
           <div
            data-testid="report-editor-scroller"
            className="fb-report-editor-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
            onPointerDown={handleEditorIntentionalInteraction} onTouchStart={handleEditorIntentionalInteraction} onKeyDown={handleEditorIntentionalInteraction}>
            <EditorContent editor={editor} />
          </div>
          {showHint && (
            // The inline hint is behind the modal, so the full-screen surface
            // carries the same fallback; only one of the two is ever mounted.
            <p
              id={hintId}
              data-testid="rich-text-slash-hint"
              className="flex-shrink-0 border-t border-outline-variant px-3 py-2 text-xs leading-5 text-on-surface-variant"
              style={{ paddingBottom: "max(8px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))" }}
            >
              Type <kbd className="rounded-m3-xs border border-outline-variant px-1 font-mono">/</kbd> for formatting
            </p>
          )}
          {showExpandedRail && renderFormattingRail(false)}
        </div>,
        document.body
      )}
    </div>
  );
}
