// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatFile } from "./ChatFile";
import { VideoPlayerProvider, useVideoPlayer, type VideoPlayerApi } from "./media/VideoPlayerProvider";
import type { ChatFileMeta } from "../services/messaging/files";

const m = vi.hoisted(() => ({
  download: vi.fn(),
  create: vi.fn(() => "blob:chat-video"),
  revoke: vi.fn(),
}));

vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  downloadChatFile: m.download,
}));

const video: ChatFileMeta = {
  key: "files/account/chat/clip.mp4",
  name: "clip.mp4",
  mime: "video/mp4",
  byteSize: 2_400_000,
  kind: "video",
};
const audio: ChatFileMeta = {
  key: "files/account/chat/voice.m4a",
  name: "voice.m4a",
  mime: "audio/mp4",
  byteSize: 512_000,
  kind: "audio",
};

// jsdom never loads or plays media. These stubs give the engine only what it
// reads (playback state, a play call that resolves) without faking a decoder.
const media = { paused: true };
let playSpy: ReturnType<typeof vi.fn>;
let playerApi: VideoPlayerApi | null = null;

beforeEach(() => {
  media.paused = true;
  playerApi = null;
  m.download.mockReset();
  m.create.mockClear();
  m.revoke.mockClear();
  (URL as unknown as Record<string, unknown>).createObjectURL = m.create;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = m.revoke;
  playSpy = vi.fn(function (this: HTMLMediaElement) {
    media.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(function (this: HTMLMediaElement) {
      media.paused = true;
      this.dispatchEvent(new Event("pause"));
    }),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => media.paused,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderVideo() {
  return render(<VideoPlayerProvider><ChatFile meta={video} /></VideoPlayerProvider>);
}

/** jsdom reports no intrinsic size, so tests state the decoded dimensions. */
function setIntrinsicSize(element: HTMLVideoElement, width: number, height: number): void {
  Object.defineProperty(element, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(element, "videoHeight", { configurable: true, value: height });
}

/** `loadedmetadata` arrives with the size; `resize` reports a later change. */
function reportSize(element: HTMLVideoElement, event = "loadedmetadata"): void {
  act(() => { element.dispatchEvent(new Event(event)); });
}

it("keeps an unloaded video compact and downloads nothing", () => {
  renderVideo();

  expect(screen.getByRole("button", { name: "Play clip.mp4" })).toBeTruthy();
  expect(screen.getByText("clip.mp4")).toBeTruthy();
  expect(screen.getByText("2.3 MB")).toBeTruthy();
  expect(document.querySelector("video")).toBeNull();
  expect(m.download).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
});

it("downloads once on Play and paints the real video inside the message frame", async () => {
  const blob = new Blob(["x"], { type: "video/mp4" });
  m.download.mockResolvedValue(blob);
  renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await waitFor(() => expect(m.download).toHaveBeenCalledWith(video.key));
  const player = await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const element = document.querySelector("video");

  expect(element).not.toBeNull();
  expect(player.contains(element)).toBe(true);
  expect(element?.closest(".fb-chat-video-frame")).toBeTruthy();
  expect(document.querySelector(".fb-chat-video-frame")?.getAttribute("data-active")).toBe("true");
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledWith(blob);
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Play clip.mp4" })).toBeNull();
});

it("refuses a second press while the first download is still pending", async () => {
  let finish!: (value: Blob) => void;
  m.download.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
  renderVideo();

  const button = screen.getByRole("button", { name: "Play clip.mp4" }) as HTMLButtonElement;
  fireEvent.click(button);
  await waitFor(() => expect(button.disabled).toBe(true));
  fireEvent.click(button);
  await waitFor(() => expect(m.download).toHaveBeenCalledTimes(1));

  await act(async () => { finish(new Blob(["x"], { type: "video/mp4" })); });
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledTimes(1);
});

it("recovers from a refused download on the next press", async () => {
  m.download.mockRejectedValueOnce(new Error("gone"))
    .mockResolvedValueOnce(new Blob(["x"], { type: "video/mp4" }));
  renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  expect(await screen.findByText("That file is no longer available.")).toBeTruthy();
  expect(screen.queryByRole("group", { name: /Video player/ })).toBeNull();
  expect(m.create).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  await waitFor(() => expect(screen.queryByText("That file is no longer available.")).toBeNull());
  expect(m.download).toHaveBeenCalledTimes(2);
  expect(m.create).toHaveBeenCalledTimes(1);
});

it("docks instead of dying when the row leaves, and revokes only when closed", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  function Toggle() {
    const [shown, setShown] = useState(true);
    return <VideoPlayerProvider>
      {shown ? <ChatFile meta={video} /> : null}
      <button type="button" onClick={() => setShown(false)}>hide row</button>
    </VideoPlayerProvider>;
  }
  render(<Toggle />);

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const element = document.querySelector("video");

  fireEvent.click(screen.getByRole("button", { name: "hide row" }));
  expect(screen.getByRole("group", { name: "Video player: clip.mp4" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Expand video" })).toBeTruthy();
  expect(document.querySelector("video")).toBe(element);
  expect(m.revoke).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Close video" }));
  await waitFor(() => expect(m.revoke).toHaveBeenCalledWith("blob:chat-video"));
  expect(document.querySelector("video")).toBeNull();
});

it("re-opens the docked video from the row without downloading it again", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const element = document.querySelector("video");

  fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
  const dialog = await screen.findByRole("dialog", { name: "Video: clip.mp4" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  const reopen = await screen.findByRole("button", { name: "Show clip.mp4 in the conversation" });
  fireEvent.click(reopen);
  await waitFor(() => expect(
    screen.queryByRole("button", { name: "Show clip.mp4 in the conversation" }),
  ).toBeNull());

  expect(document.querySelector("video")).toBe(element);
  expect(element?.closest(".fb-chat-video-frame")).toBeTruthy();
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledTimes(1);
});

it("paints the inline frame at the source's own ratio as metadata arrives", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const card = document.querySelector(".fb-chat-video") as HTMLElement;
  const frame = document.querySelector(".fb-chat-video-frame") as HTMLElement;
  const element = document.querySelector("video") as HTMLVideoElement;

  // Nothing has been measured yet: the familiar 16:9 frame stands in.
  expect(card.style.getPropertyValue("--fb-chat-video-ratio")).toBe(String(16 / 9));
  expect(frame.getAttribute("data-active")).toBe("true");

  setIntrinsicSize(element, 1080, 1920);
  reportSize(element);
  await waitFor(() => expect(
    card.style.getPropertyValue("--fb-chat-video-ratio"),
  ).toBe(String(1080 / 1920)));

  // A later size change (rotation, adaptive stream) re-shapes the same frame.
  setIntrinsicSize(element, 1920, 1080);
  reportSize(element, "resize");
  await waitFor(() => expect(
    card.style.getPropertyValue("--fb-chat-video-ratio"),
  ).toBe(String(1920 / 1080)));
});

function PlayerHarness() {
  const player = useVideoPlayer();
  playerApi = player;
  return <>
    <button type="button" onClick={() => player.open({ id: "a", src: "blob:one", name: "one.mp4", revokeOnClose: true })}>
      open one
    </button>
    <button type="button" onClick={() => player.open({ id: "b", src: "blob:two", name: "two.mp4", revokeOnClose: true })}>
      open two
    </button>
    <button type="button" onClick={() => player.close()}>close player</button>
  </>;
}

it("keeps the measured ratio through modes and a same-src re-home, then clears on close", async () => {
  render(<VideoPlayerProvider><PlayerHarness /></VideoPlayerProvider>);
  fireEvent.click(screen.getByRole("button", { name: "open one" }));
  await screen.findByRole("group", { name: "Video player: one.mp4" });
  const element = document.querySelector("video") as HTMLVideoElement;

  setIntrinsicSize(element, 1920, 1080);
  reportSize(element);
  await waitFor(() => expect(playerApi?.aspect).toBeCloseTo(1920 / 1080, 5));

  fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
  await screen.findByRole("dialog", { name: "Video: one.mp4" });
  expect(document.querySelector("video")).toBe(element);
  expect(playerApi?.aspect).toBeCloseTo(1920 / 1080, 5);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(playerApi?.mode).toBe("mini"));
  expect(playerApi?.aspect).toBeCloseTo(1920 / 1080, 5);

  // Same id and src: the provider re-homes the same element and keeps its shape.
  fireEvent.click(screen.getByRole("button", { name: "open one" }));
  expect(document.querySelector("video")).toBe(element);
  expect(playerApi?.aspect).toBeCloseTo(1920 / 1080, 5);

  fireEvent.click(screen.getByRole("button", { name: "close player" }));
  await waitFor(() => expect(playerApi?.video).toBeNull());
  expect(playerApi?.aspect).toBeNull();
  await waitFor(() => expect(m.revoke).toHaveBeenCalledWith("blob:one"));
});

it("never applies a replaced video's ratio to its replacement", async () => {
  render(<VideoPlayerProvider><PlayerHarness /></VideoPlayerProvider>);
  fireEvent.click(screen.getByRole("button", { name: "open one" }));
  await screen.findByRole("group", { name: "Video player: one.mp4" });
  const element = document.querySelector("video") as HTMLVideoElement;

  setIntrinsicSize(element, 1000, 500);
  reportSize(element);
  await waitFor(() => expect(playerApi?.aspect).toBeCloseTo(2, 5));

  fireEvent.click(screen.getByRole("button", { name: "open two" }));
  await screen.findByRole("group", { name: "Video player: two.mp4" });
  // One element, a new source: the old 2:1 sample is not this video's shape.
  expect(document.querySelector("video")).toBe(element);
  await waitFor(() => expect(playerApi?.aspect).toBeNull());

  setIntrinsicSize(element, 500, 1000);
  reportSize(element);
  await waitFor(() => expect(playerApi?.aspect).toBeCloseTo(0.5, 5));
});

it("starts a reopened source with no carried-over ratio", async () => {
  render(<VideoPlayerProvider><PlayerHarness /></VideoPlayerProvider>);
  fireEvent.click(screen.getByRole("button", { name: "open one" }));
  await screen.findByRole("group", { name: "Video player: one.mp4" });
  let element = document.querySelector("video") as HTMLVideoElement;

  setIntrinsicSize(element, 1000, 500);
  reportSize(element);
  await waitFor(() => expect(playerApi?.aspect).toBeCloseTo(2, 5));

  fireEvent.click(screen.getByRole("button", { name: "close player" }));
  await waitFor(() => expect(playerApi?.video).toBeNull());
  expect(playerApi?.aspect).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "open one" }));
  await screen.findByRole("group", { name: "Video player: one.mp4" });
  element = document.querySelector("video") as HTMLVideoElement;
  // A fresh element has measured nothing yet, even for the same URL.
  expect(playerApi?.aspect).toBeNull();

  setIntrinsicSize(element, 1280, 720);
  reportSize(element);
  await waitFor(() => expect(playerApi?.aspect).toBeCloseTo(1280 / 720, 5));
});

it("drops a download that settles after the row is gone", async () => {
  let finish!: (value: Blob) => void;
  m.download.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
  const view = renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await waitFor(() => expect(m.download).toHaveBeenCalledTimes(1));
  view.unmount();

  await act(async () => { finish(new Blob(["x"], { type: "video/mp4" })); });
  expect(m.create).not.toHaveBeenCalled();
  expect(m.revoke).not.toHaveBeenCalled();
  expect(document.querySelector("video")).toBeNull();
});

it("still opens under StrictMode's setup, cleanup and setup", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  render(<StrictMode><VideoPlayerProvider><ChatFile meta={video} /></VideoPlayerProvider></StrictMode>);

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });

  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll("video")).toHaveLength(1);
});

it("still starts audio under StrictMode's setup, cleanup and setup", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "audio/mp4" }));
  render(<StrictMode><VideoPlayerProvider><ChatFile meta={audio} /></VideoPlayerProvider></StrictMode>);

  fireEvent.click(screen.getByRole("button", { name: "Play voice.m4a" }));
  await waitFor(() => expect(m.download).toHaveBeenCalledTimes(1));

  await waitFor(() => expect(document.querySelector("audio")?.getAttribute("src")).toBe("blob:chat-video"));
  expect(playSpy).toHaveBeenCalled();
  expect(m.create).toHaveBeenCalledTimes(1);
});
