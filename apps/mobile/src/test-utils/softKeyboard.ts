import { act, render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * A stand-in for a real soft keyboard on a mobile viewport.
 *
 * The editor rail is only allowed above a keyboard that can be proved from
 * viewport geometry, so a rail test has to install that geometry before the
 * component mounts. jsdom ships no `visualViewport`; this is the same shape the
 * app's keyboard hook reads in a browser (a smaller visible height with no
 * layout-viewport change).
 */
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

/** Visible-height loss that a keyboard causes, not browser chrome (which is tens of px). */
export const TEST_KEYBOARD_COVER_PX = 300;

export function openSoftKeyboard(coverPx = TEST_KEYBOARD_COVER_PX): void {
  const viewport = new EventTarget() as VisualViewport;
  Object.defineProperties(viewport, {
    height: { configurable: true, writable: true, value: Math.max(1, window.innerHeight - coverPx) },
    offsetTop: { configurable: true, writable: true, value: 0 },
    scale: { configurable: true, writable: true, value: 1 },
  });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
}

export function closeSoftKeyboard(): void {
  delete (window as { visualViewport?: unknown }).visualViewport;
}

export function restoreSoftKeyboard(): void {
  if (originalVisualViewport) {
    Object.defineProperty(window, "visualViewport", originalVisualViewport);
  } else {
    closeSoftKeyboard();
  }
}

/** Focus the description contenteditable the way a tap does. */
export function focusDescriptionEditor(): void {
  const textbox = document.querySelector(".tiptap") as HTMLElement | null;
  if (textbox) act(() => textbox.focus());
}

/**
 * Render a surface and focus its Description editor — the state a tap leaves
 * behind. A soft keyboard cannot be open without a focused field, and the rail
 * is only shown to the field that owns focus, so a keyboard harness has to
 * reproduce the focus it is pretending to have.
 */
export function renderFocused(ui: ReactElement): RenderResult {
  const result = render(ui);
  focusDescriptionEditor();
  return result;
}
