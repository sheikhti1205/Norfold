// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AttachmentTray, type AttachmentOption } from "./AttachmentTray";
import { consumeBackIntercept, resetBackInterceptors } from "./backNavigation";

afterEach(() => { cleanup(); resetBackInterceptors(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function options(onSelect: (id: string) => void = vi.fn()): AttachmentOption[] {
  return [
    { id: "photos", label: "Attach photo", icon: <span aria-hidden="true" />, onSelect: () => onSelect("photos") },
    { id: "camera", label: "Take photo", icon: <span aria-hidden="true" />, onSelect: () => onSelect("camera") },
  ];
}

it("rests as one disclosure control with no shortcuts inline", () => {
  render(<AttachmentTray options={options()} hasText={false} />);
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".fb-attachment-tray")?.getAttribute("data-expanded")).toBeNull();
  expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
});

it("expands the capability shortcuts inline, named and at the 40px target", () => {
  const onSelect = vi.fn();
  render(<AttachmentTray options={options(onSelect)} hasText={false} />);
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector(".fb-attachment-tray")?.getAttribute("data-expanded")).toBe("true");
  const photo = screen.getByRole("button", { name: "Attach photo" });
  expect(photo.className).toContain("fb-attachment-shortcut");
  fireEvent.click(photo);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("photos");
  // Picking a capability never folds the row by itself.
  expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
});

it("renders the per-surface extra last in the shortcut strip", () => {
  render(<AttachmentTray options={options()} hasText={false}
    extra={<button type="button" className="fb-attachment-shortcut" aria-label="Reference a report" />} />);
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  const strip = document.querySelector(".fb-attachment-shortcuts")!;
  const buttons = [...strip.querySelectorAll("button")];
  expect(buttons.at(-1)?.getAttribute("aria-label")).toBe("Reference a report");
});

it("folds as soon as a draft exists and restores the reader's choice when it empties", () => {
  const view = render(<AttachmentTray options={options()} hasText={false} text="" />);
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("button", { name: "Attach photo" })).toBeTruthy();

  view.rerender(<AttachmentTray options={options()} hasText text="a" />);
  expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add attachment" }).getAttribute("aria-expanded")).toBe("false");

  // Clearing restores the choice that the fold remembered.
  view.rerender(<AttachmentTray options={options()} hasText={false} text="" />);
  expect(screen.getByRole("button", { name: "Attach photo" })).toBeTruthy();
});

it("folds again on the next edit when the draft stays non-empty", () => {
  const view = render(<AttachmentTray options={options()} hasText text="a" />);
  // A press while text is present still opens the shortcuts; otherwise a photo
  // with a caption would be unreachable.
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("button", { name: "Attach photo" })).toBeTruthy();
  view.rerender(<AttachmentTray options={options()} hasText text="ab" />);
  expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
});

it("collapses on Escape and returns focus to the disclosure", () => {
  render(<AttachmentTray options={options()} hasText={false} />);
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  fireEvent.click(disclosure);
  const camera = screen.getByRole("button", { name: "Take photo" });
  camera.focus();
  const notCancelled = fireEvent.keyDown(camera, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
  expect(document.activeElement).toBe(disclosure);
  // The press is consumed: a sheet underneath must not also close.
  expect(notCancelled).toBe(false);
});

it("folds on Android Back, consuming the press only while it is open", () => {
  render(<AttachmentTray options={options()} hasText={false} />);
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  expect(consumeBackIntercept()).toBe(false);
  fireEvent.click(disclosure);
  let handled = false;
  act(() => { handled = consumeBackIntercept(); });
  expect(handled).toBe(true);
  expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
  expect(document.activeElement).toBe(disclosure);
  // A second press belongs to the surface again.
  expect(consumeBackIntercept()).toBe(false);
});

it("cannot be opened while the surface disables attachments", () => {
  render(<AttachmentTray options={options()} hasText={false} disabled />);
  const disclosure = screen.getByRole("button", { name: "Add attachment" }) as HTMLButtonElement;
  expect(disclosure.disabled).toBe(true);
  fireEvent.click(disclosure);
  expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
});

/**
 * jsdom has no layout pass and no ResizeObserver. This fake reports the
 * composer width the tray observes, so the presentation decision is exercised
 * the way the browser drives it instead of assumed from the stylesheet.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly callback: ResizeObserverCallback;
  private target: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void { this.target = target; }
  unobserve(): void {}
  disconnect(): void { this.target = null; }

  report(width: number): void {
    this.callback(
      [{ target: this.target, contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

/** The tray mounted in the composer it measures, with the observer captured. */
function renderInComposer(children: ReactNode) {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const view = render(<form className="fb-composer-shell">{children}</form>);
  const observer = FakeResizeObserver.instances[0];
  if (!observer) throw new Error("the tray did not observe its composer");
  return { view, observer };
}

it("keeps today's inline strip when nothing can be measured", () => {
  // No ResizeObserver and no composer ancestor: the fallback must be the exact
  // wide row, with no popup affordance and no presentation attribute.
  render(<AttachmentTray options={options()} hasText={false} />);
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  expect(disclosure.getAttribute("aria-haspopup")).toBeNull();
  expect(document.querySelector(".fb-attachment-tray")?.getAttribute("data-presentation")).toBeNull();
  fireEvent.click(disclosure);
  expect(document.querySelector(".fb-attachment-shortcuts")).toBeTruthy();
  expect(document.querySelector(".fb-attachment-menu")).toBeNull();
  expect(screen.getByRole("button", { name: "Attach photo" }).className).toContain("fb-attachment-shortcut");
});

it("opens a labelled in-place list when the composer cannot hold the inline row", () => {
  const onSelect = vi.fn();
  const { observer } = renderInComposer(<AttachmentTray options={options(onSelect)} hasText={false} />);
  act(() => observer.report(300));

  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  expect(document.querySelector(".fb-attachment-tray")?.getAttribute("data-presentation")).toBe("narrow");
  expect(disclosure.getAttribute("aria-haspopup")).toBe("menu");
  // Collapsed: one control, no list.
  expect(screen.queryByRole("menu")).toBeNull();

  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  const list = screen.getByRole("menu", { name: "Add attachment" });
  expect(list.className).toContain("fb-picker-layer");
  // Every capability is visible with its name, and none is an inline glyph.
  expect(screen.getByText("Attach photo")).toBeTruthy();
  expect(screen.getByText("Take photo")).toBeTruthy();
  expect(document.querySelector(".fb-attachment-shortcuts")).toBeNull();
  expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
});

it("reads the composer width once on mount, before the observer reports", () => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 280 } as DOMRect);
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  render(<form className="fb-composer-shell"><AttachmentTray options={options()} hasText={false} /></form>);
  expect(document.querySelector(".fb-attachment-tray")?.getAttribute("data-presentation")).toBe("narrow");
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("menu", { name: "Add attachment" })).toBeTruthy();
});

