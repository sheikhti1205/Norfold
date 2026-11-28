// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { RichTextEditor } from "./RichTextEditor";
import { polyfillRangeGeometry, restoreRangeGeometry } from "../test-utils/jsdomRangeGeometry";
import { closeSoftKeyboard, renderFocused, restoreSoftKeyboard } from "../test-utils/softKeyboard";

/**
 * The Android shell answers *whether* its IME is open; the WebView answers
 * *where* it ends. These tests drive the bridge with the readings the device
 * actually reports, above all the one that used to double-subtract: the shell
 * proves the keyboard is up while the window has already been resized to the
 * IME's top edge, so there is no CSS offset left to apply.
 */
const shell = vi.hoisted(() => ({
  reading: { known: false, visible: false },
  listeners: new Set<(state: { known: boolean; visible: boolean }) => void>(),
}));

vi.mock("../native/ime", () => ({
  subscribeNativeIme: (sink: (state: { known: boolean; visible: boolean }) => void) => {
    shell.listeners.add(sink);
    sink(shell.reading);
    return () => {
      shell.listeners.delete(sink);
    };
  },
}));

function setNativeReading(reading: { known: boolean; visible: boolean }): void {
  shell.reading = reading;
  act(() => {
    for (const listener of shell.listeners) listener(reading);
  });
}

/** The geometry a browser reports: an overlaying keyboard shrinks only this. */
function installViewport(height: number): void {
  const viewport = new EventTarget() as VisualViewport;
  Object.defineProperties(viewport, {
    height: { configurable: true, writable: true, value: height },
    offsetTop: { configurable: true, writable: true, value: 0 },
    scale: { configurable: true, writable: true, value: 1 },
  });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
}

/** Override one window metric and return the undo for the current test. */
function setMetric(metric: "innerHeight" | "innerWidth", value: number): () => void {
  const original = Object.getOwnPropertyDescriptor(window, metric);
  Object.defineProperty(window, metric, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(window, metric, original);
    else delete (window as unknown as Record<"innerHeight" | "innerWidth", number | undefined>)[metric];
  };
}

function stubCoarsePointer(coarse: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return () => Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
}

function toolbar(): HTMLElement | null {
  return screen.queryByRole("toolbar", { name: "Description formatting" });
}

function railShell(): HTMLElement | null {
  return document.querySelector('[data-testid="rich-text-rail"]');
}

function slashHint(): HTMLElement | null {
  return screen.queryByTestId("rich-text-slash-hint");
}

// File-level, not per test: ProseMirror's MutationObserver flush can run after an
// individual test's teardown, so a per-test window would leave the same hole.
beforeAll(polyfillRangeGeometry);
afterAll(restoreRangeGeometry);

beforeEach(() => {
  shell.reading = { known: false, visible: false };
  shell.listeners.clear();
  closeSoftKeyboard();
});

afterEach(() => {
  cleanup();
  restoreSoftKeyboard();
  shell.listeners.clear();
});

describe("RichTextEditor rail — native IME visibility, WebView placement", () => {
  it("docks the rail flush when the shell reports an IME on an already-resized window", () => {
    // The device reading: the window has resized to 582 and the visible height
    // equals it. Only the shell can say the IME is up, and nothing is left to
    // subtract — a raw root inset here would lift the rail into the form.
    const restoreHeight = setMetric("innerHeight", 582);
    installViewport(582);
    shell.reading = { known: true, visible: true };
    try {
      renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);

      expect(toolbar()).toBeTruthy();
      expect(railShell()?.style.bottom).toBe("0px");
      expect(screen.getByTestId("rich-text-rail-dock").style.height).toBe("49px");
      expect(slashHint()).toBeNull();
    } finally {
      restoreHeight();
    }
  });

  it("keeps the rail through a width and orientation change while the shell still reports the IME", () => {
    const restoreWidth = setMetric("innerWidth", 400);
    const restoreHeight = setMetric("innerHeight", 800);
    const originalOrientation = Object.getOwnPropertyDescriptor(window.screen, "orientation");
    const setAngle = (angle: number) => {
      Object.defineProperty(window.screen, "orientation", {
        configurable: true,
        value: { angle, type: angle === 90 ? "landscape-primary" : "portrait-primary" },
      });
    };
    installViewport(800);
    shell.reading = { known: true, visible: true };
    setAngle(0);
    try {
      renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      expect(toolbar()).toBeTruthy();

      // Rotation resets the layout baseline. Native visibility, not that
      // baseline, is what keeps the rail on screen.
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 800 });
      setAngle(90);
      act(() => window.dispatchEvent(new Event("orientationchange")));
      expect(toolbar()).toBeTruthy();
      expect(railShell()?.style.bottom).toBe("0px");

      setNativeReading({ known: true, visible: true });
      expect(toolbar()).toBeTruthy();
      expect(slashHint()).toBeNull();
    } finally {
      restoreWidth();
      restoreHeight();
      if (originalOrientation) {
        Object.defineProperty(window.screen, "orientation", originalOrientation);
      } else {
        delete (window.screen as { orientation?: unknown }).orientation;
      }
    }
  });

  it("places the rail on the WebView's own measured occlusion when the IME overlays the page", () => {
    // Native proves the keyboard; the visual viewport says the page is covered
    // by 300px, so that band is the only offset applied.
    installViewport(window.innerHeight - 300);
    shell.reading = { known: true, visible: true };

    renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);

    expect(toolbar()).toBeTruthy();
    expect(railShell()?.style.bottom).toBe("300px");
    expect(railShell()?.style.bottom).not.toBe(`${window.innerHeight}px`);
  });

  it("removes the rail the moment the shell reports the IME gone, and returns it when it is back", () => {
    installViewport(window.innerHeight - 300);
    shell.reading = { known: true, visible: true };
    renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    expect(toolbar()).toBeTruthy();

    setNativeReading({ known: true, visible: false });
    expect(toolbar()).toBeNull();
    expect(railShell()).toBeNull();
    expect(screen.queryByTestId("rich-text-rail-dock")).toBeNull();
    // Still focused, no keyboard: the slash hint is the honest fallback.
    expect(slashHint()).toBeTruthy();

    setNativeReading({ known: true, visible: true });
    expect(toolbar()).toBeTruthy();
    expect(slashHint()).toBeNull();
  });

  it("never shows the rail for a shell that reports no IME, even when the layout shrink looks like one", () => {
    const restoreWidth = setMetric("innerWidth", 400);
    const restoreHeight = setMetric("innerHeight", 800);
    const restoreMatchMedia = stubCoarsePointer(true);
    // The native answer is authoritative: a hardware keyboard can leave the
    // layout alone, and a shell with no IME must not inherit the web fallback's
    // guess from a coarse-pointer layout loss.
    shell.reading = { known: true, visible: false };
    try {
      renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      expect(toolbar()).toBeNull();
      expect(slashHint()).toBeTruthy();

      Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 520 });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(toolbar()).toBeNull();

      // Control: the same geometry with no native reading is exactly the web
      // fallback's resizing-keyboard case, so the stubs above are meaningful.
      setNativeReading({ known: false, visible: false });
      expect(toolbar()).toBeTruthy();
      expect(railShell()?.style.bottom).toBe("0px");
    } finally {
      restoreWidth();
      restoreHeight();
      restoreMatchMedia();
    }
  });
});
