// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

it("holds a compact loading band until this source's own metadata arrives", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const card = document.querySelector(".fb-chat-video") as HTMLElement;
  const frame = document.querySelector(".fb-chat-video-frame") as HTMLElement;
  const element = document.querySelector("video") as HTMLVideoElement;

  // Nothing has been measured yet, and the file name is not a shape: no 16:9
  // ratio is written at all. The frame stays a compact loading band instead of
  // a wide box that would collapse into a tall portrait.
  expect(card.style.getPropertyValue("--fb-chat-video-ratio")).toBe("");
  expect(frame.getAttribute("data-active")).toBe("true");
  expect(frame.getAttribute("data-pending")).toBe("true");

  setIntrinsicSize(element, 1080, 1920);
  reportSize(element);
  await waitFor(() => expect(
    card.style.getPropertyValue("--fb-chat-video-ratio"),
  ).toBe(String(1080 / 1920)));
  expect(frame.getAttribute("data-pending")).toBeNull();

  // A later size change (rotation, adaptive stream) re-shapes the same frame.
  setIntrinsicSize(element, 1920, 1080);
  reportSize(element, "resize");
  await waitFor(() => expect(
    card.style.getPropertyValue("--fb-chat-video-ratio"),
  ).toBe(String(1920 / 1080)));
  expect(frame.getAttribute("data-pending")).toBeNull();
});

describe("source ratios in the message frame", () => {
  for (const [label, width, height] of [
    ["9:16 portrait", 1080, 1920],
    ["9:21 tall portrait", 1080, 2520],
    ["16:9 landscape", 1920, 1080],
  ] as const) {
    it(`paints a ${label} source at its own ratio`, async () => {
      m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
      renderVideo();

      fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
      await screen.findByRole("group", { name: "Video player: clip.mp4" });
      const card = document.querySelector(".fb-chat-video") as HTMLElement;
      const element = document.querySelector("video") as HTMLVideoElement;

      setIntrinsicSize(element, width, height);
      reportSize(element);
      await waitFor(() => expect(
        card.style.getPropertyValue("--fb-chat-video-ratio"),
      ).toBe(String(width / height)));
      expect(document.querySelectorAll("video")).toHaveLength(1);
    });
  }
});

it("carries the measured portrait shape into the overlay without a second player", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  renderVideo();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  const group = await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const element = document.querySelector("video") as HTMLVideoElement;
  setIntrinsicSize(element, 1080, 1920);
  reportSize(element);
  await waitFor(() => expect(group.style.getPropertyValue("--fb-vp-ratio")).toBe(String(1080 / 1920)));
  element.currentTime = 7;

  fireEvent.click(screen.getByRole("button", { name: "Expand video" }));
  const dialog = await screen.findByRole("dialog", { name: "Video: clip.mp4" });
  expect(dialog.style.getPropertyValue("--fb-vp-ratio")).toBe(String(1080 / 1920));
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(document.querySelector("video")).toBe(element);
  expect(element.currentTime).toBe(7);

  fireEvent.keyDown(dialog, { key: "Escape" });
  const mini = await screen.findByRole("group", { name: "Video player: clip.mp4" });
  expect(mini.style.getPropertyValue("--fb-vp-ratio")).toBe(String(1080 / 1920));
  expect(document.querySelector("video")).toBe(element);
});

it("starts a replacement source pending again instead of inheriting the old shape", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  m.create.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const second: ChatFileMeta = { ...video, key: "files/account/chat/second.mp4", name: "second.mp4" };
  render(<VideoPlayerProvider><ChatFile meta={video} /><ChatFile meta={second} /></VideoPlayerProvider>);

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const firstCard = document.querySelector(".fb-chat-video") as HTMLElement;
  const element = document.querySelector("video") as HTMLVideoElement;
  setIntrinsicSize(element, 1080, 1920);
  reportSize(element);
  await waitFor(() => expect(
    firstCard.style.getPropertyValue("--fb-chat-video-ratio"),
  ).toBe(String(1080 / 1920)));

  fireEvent.click(screen.getByRole("button", { name: "Play second.mp4" }));
  const secondCard = (await screen.findByRole("group", { name: "Video player: second.mp4" }))
    .closest(".fb-chat-video") as HTMLElement;
  const secondFrame = secondCard.querySelector(".fb-chat-video-frame") as HTMLElement;
  // The old ratio is tagged to the old src; the replacement reports unknown and
  // goes back to the compact band until its own metadata arrives.
  expect(secondCard.style.getPropertyValue("--fb-chat-video-ratio")).toBe("");
  expect(secondFrame.getAttribute("data-pending")).toBe("true");
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(document.querySelector("video")).toBe(element);
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
    <button type="button" onClick={() => player.open(
      { id: "three", src: "blob:three", name: "three.mp4", revokeOnClose: true },
      { mode: "expanded" },
    )}>
      open three expanded
    </button>
    <button type="button" onClick={() => player.close()}>close player</button>
  </>;
}

/** Reads the live API without painting anything, for slot/mode assertions. */
function PlayerProbe() {
  playerApi = useVideoPlayer();
  return null;
}

it("opens a source straight into the expanded overlay without a slot", async () => {
  render(<VideoPlayerProvider><PlayerHarness /></VideoPlayerProvider>);
  fireEvent.click(screen.getByRole("button", { name: "open three expanded" }));

  const dialog = await screen.findByRole("dialog", { name: "Video: three.mp4" });
  expect(dialog.querySelectorAll("video")).toHaveLength(1);
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(playerApi?.mode).toBe("expanded");
  expect(screen.queryByRole("group", { name: "Video player: three.mp4" })).toBeNull();
});