it("runs the chosen capability and closes the narrow list", () => {
  const onSelect = vi.fn();
  const { observer } = renderInComposer(<AttachmentTray options={options(onSelect)} hasText={false} />);
  act(() => observer.report(300));
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  fireEvent.click(disclosure);

  fireEvent.click(screen.getByRole("menuitem", { name: "Attach photo" }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("photos");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
});

it("closes the narrow list on Escape and returns focus to the disclosure", () => {
  const { observer } = renderInComposer(<AttachmentTray options={options()} hasText={false} />);
  act(() => observer.report(300));
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  fireEvent.click(disclosure);
  const row = screen.getByRole("menuitem", { name: "Take photo" });
  row.focus();
  const notCancelled = fireEvent.keyDown(row, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(disclosure);
  // The press belongs to the list, not to a surface underneath it.
  expect(notCancelled).toBe(false);
});

it("closes the narrow list on Android Back, consuming the press only while it is open", () => {
  const { observer } = renderInComposer(<AttachmentTray options={options()} hasText={false} />);
  act(() => observer.report(300));
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  expect(consumeBackIntercept()).toBe(false);
  fireEvent.click(disclosure);
  let handled = false;
  act(() => { handled = consumeBackIntercept(); });
  expect(handled).toBe(true);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(disclosure);
  expect(consumeBackIntercept()).toBe(false);
});

it("keeps the sticky inline strip when the composer is wide enough", () => {
  const { observer } = renderInComposer(<AttachmentTray options={options()} hasText={false} />);
  act(() => observer.report(640));
  const disclosure = screen.getByRole("button", { name: "Add attachment" });
  expect(document.querySelector(".fb-attachment-tray")?.getAttribute("data-presentation")).toBeNull();
  expect(disclosure.getAttribute("aria-haspopup")).toBeNull();
  fireEvent.click(disclosure);
  expect(document.querySelector(".fb-attachment-shortcuts")).toBeTruthy();
  expect(document.querySelector(".fb-attachment-menu")).toBeNull();
  expect(screen.getByRole("button", { name: "Attach photo" }).className).toContain("fb-attachment-shortcut");
});

it("closes the narrow list when the draft gains text and never restores it", () => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const view = render(
    <form className="fb-composer-shell"><AttachmentTray options={options()} hasText={false} text="" /></form>,
  );
  const observer = FakeResizeObserver.instances[0]!;
  act(() => observer.report(300));
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("menu")).toBeTruthy();

  view.rerender(
    <form className="fb-composer-shell"><AttachmentTray options={options()} hasText text="a" /></form>,
  );
  expect(screen.queryByRole("menu")).toBeNull();

  // A menu is not the sticky cluster: an empty field does not reopen it.
  view.rerender(
    <form className="fb-composer-shell"><AttachmentTray options={options()} hasText={false} text="" /></form>,
  );
  expect(screen.queryByRole("menu")).toBeNull();
});

it("never renders the narrow list while collapsed or when the surface disables attachments", () => {
  const { observer } = renderInComposer(<AttachmentTray options={options()} hasText={false} disabled />);
  act(() => observer.report(300));
  const disclosure = screen.getByRole("button", { name: "Add attachment" }) as HTMLButtonElement;
  expect(disclosure.disabled).toBe(true);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(disclosure);
  expect(screen.queryByRole("menu")).toBeNull();
});
