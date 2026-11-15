// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
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

let api: VideoPlayerApi | null = null;

function OpenButton({ id = "a", src = "blob:one", name = "clip.mp4" }: { id?: string; src?: string; name?: string }) {
  const player = useVideoPlayer();
  api = player;
  return <button type="button" onClick={() => player.open({ id, src, name, revokeOnClose: true })}>open</button>;
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
