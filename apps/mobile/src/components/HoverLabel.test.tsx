// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HoverLabelProvider, HOVER_LABEL_MS, useHoverLabel } from "./HoverLabel";

function Probe({ label = "Save", placement }: { label?: string; placement?: "top" | "right" }) {
  const { hoverLabel } = useHoverLabel();
  return <button type="button" aria-label={label} {...hoverLabel(label, placement)}>{label}</button>;
}

function pill() {
  return document.querySelector<HTMLElement>(".fb-hover-label");
}

function stubPointer(fine: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: fine,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => stubPointer(true));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("shared hover label", () => {
  it("waits for the 180ms dwell before naming the control", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(pill()).toBeNull();
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS - 1); });
    expect(pill()).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(pill()?.textContent).toBe("Save");
    // A visual duplicate of the accessible name, never a second announcement.
    expect(pill()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hides the moment the pointer leaves", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()).not.toBeNull();
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    expect(pill()).toBeNull();
  });

  it("repaints instantly when the pointer moves to a neighbouring control", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe label="Like" /><Probe label="Dislike" /></HoverLabelProvider>);
    const like = screen.getByRole("button", { name: "Like" });
    const dislike = screen.getByRole("button", { name: "Dislike" });
    fireEvent.pointerEnter(like, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()?.textContent).toBe("Like");
    fireEvent.pointerLeave(like, { pointerType: "mouse" });
    // No second dwell inside the same cluster: the reader already asked.
    fireEvent.pointerEnter(dislike, { pointerType: "mouse" });
    expect(pill()?.textContent).toBe("Dislike");
  });

  it("never names a control for a touch pointer", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS * 4); });
    expect(pill()).toBeNull();
  });

  it("skips named drawer rows without suppressing labels outside the drawer", () => {
    vi.useFakeTimers();
    function DrawerRow() {
      const { hoverLabel } = useHoverLabel();
      return <button className="fb-nav-link" {...hoverLabel("Account", "right")}>Account</button>;
    }
    render(<HoverLabelProvider><div className="fb-nav-drawer"><nav className="fb-nav-rail" data-pinned="true"><DrawerRow /></nav></div><Probe label="Close settings" /></HoverLabelProvider>);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Account" }), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()).toBeNull();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Close settings" }), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()?.textContent).toBe("Close settings");
  });

  it("never renders on a coarse pointer, whatever the event claims", () => {
    stubPointer(false);
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    // A compatibility mouse event on a touch screen still must not paint a
    // name: the capability, not the event, decides.
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS * 4); });
    expect(pill()).toBeNull();
  });

  it("records the requested edge for positioning", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe placement="right" /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()?.getAttribute("data-placement")).toBe("right");
  });

  it("drops below a control that has no room above it", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    // jsdom reports every rect at 0,0, so the top edge has no room; the pill
    // must flip under the control instead of running off the viewport.
    expect(pill()?.style.transform).toBe("translate(-50%, 0)");
  });

  it("keeps a flipped label inside the bottom viewport edge", () => {
    const original = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("fb-hover-label") ? rect(0, 0, 80, 60) : rect(20, 20, 44, 44);
    });
    try {
      vi.useFakeTimers();
      render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
      fireEvent.pointerEnter(screen.getByRole("button", { name: "Save" }), { pointerType: "mouse" });
      act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
      expect(pill()?.style.top).toBe("32px");
      expect(pill()?.style.transform).toBe("translate(-50%, 0)");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: original });
    }
  });

  it("clamps a centred pill after its transform, not before", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      // A 44px control against the left edge; the 288px pill (18rem) is wider
      // than the room to its left.
      return this.classList.contains("fb-hover-label")
        ? rect(0, 0, 288, 43)
        : rect(0, 120, 44, 44);
    });
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    const element = pill()!;
    const left = Number.parseFloat(element.style.left);
    // The visual left edge is `left - width / 2`; it must sit at the 8px pad,
    // never at a negative x over the rail.
    expect(left - 288 / 2).toBe(8);
    expect(element.style.transform).toBe("translate(-50%, -100%)");
  });

  it("keeps a pill wider than the viewport inside the pad on both sides", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("fb-hover-label")) return rect(0, 120, 44, 44);
      // The measured width follows the inline cap the provider applies.
      const cap = this.style.maxWidth ? Number.parseFloat(this.style.maxWidth) : 600;
      return rect(0, 0, Math.min(600, cap), 43);
    });
    try {
      vi.useFakeTimers();
      render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
      const button = screen.getByRole("button", { name: "Save" });
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
      const element = pill()!;
      expect(element.style.maxWidth).toBe("304px");
      const left = Number.parseFloat(element.style.left);
      expect(left - 304 / 2).toBe(8);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });

  it("dismisses on Escape and on scroll", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(pill()).toBeNull();

    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()).not.toBeNull();
    fireEvent.scroll(window);
    expect(pill()).toBeNull();
  });

  it("clears when an overlay opens instead of floating over it", async () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()).not.toBeNull();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Photo viewer");
    // MutationObserver delivery is a microtask by spec; awaiting act lets the
    // dismissal commit before the assertion, exactly as the sibling test does.
    await act(async () => { document.body.appendChild(dialog); });
    expect(pill()).toBeNull();
    dialog.remove();
  });

  it("cancels a pending dwell when an overlay opens", async () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Save" }), { pointerType: "mouse" });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    await act(async () => { document.body.appendChild(dialog); });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()).toBeNull();
    dialog.remove();
  });

  it("clears on any press before the next surface can use the pointer", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(pill()).toBeNull();
  });

  it("stays inert without a provider so a control mounted alone still works", () => {
    vi.useFakeTimers();
    render(<Probe />);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS * 4); });
    expect(pill()).toBeNull();
  });
});
