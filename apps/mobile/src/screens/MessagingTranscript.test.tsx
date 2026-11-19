// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptAnchor, type TranscriptFollow } from "../hooks/useTranscriptAnchor";

/**
 * Reading-position ownership for the message transcript.
 *
 * jsdom has no layout engine, so this file supplies a deterministic geometry
 * model: ordered rows with heights, a scroll viewport, and the same DOM signals
 * the hook consumes (scroll, capture-phase load, ResizeObserver,
 * visibilitychange and resize). Frames are queued with real ids and only run on
 * an explicit flush, so coalescing, cancellation, bursts and a reader who moves
 * before the browser delivers their scroll event are all observable. The hook
 * is imported directly, not through Messaging, so this file does not load the
 * screen, runtime or native graph. Rendered pixels remain a deployed-browser
 * acceptance item.
 */

interface RowModel {
  id: string;
  height: number;
}

const GAP = 10;

const layout = {
  rows: [] as RowModel[],
  clientHeight: 300,
  scrollTop: new WeakMap<HTMLElement, number>(),
};

function contentHeight() {
  return layout.rows.reduce((total, row) => total + row.height, 0)
    + Math.max(0, layout.rows.length - 1) * GAP;
}

function rowTop(index: number) {
  let top = 0;
  for (let before = 0; before < index; before += 1) top += layout.rows[before]!.height + GAP;
  return top;
}

function rect(top: number, height: number) {
  return {
    x: 0, y: top, top, left: 0, bottom: top + height, right: 1000, width: 1000, height,
    toJSON: () => ({}),
  } as DOMRect;
}

Object.defineProperty(HTMLElement.prototype, "scrollTop", {
  configurable: true,
  get(this: HTMLElement) { return layout.scrollTop.get(this) ?? 0; },
  set(this: HTMLElement, value: number) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    layout.scrollTop.set(this, Math.max(0, Math.min(value, max)));
  },
});

Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get(this: HTMLElement) { return this.classList.contains("fb-chat-messages") ? contentHeight() : 0; },
});

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get(this: HTMLElement) { return this.classList.contains("fb-chat-messages") ? layout.clientHeight : 0; },
});

HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  if (this.classList.contains("fb-chat-messages")) return rect(0, layout.clientHeight);
  const id = this.dataset.chatMessage;
  if (!id) return rect(0, 0);
  const index = layout.rows.findIndex((row) => row.id === id);
  if (index < 0) return rect(0, 0);
  const area = document.querySelector<HTMLElement>(".fb-chat-messages");
  const offset = area ? (layout.scrollTop.get(area) ?? 0) : 0;
  return rect(rowTop(index) - offset, layout.rows[index]!.height);
};

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  callback: ResizeObserverCallback;
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
  fire() { if (!this.disconnected) this.callback([], this as unknown as ResizeObserver); }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let frameRequests = 0;

interface HarnessApi {
  distance: number;
  following: TranscriptFollow["following"] | null;
  suspend: () => void;
  followLatest: () => void;
}

function Transcript({ ids, conversationKey = "account:chat", enabled = true, api }: {
  ids: string[];
  conversationKey?: string;
  enabled?: boolean;
  api: HarnessApi;
}) {
  const container = useRef<HTMLDivElement>(null);
  const follow: TranscriptFollow = useTranscriptAnchor({
    container,
    conversationKey,
    messageIds: ids,
    enabled,
    onDistance: (distance) => { api.distance = distance; },
  });
  api.following = follow.following;
  api.suspend = follow.suspend;
  api.followLatest = follow.followLatest;
  return <div className="fb-chat-messages" ref={container}>
    <div className="fb-chat-transcript">
      {ids.map((id) => <div key={id} data-chat-message={id} />)}
    </div>
  </div>;
}

function scroller() {
  return document.querySelector<HTMLElement>(".fb-chat-messages")!;
}

function maxScroll() {
  return Math.max(0, contentHeight() - layout.clientHeight);
}

/** Move the area without telling the hook: the browser's event is still in
 *  flight, which is exactly the window the repair has to survive. */
function place(value: number) {
  act(() => { scroller().scrollTop = value; });
}