it("renders a grouped video as one tile that opens the expanded player", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  render(<VideoPlayerProvider><ChatFile meta={video} tile /><PlayerProbe /></VideoPlayerProvider>);

  expect(document.querySelector(".fb-chat-video.fb-chat-video-tile")).toBeTruthy();
  // A tile is not the inline row: no frame, no transport, nothing fetched yet.
  expect(document.querySelector(".fb-chat-video-frame")).toBeNull();
  expect(document.querySelector("video")).toBeNull();
  expect(m.download).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  const dialog = await screen.findByRole("dialog", { name: "Video: clip.mp4" });

  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.download).toHaveBeenCalledWith(video.key);
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(dialog.querySelectorAll("video")).toHaveLength(1);
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(playerApi?.mode).toBe("expanded");
  // The tile never claims an inline slot; the provider only has the source.
  expect(playerApi?.video?.slot).toBeUndefined();
  expect(document.querySelector(".fb-chat-video-frame")).toBeNull();
});

it("keeps the tile for a retry when its download fails", async () => {
  m.download.mockRejectedValueOnce(new Error("gone"))
    .mockResolvedValueOnce(new Blob(["x"], { type: "video/mp4" }));
  render(<VideoPlayerProvider><ChatFile meta={video} tile /></VideoPlayerProvider>);

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  expect(await screen.findByText("That file is no longer available.")).toBeTruthy();
  expect(document.querySelector(".fb-chat-video-tile")).toBeTruthy();
  expect(document.querySelector("video")).toBeNull();
  expect(m.create).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("dialog", { name: "Video: clip.mp4" });
  await waitFor(() => expect(screen.queryByText("That file is no longer available.")).toBeNull());
  expect(m.download).toHaveBeenCalledTimes(2);
  expect(document.querySelectorAll("video")).toHaveLength(1);
});

it("ignores tile for a non-video file", () => {
  render(<ChatFile meta={audio} tile />);

  expect(document.querySelector(".fb-chat-video-tile")).toBeNull();
  expect(screen.getByRole("button", { name: "Play voice.m4a" })).toBeTruthy();
});

it("docks an inline player when its message becomes an album tile", async () => {
  m.download.mockResolvedValue(new Blob(["x"], { type: "video/mp4" }));
  function Toggle() {
    const [grouped, setGrouped] = useState(false);
    return <VideoPlayerProvider>
      <ChatFile meta={video} tile={grouped} />
      <button type="button" onClick={() => setGrouped(true)}>group it</button>
    </VideoPlayerProvider>;
  }
  render(<Toggle />);

  fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
  await screen.findByRole("group", { name: "Video player: clip.mp4" });
  const element = document.querySelector("video");
  expect(element?.closest(".fb-chat-video-frame")).toBeTruthy();

  // The album owns the cell now, so the frame is gone. The player must stay
  // reachable in the dock rather than painting into the removed slot.
  fireEvent.click(screen.getByRole("button", { name: "group it" }));
  await waitFor(() => expect(document.querySelector(".fb-chat-video-frame")).toBeNull());
  expect(await screen.findByRole("group", { name: "Video player: clip.mp4" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector("video")).toBe(element);
});

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

/**
 * jsdom has no layout, so these read the declarations that own the frame's two
 * unmeasured states. Rendered pixels at 320dp with large text remain a
 * deployed-browser item.
 */
describe("message frame declarations", () => {
  const css = readFileSync("src/components/ChatFile.css", "utf8");

  function block(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`missing rule ${selector}`);
    return css.slice(start, css.indexOf("}", start) + 1);
  }

  it("keeps a compact band before metadata and lets a refused file grow", () => {
    const pending = block('.fb-chat-video-frame[data-active="true"][data-pending="true"]');
    expect(pending).toContain("height: 152px;");
    expect(pending).toContain("aspect-ratio: auto;");

    const failed = block('.fb-chat-video-frame[data-active="true"]:has(.fb-vp-error)');
    expect(failed).toContain("height: auto;");
    expect(failed).toContain("aspect-ratio: auto;");

    // The message and its Download join the frame's own height instead of
    // being centred behind the transport, so a narrow frame or a large text
    // scale grows the band rather than clipping the only recovery control.
    expect(block('.fb-chat-video-frame[data-active="true"]:has(.fb-vp-error) .fb-vp-error'))
      .toContain("position: static;");
    expect(block('.fb-chat-video-frame[data-active="true"]:has(.fb-vp-error) .fb-vp-stage'))
      .toContain("padding-block-end: 60px;");
    expect(block('.fb-chat-video-frame[data-active="true"]:has(.fb-vp-error) .fb-vp-track'))
      .toContain("display: none;");
  });

  it("lets the album tile fill its cell with a 48px focusable play target", () => {
    const tile = block(".fb-chat-video-tile");
    expect(tile).toContain("width: 100%;");
    expect(tile).toContain("height: 100%;");
    expect(tile).toContain("aspect-ratio: 1;");
    expect(tile).toContain("overflow: hidden;");
    expect(tile).toContain("border-radius: inherit;");

    const button = block(".fb-chat-video-tile-button");
    expect(button).toContain("min-width: 48px;");
    expect(button).toContain("min-height: 48px;");
    expect(block(".fb-chat-video-tile-button:focus-visible")).toContain("var(--fb-focus)");
  });
});
