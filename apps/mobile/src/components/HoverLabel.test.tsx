// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HoverLabelProvider, HOVER_LABEL_MS, useHoverLabel } from "./HoverLabel";

function Probe({ label = "Save", placement }: { label?: string; placement?: "top" | "right" }) {
  const { hoverLabel } = useHoverLabel();
  return <button type="button" aria-label={label} {...hoverLabel(label, placement)}>{label}</button>;
}

function pill() {
  return document.querySelector(".fb-hover-label");
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

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

  it("records the requested edge for positioning", () => {
    vi.useFakeTimers();
    render(<HoverLabelProvider><Probe placement="right" /></HoverLabelProvider>);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS); });
    expect(pill()?.getAttribute("data-placement")).toBe("right");
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

  it("stays inert without a provider so a control mounted alone still works", () => {
    vi.useFakeTimers();
    render(<Probe />);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(HOVER_LABEL_MS * 4); });
    expect(pill()).toBeNull();
  });
});