/** Deliver the scroll event for the current position. */
function emitScroll() {
  act(() => { scroller().dispatchEvent(new Event("scroll")); });
}

function scrollTo(value: number) {
  place(value);
  emitScroll();
}

function fireObservers() {
  act(() => {
    for (const observer of TestResizeObserver.instances) observer.fire();
  });
}

function flushFrames() {
  act(() => {
    let guard = 0;
    while (frames.size > 0) {
      if (guard > 20) throw new Error("frame callbacks keep re-queueing");
      guard += 1;
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(0);
    }
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

let api: HarnessApi;

beforeEach(() => {
  layout.rows = [
    { id: "a", height: 200 },
    { id: "b", height: 200 },
    { id: "c", height: 200 },
  ];
  layout.clientHeight = 300;
  layout.scrollTop = new WeakMap();
  TestResizeObserver.instances = [];
  frames.clear();
  nextFrameId = 1;
  frameRequests = 0;
  api = { distance: 0, following: null, suspend: () => undefined, followLatest: () => undefined };
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameRequests += 1;
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility("visible");
  frames.clear();
});

describe("transcript reading-position ownership", () => {
  it("pins the newest message for a reader who is already following", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    expect(scroller().scrollTop).toBe(maxScroll());
    expect(api.following?.current).toBe(true);
  });

  it("keeps the message being read fixed when media above grows", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    expect(api.following?.current).toBe(false);
    // A decoded image in row a grows its box; no message id changes.
    layout.rows[0]!.height += 121;
    fireObservers();
    flushFrames();
    expect(scroller().scrollTop).toBe(371);
    expect(api.following?.current).toBe(false);
  });

  it("keeps the message being read fixed when content above shrinks", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    // 250 of 320: the reader sits 70px above the end and owns the position.
    scrollTo(250);
    expect(api.following?.current).toBe(false);
    layout.rows[0]!.height -= 61;
    // The shrink alone leaves the reader 9px from the end. That is a relayout,
    // not a request to follow, and no scroll event has been delivered, so the
    // saved anchor must not be rebased before the correction runs.
    fireObservers();
    flushFrames();
    expect(api.following?.current).toBe(false);
    expect(scroller().scrollTop).toBe(189);
  });

  it("does not adopt a browser clamp as the saved row", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    expect(api.following?.current).toBe(false);
    // The shrink takes the maximum below the reading point, so the browser has
    // already clamped 250 to 220. Its scroll event is still queued; the frame
    // sees the clamp first and must not rebase the row it saved at 250.
    layout.rows[0]!.height -= 100;
    place(220);
    fireObservers();
    flushFrames();
    // The saved row keeps the reader's 70px distance instead of pinning them to
    // the new end of a shorter thread.
    expect(scroller().scrollTop).toBe(150);
    expect(api.following?.current).toBe(false);
  });

  it("relatches only when the reader scrolls back to the end", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    expect(api.following?.current).toBe(false);
    // The reader's own downward move into the band restores follow; distance
    // measured from a relayout never does.
    scrollTo(320);
    expect(api.following?.current).toBe(true);
    layout.rows.push({ id: "d", height: 200 });
    view.rerender(<Transcript ids={["a", "b", "c", "d"]} api={api} />);
    expect(scroller().scrollTop).toBe(maxScroll());
  });

  it("keeps follow through its own clamp echo after a shrink", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    expect(api.following?.current).toBe(true);
    layout.rows[0]!.height -= 61;
    fireObservers();
    flushFrames();
    // The pin clamped 320 down to 259 because the thread got shorter.
    expect(scroller().scrollTop).toBe(259);
    expect(api.following?.current).toBe(true);
    // The browser's event for that owned write arrives late and must read as an
    // echo, not as the reader giving up the end.
    emitScroll();
    expect(api.following?.current).toBe(true);
    layout.rows.push({ id: "d", height: 200 });
    view.rerender(<Transcript ids={["a", "b", "c", "d"]} api={api} />);
    expect(scroller().scrollTop).toBe(maxScroll());
  });

  it("never moves the reader for late content below the saved row", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.rows.push({ id: "d", height: 200 });
    view.rerender(<Transcript ids={["a", "b", "c", "d"]} api={api} />);
    fireObservers();
    flushFrames();
    expect(scroller().scrollTop).toBe(250);
    expect(api.following?.current).toBe(false);
  });

  it("follows a new arrival only when the reader is at the bottom", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    layout.rows.push({ id: "d", height: 200 });
    view.rerender(<Transcript ids={["a", "b", "c", "d"]} api={api} />);
    expect(scroller().scrollTop).toBe(maxScroll());
  });

  it("lets an upward scroll win over a new arrival", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.rows.push({ id: "d", height: 200 });
    view.rerender(<Transcript ids={["a", "b", "c", "d"]} api={api} />);
    fireObservers();
    flushFrames();
    expect(scroller().scrollTop).toBe(250);
    expect(api.following?.current).toBe(false);
  });

  it("restores the reading point when the tab becomes visible again", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.rows[0]!.height += 121;
    setVisibility("hidden");
    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(scroller().scrollTop).toBe(371);
  });

  it("restores the reading point after a viewport resize", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.clientHeight = 260;
    layout.rows[0]!.height += 40;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(scroller().scrollTop).toBe(290);
  });

  it("lets an explicit jump supersede the saved anchor", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    api.suspend();
    layout.rows[0]!.height += 121;
    fireObservers();
    flushFrames();
    // The jump owns the position now; the old row is not restored.
    expect(scroller().scrollTop).toBe(250);
    scrollTo(0);
    layout.rows[1]!.height += 80;
    fireObservers();
    flushFrames();
    expect(scroller().scrollTop).toBe(0);
  });

  it("lets the floating control follow the newest message again", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(0);
    api.followLatest();
    layout.rows.push({ id: "d", height: 200 });
    view.rerender(<Transcript ids={["a", "b", "c", "d"]} api={api} />);
    expect(scroller().scrollTop).toBe(maxScroll());
  });

  it("adopts its own pin as the baseline so a delayed event cannot mask a move", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    layout.rows[0]!.height += 220;
    fireObservers();
    flushFrames();
    // The follow pin moved the area from 320 to 540.
    expect(scroller().scrollTop).toBe(540);
    expect(api.following?.current).toBe(true);
    // The browser only now delivers the event for the pin's own write.
    emitScroll();
    expect(api.following?.current).toBe(true);
    // A real move up afterwards must still be measured from 540, not 320.
    place(440);
    emitScroll();
    expect(api.following?.current).toBe(false);
  });

  it("lets an unobserved upward move beat a queued pin", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    layout.rows[0]!.height += 220;
    fireObservers();
    // The reader scrolls back up before the queued frame runs and before their
    // scroll event is delivered, so the pending pin must not reclaim the end.
    place(200);
    flushFrames();
    expect(scroller().scrollTop).toBe(200);
    expect(api.following?.current).toBe(false);
  });

  it("coalesces a burst of reflows into one frame", () => {
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.rows[0]!.height += 121;
    frameRequests = 0;
    fireObservers();
    fireObservers();
    fireObservers();
    expect(frameRequests).toBe(1);
    flushFrames();
    expect(scroller().scrollTop).toBe(371);
  });

  it("cancels queued work on unmount", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    const area = scroller();
    layout.rows[0]!.height += 121;
    fireObservers();
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(TestResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    flushFrames();
    expect(area.scrollTop).toBe(250);
  });

  it("does not restore the previous thread when the switch lands before the frame", () => {
    const view = render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.rows[0]!.height += 121;
    fireObservers();
    expect(frames.size).toBe(1);
    view.rerender(<Transcript ids={["a", "b", "c"]} conversationKey="account:other" api={api} />);
    // Cleanup drops the old frame; the new thread has no saved anchor.
    expect(frames.size).toBe(0);
    flushFrames();
    expect(api.following?.current).toBe(true);
    expect(scroller().scrollTop).toBe(maxScroll());
  });

  it("keeps reflow correction when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Transcript ids={["a", "b", "c"]} api={api} />);
    scrollTo(250);
    layout.rows[0]!.height += 121;
    act(() => { scroller().dispatchEvent(new Event("load")); });
    expect(frames.size).toBe(1);
    flushFrames();
    expect(scroller().scrollTop).toBe(371);
  });
});
