// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  download: vi.fn(),
}));

vi.mock("../../services/messaging/files", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../services/messaging/files")>(),
  downloadChatFile: files.download,
}));

import { ChatFile } from "../ChatFile";
import { consumeBackIntercept, resetBackInterceptors } from "../backNavigation";
import { formatTime } from "./VideoPlayer";
import { VideoPlayerProvider, useVideoPlayer, type VideoPlayerApi } from "./VideoPlayerProvider";

// jsdom ships a media element that never loads and never plays. These stubs
// give the engine the two things it actually reads (playback state and a
// decoded duration) without pretending the file exists.
const media = { paused: true };
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  media.paused = true;
  playSpy = vi.fn(function (this: HTMLMediaElement) {
    media.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pauseSpy = vi.fn(function (this: HTMLMediaElement) {
    media.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pauseSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => media.paused,
  });
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => "blob:chat-video");
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  files.download.mockReset();
});

afterEach(() => {
  cleanup();
  resetBackInterceptors();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

/** Give the element a duration, a playhead and a buffered range. */
function loadVideo(duration = 90, currentTime = 0): HTMLVideoElement {
  const video = document.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) throw new Error("no video element");
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  video.currentTime = currentTime;
  Object.defineProperty(video, "buffered", {
    configurable: true,
    value: { length: 1, start: () => 0, end: () => duration },
  });
  act(() => {
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("canplay"));
  });
  return video;
}

/** jsdom has no decoder, so a test states the shape the browser would report. */
function setIntrinsicSize(element: HTMLVideoElement, width: number, height: number): void {
  Object.defineProperty(element, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(element, "videoHeight", { configurable: true, value: height });
}

/** The shape travels with the element's src, so a size change is a resize. */
function reportSize(element: HTMLVideoElement, event = "resize"): void {
  act(() => { element.dispatchEvent(new Event(event)); });
}

let api: VideoPlayerApi | null = null;

function OpenButton({ id = "a", src = "blob:one", name = "clip.mp4" }: { id?: string; src?: string; name?: string }) {
  const player = useVideoPlayer();
  api = player;
  return <button type="button" onClick={() => player.open({ id, src, name, revokeOnClose: true })}>open</button>;
}

/** Hands the provider a real slot, which is what makes the inline home inline
 * instead of the docked mini presentation. */
function SlotOpenButton() {
  const player = useVideoPlayer();
  api = player;
  const slot = useRef<HTMLDivElement>(null);
  return <>
    <button type="button" onClick={() => player.open({
      id: "a", src: "blob:one", name: "clip.mp4", slot: slot.current, revokeOnClose: true,
    })}>open inline</button>
    <div ref={slot} data-testid="inline-slot" />
  </>;
}

describe("time formatting", () => {
  it("uses mm:ss below an hour and h:mm:ss above it", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(7)).toBe("0:07");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });
});

describe("the one video player", () => {
  it("reports a playing source, expands into a focus-contained overlay and keeps the same element", async () => {
    render(<VideoPlayerProvider><OpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));

    const inline = await screen.findByRole("group", { name: "Video player: clip.mp4" });
    const video = document.querySelector("video")!;
    expect(inline.contains(video)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    const dialog = await screen.findByRole("dialog", { name: "Video: clip.mp4" });
    // Focus lands on Close, and the media node was never re-created.
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close video" }),
    ));
    expect(document.querySelector("video")).toBe(video);
    expect(dialog.contains(video)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api?.mode).toBe("mini");
    expect(document.querySelector("video")).toBe(video);
    expect(screen.getByRole("group", { name: "Video player: clip.mp4" })).toBeTruthy();
  });

  it("owns page scroll and lets Android Back minimise the overlay", async () => {
    render(<VideoPlayerProvider><OpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByRole("group", { name: "Video player: clip.mp4" });
    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    await screen.findByRole("dialog", { name: "Video: clip.mp4" });

    expect(document.body.style.overflow).toBe("hidden");
    expect(api?.mode).toBe("expanded");
    await act(async () => { expect(consumeBackIntercept()).toBe(true); });
    await waitFor(() => expect(api?.mode).toBe("mini"));
    expect(document.body.style.overflow).toBe("");
  });

  it("closes playback and revokes the object URL it was given", async () => {    render(<VideoPlayerProvider><OpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByRole("group", { name: "Video player: clip.mp4" });

    fireEvent.click(screen.getByRole("button", { name: "Close video" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: /Video player/ })).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(document.querySelector("video")).toBeNull();
  });

  it("replaces an open video, so only one plays, and revokes the outgoing URL", async () => {
    const view = render(<VideoPlayerProvider><OpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByRole("group", { name: "Video player: clip.mp4" });

    view.rerender(<VideoPlayerProvider><OpenButton id="b" src="blob:two" name="second.webm" /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByRole("group", { name: "Video player: second.webm" });
    expect(document.querySelectorAll("video")).toHaveLength(1);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one"));
  });

  it("offers a download instead of a dead end when the codec is refused", async () => {
    render(<VideoPlayerProvider><OpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByRole("group", { name: "Video player: clip.mp4" });
    const video = document.querySelector("video")!;

    act(() => { video.dispatchEvent(new Event("error")); });
    expect(await screen.findByText("This video can't play here.")).toBeTruthy();
    const download = screen.getByRole("button", { name: /Download/ });
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(download);
    expect(anchor).toHaveBeenCalled();
  });

  it("drives the transport from the keyboard without stealing typing", async () => {
    render(<VideoPlayerProvider><OpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    const group = await screen.findByRole("group", { name: "Video player: clip.mp4" });
    const video = loadVideo();

    fireEvent.keyDown(group, { key: " " });
    expect(playSpy).toHaveBeenCalled();

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(video.currentTime).toBe(5);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(0);

    fireEvent.keyDown(group, { key: "m" });
    expect(video.muted).toBe(true);
    fireEvent.keyDown(group, { key: "m" });
    expect(video.muted).toBe(false);

    fireEvent.keyDown(group, { key: "f" });
    expect(await screen.findByRole("dialog", { name: "Video: clip.mp4" })).toBeTruthy();

    // A text field inside a player surface keeps its own keys.
    fireEvent.keyDown(screen.getByRole("slider", { name: "Seek in clip.mp4" }), { key: "ArrowRight" });
    expect(video.currentTime).toBe(0);
  });

  it("carries the source's own ratio and the playhead through inline, expanded and mini", async () => {
    render(<VideoPlayerProvider><SlotOpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open inline" }));
    const group = await screen.findByRole("group", { name: "Video player: clip.mp4" });
    expect(group.closest("[data-testid='inline-slot']")).toBeTruthy();
    const video = loadVideo(90, 12);

    // No measurement yet: the overlay stage keeps a 16:9 placeholder. The
    // message frame never guesses a wide box, which ChatFile.video.test.tsx
    // covers; here the stage contract is that a real shape replaces it.
    expect(group.style.getPropertyValue("--fb-vp-ratio")).toBe(String(16 / 9));

    setIntrinsicSize(video, 1080, 1920);
    reportSize(video);
    await waitFor(() => expect(
      group.style.getPropertyValue("--fb-vp-ratio"),
    ).toBe(String(1080 / 1920)));

    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    const dialog = await screen.findByRole("dialog", { name: "Video: clip.mp4" });
    expect(dialog.style.getPropertyValue("--fb-vp-ratio")).toBe(String(1080 / 1920));
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(video.currentTime).toBe(12);

    fireEvent.keyDown(dialog, { key: "Escape" });
    const mini = await screen.findByRole("group", { name: "Video player: clip.mp4" });
    expect(mini.style.getPropertyValue("--fb-vp-ratio")).toBe(String(1080 / 1920));
    expect(document.querySelector("video")).toBe(video);
    expect(video.currentTime).toBe(12);

    // Same source, re-homed: the shape is still the one this element measured.
    fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
    expect((await screen.findByRole("dialog", { name: "Video: clip.mp4" }))
      .style.getPropertyValue("--fb-vp-ratio")).toBe(String(1080 / 1920));
    expect(document.querySelector("video")).toBe(video);
  });

  it("keeps the inline transport to basic playback and leaves the advanced controls in the overlay", async () => {
    render(<VideoPlayerProvider><SlotOpenButton /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open inline" }));
    const group = await screen.findByRole("group", { name: "Video player: clip.mp4" });
    expect(group.closest("[data-testid='inline-slot']")).toBeTruthy();
    loadVideo();

    // Inline: play, seek, expand and close. Mute joins the overlay so the row
    // needs three 44px boxes rather than four; the overlay-only controls are
    // absent from the DOM, not merely hidden, so nothing focusable sits
    // off-frame and no box has to shrink below the house minimum.
    expect(within(group).getByRole("button", { name: "Play" })).toBeTruthy();
    expect(within(group).getByRole("slider", { name: "Seek in clip.mp4" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Expand video" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Close video" })).toBeTruthy();
    expect(within(group).queryByRole("button", { name: "Mute" })).toBeNull();
    expect(within(group).queryByRole("slider", { name: "Volume for clip.mp4" })).toBeNull();
    expect(within(group).queryByRole("button", { name: /Playback speed/ })).toBeNull();
    expect(within(group).queryByRole("button", { name: "Picture in picture" })).toBeNull();
    expect(within(group).queryByRole("button", { name: /Download/ })).toBeNull();

    // The overlay keeps every function that left the message row, mute included.
    fireEvent.click(within(group).getByRole("button", { name: "Expand video" }));
    const dialog = await screen.findByRole("dialog", { name: "Video: clip.mp4" });
    expect(within(dialog).getByRole("slider", { name: "Seek in clip.mp4" })).toBeTruthy();
    expect(within(dialog).getByRole("slider", { name: "Volume for clip.mp4" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Playback speed/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Download clip.mp4" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Minimize player" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Close video" })).toBeTruthy();
  });
});

describe("the conversation video tile", () => {
  const meta = { key: "files/u/c/clip.mp4", name: "clip.mp4", mime: "video/mp4", byteSize: 2_400_000, kind: "video" as const };

  function Toggle() {
    const [shown, setShown] = useState(true);
    return <VideoPlayerProvider>
      {shown ? <ChatFile meta={meta} /> : null}
      <button type="button" onClick={() => setShown(false)}>hide</button>
    </VideoPlayerProvider>;
  }

  it("shows a poster and downloads nothing until play is pressed", async () => {
    files.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
    render(<VideoPlayerProvider><ChatFile meta={meta} /></VideoPlayerProvider>);

    expect(screen.getByRole("button", { name: "Play clip.mp4" })).toBeTruthy();
    expect(screen.getByText("clip.mp4")).toBeTruthy();
    expect(screen.getByText("2.3 MB")).toBeTruthy();
    expect(files.download).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
    await waitFor(() => expect(files.download).toHaveBeenCalledWith(meta.key));
    expect(await screen.findByRole("group", { name: "Video player: clip.mp4" })).toBeTruthy();
    expect(files.download).toHaveBeenCalledTimes(1);
  });

  it("keeps the handed-over URL alive when the bubble leaves, then lets the player revoke it", async () => {
    files.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
    render(<Toggle />);
    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
    await screen.findByRole("group", { name: "Video player: clip.mp4" });

    fireEvent.click(screen.getByRole("button", { name: "hide" }));
    // The bubble is gone and the player docked instead of dying with it: the
    // mini transport has no seek bar, only play, expand and close.
    await waitFor(() => expect(screen.queryByRole("slider", { name: "Seek in clip.mp4" })).toBeNull());
    expect(screen.getByRole("group", { name: "Video player: clip.mp4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand video" })).toBeTruthy();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close video" }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:chat-video"));
  });

  it("says the file is gone when the download itself fails", async () => {
    files.download.mockRejectedValue(new Error("gone"));
    render(<VideoPlayerProvider><ChatFile meta={meta} /></VideoPlayerProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
    expect(await screen.findByText("That file is no longer available.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Video player/ })).toBeNull();
  });
});

/**
 * jsdom has no layout, so these read the declarations that own the transport's
 * boxes and compute their geometry. Rendered pixels at 320dp and a large text
 * scale remain a deployed-browser item.
 */
describe("transport hit boxes", () => {
  const css = readFileSync("src/components/media/videoPlayer.css", "utf8");

  function body(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`missing rule ${selector}`);
    return css.slice(start, css.indexOf("}", start) + 1);
  }

  function values(source: string, property: string): number[] {
    const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`).exec(source);
    if (!match) throw new Error(`missing ${property}`);
    return [...match[1]!.matchAll(/(-?\d+)px/g)].map((found) => Number(found[1]));
  }

  const size = (source: string, property: string): number => values(source, property)[0]!;

  it("gives every touched control a real 44x44 box, not an overlay", () => {
    const icon = body(".fb-vp-icon");
    expect(size(icon, "width")).toBe(44);
    expect(size(icon, "height")).toBe(44);
    // The seek and the volume slider are touched controls too.
    expect(size(body(".fb-vp-seek"), "height")).toBe(44);
    expect(size(body(".fb-vp-volume"), "height")).toBe(44);
    expect(size(body(".fb-vp-error-action"), "min-height")).toBe(44);
    // A box is the target: nothing extends over a neighbour and nothing can be
    // clipped by the surface that draws it.
    expect(css).not.toContain("::after");
    expect(css).not.toMatch(/inset(?:-block|-inline)?:\s*-\d/);
    expect(icon).not.toMatch(/margin:\s*-/);
  });

  it("fits three 44px boxes in the narrowest inline frame and keeps the clock last", () => {
    const box = size(body(".fb-vp-icon"), "width");
    const gap = size(body(".fb-vp-row"), "gap");
    const pad = size(body(".fb-vp-bar"), "padding-inline");
    // 320x480 viewport, 9:21 source: the message frame is capped by both the
    // 78vw chat width and the shared min(30rem, 80vh) height under its ratio.
    const frame = Math.min(320 * 0.78, Math.min(30 * 16, 480 * 0.8) * (9 / 21));
    // Four in-flow children (play, spacer, expand, close) once the clock has
    // gone: three 44px boxes, three gaps and the bar's inline padding.
    const used = 3 * box + 3 * gap + 2 * pad;
    expect(used).toBe(146);
    expect(used).toBeLessThan(frame);
    // The clock is not a control; it alone leaves when even it cannot fit.
    expect(css).toMatch(
      /@container \(max-width: 232px\) \{[\s\S]*?\.fb-vp--inline \.fb-vp-time \{ display: none; \}/,
    );
    expect(css).not.toMatch(/\.fb-vp--inline \.fb-vp-icon \{[^}]*display: none/);
    expect(css).not.toMatch(/\.fb-vp--inline \.fb-vp-seek[^{]*\{[^}]*display: none/);
  });

  it("reserves both wrapped rows of the expanded transport in the stage floor", () => {
    expect(body(".fb-vp--expanded .fb-vp-row")).toContain("flex-wrap: wrap;");
    const bar = body(".fb-vp-bar");
    const [top, bottom] = values(bar, "padding-block");
    const track = size(body(".fb-vp-track"), "height");
    const box = size(body(".fb-vp-icon"), "height");
    const rowGap = size(body(".fb-vp--expanded .fb-vp-row"), "row-gap");
    const reserved = size(body(".fb-vp--expanded"), "--fb-vp-bar-height");
    // A row is as tall as its boxes; the gap between wrapped rows is positive,
    // so two lines never share a pixel.
    expect(rowGap).toBeGreaterThan(0);
    expect(top! + track + bottom! + box).toBe(100);
    expect(top! + track + bottom! + 2 * box + rowGap).toBe(reserved);
    expect(css).toContain("min-height: min(var(--fb-vp-bar-height), var(--fb-vp-stage-max-height));");
  });

  it("leaves the mini actions at the same box size inside the card", () => {
    expect(css).not.toMatch(/\.fb-vp-mini-actions \.fb-vp-icon \{[^}]*width:/);
    expect(css).not.toMatch(/\.fb-vp-mini-actions \.fb-vp-icon \{[^}]*height:/);
  });
});
