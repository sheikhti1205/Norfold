// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeEmbed } from "./YouTubeEmbed";

// Every metadata path is network-mocked: no test may reach youtube.com. The
// real title cache lives at module scope, so each case uses its own 11-char id
// and only the dedupe case repeats one.
const fetchMock = vi.fn();

function titleResponse(title: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ title }) } as unknown as Response;
}

function unresolved(): Promise<Response> {
  return new Promise<Response>(() => {});
}

function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve: (value: Response) => void = () => {};
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function lastFetch(): [string, RequestInit] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return call as [string, RequestInit];
}

/** Let the fetch -> json -> then chain settle without asserting a title. */
async function settleTitleLookup(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("YouTubeEmbed link safety", () => {
  it.each([
    "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQextra",
    "https://youtube.com/watch?v=dQw4w9WgXc",
    "https://youtube.com/watch?v=dQw4w9WgXcQQ",
  ])("renders no embed or link for untrusted input: %s", (url) => {
    const { container } = render(<YouTubeEmbed url={url} />);
    expect(container.childElementCount).toBe(0);
  });

  it("uses a canonical watch link, fixed embed origin and a real poster", async () => {
    const { container } = render(
      <YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ?si=untrusted-tracking#fragment" />,
    );
    expect(screen.getByRole("link", { name: "Watch on YouTube" }).getAttribute("href"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(container.querySelector("img")?.getAttribute("src"))
      .toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
    // Metadata is a compact-card concern; the post/editor embed stays offline
    // until the reader presses play.
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const player = await screen.findByTitle("Embedded YouTube video");
    expect(player.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("opens a larger pop-out player and closes it with Escape", async () => {
    render(<YouTubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    // Nothing is embedded before a deliberate press.
    expect(screen.queryByTitle("Embedded YouTube video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Watch larger" }));
    const dialog = await screen.findByRole("dialog", { name: "Video player" });
    expect(dialog).toBeTruthy();
    expect(screen.getByTitle("Embedded YouTube video").getAttribute("src"))
      .toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Video player" })).toBeNull());
  });

  it("keeps the external fallback reachable from the pop-out", async () => {
    render(<YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ" />);
    fireEvent.click(screen.getByRole("button", { name: "Watch larger" }));
    await screen.findByRole("dialog", { name: "Video player" });
    const links = screen.getAllByRole("link", { name: "Watch on YouTube" });
    expect(links.at(-1)?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(links.at(-1)?.getAttribute("target")).toBe("_blank");
  });

  it("keeps the pop-out controls at the 48px minimum", async () => {
    render(<YouTubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    const larger = screen.getByRole("button", { name: "Watch larger" });
    expect(larger.className).toContain("min-h-12");
    expect(larger.className).toContain("min-w-12");

    fireEvent.click(larger);
    await screen.findByRole("dialog", { name: "Video player" });
    const close = screen.getByRole("button", { name: "Close video" });
    expect(close.className).toContain("min-h-12");
    expect(close.className).toContain("min-w-12");
    const watch = screen.getAllByRole("link", { name: "Watch on YouTube" }).at(-1)!;
    expect(watch.className).toContain("min-h-12");
  });

  it("unmounts the inline player while the pop-out is open", async () => {
    render(<YouTubeEmbed url="https://youtube.com/watch?v=dQw4w9WgXcQ" />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    await screen.findByTitle("Embedded YouTube video");

    fireEvent.click(screen.getByRole("button", { name: "Watch larger" }));
    await screen.findByRole("dialog", { name: "Video player" });

    // Two frames would mean two downloads and two audio tracks.
    await waitFor(() => expect(screen.getAllByTitle("Embedded YouTube video")).toHaveLength(1));
  });
});

describe("YouTubeEmbed compact preview", () => {
  it.each([
    "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQextra",
    "https://youtube.com/watch?v=dQw4w9WgXc",
    "https://youtube.com/watch?v=dQw4w9WgXcQQ",
  ])("renders nothing and fetches nothing for untrusted input: %s", (url) => {
    const { container } = render(<YouTubeEmbed url={url} compact />);
    expect(container.childElementCount).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows one integrated card with a real thumbnail, honest title and domain", () => {
    fetchMock.mockImplementation(unresolved);
    const { container } = render(
      <YouTubeEmbed url="https://youtu.be/thumb000001?si=tracking-token#frag" compact />,
    );
    const poster = screen.getByTestId("youtube-poster");
    expect(poster.getAttribute("aria-label")).toBe("Play video");
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://i.ytimg.com/vi/thumb000001/mqdefault.jpg");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.getAttribute("alt")).toBe("");
    expect(screen.getByText("YouTube video")).toBeTruthy();
    const domain = screen.getByRole("link", { name: "YouTube" });
    expect(domain.getAttribute("href")).toBe("https://www.youtube.com/watch?v=thumb000001");
    expect(domain.getAttribute("target")).toBe("_blank");
    // The compact card replaces the duplicated watch footer and never prints
    // the pasted URL, including its query and fragment.
    expect(screen.queryByRole("link", { name: "Watch on YouTube" })).toBeNull();
    expect(container.textContent).not.toContain("si=tracking-token");
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("falls back to the 4:3 poster once, then states the preview is unavailable", () => {
    fetchMock.mockImplementation(unresolved);
    const { container } = render(<YouTubeEmbed url="https://youtu.be/thumb000002" compact />);
    const mq = container.querySelector("img");
    expect(mq?.getAttribute("src")).toBe("https://i.ytimg.com/vi/thumb000002/mqdefault.jpg");
    expect(mq?.getAttribute("width")).toBe("320");

    fireEvent.error(mq ?? document.createElement("img"));
    const hq = container.querySelector("img");
    expect(hq?.getAttribute("src")).toBe("https://i.ytimg.com/vi/thumb000002/hqdefault.jpg");
    expect(hq?.getAttribute("width")).toBe("480");

    fireEvent.error(hq ?? document.createElement("img"));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Preview unavailable")).toBeTruthy();
    expect(screen.getByRole("link", { name: "YouTube" }).getAttribute("href"))
      .toBe("https://www.youtube.com/watch?v=thumb000002");
  });

  it("requests only the canonical watch URL from the fixed oEmbed endpoint", async () => {
    fetchMock.mockResolvedValue(titleResponse("Real provider title"));
    render(
      <YouTubeEmbed url="https://www.youtube.com/watch?v=title000001&si=tracking#frag" compact />,
    );
    expect(await screen.findByText("Real provider title")).toBeTruthy();
    const [requested, init] = lastFetch();
    expect(requested).toBe(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dtitle000001&format=json",
    );
    expect(requested).not.toContain("si=");
    expect(requested).not.toContain("frag");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("keeps playback available when the metadata request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<YouTubeEmbed url="https://youtu.be/fail0000001" compact />);
    await settleTitleLookup();
    expect(screen.getByText("YouTube video")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const player = await screen.findByTitle("Embedded YouTube video");
    expect(player.getAttribute("src")).toBe("https://www.youtube.com/embed/fail0000001");
  });

  it.each([
    ["bad00000001", 42],
    ["bad00000002", "   "],
    ["bad00000003", "x".repeat(201)],
  ])("ignores an unusable oEmbed title for %s", async (videoId, title) => {
    fetchMock.mockResolvedValue(titleResponse(title));
    render(<YouTubeEmbed url={`https://youtu.be/${videoId}`} compact />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settleTitleLookup();
    expect(screen.getByText("YouTube video")).toBeTruthy();
  });

  it("looks a title up once for the same video", async () => {
    fetchMock.mockResolvedValue(titleResponse("Cached provider title"));
    const first = render(<YouTubeEmbed url="https://youtu.be/dedup000001" compact />);
    expect(await screen.findByText("Cached provider title")).toBeTruthy();
    first.unmount();

    render(<YouTubeEmbed url="https://youtu.be/dedup000001" compact />);
    expect(await screen.findByText("Cached provider title")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the metadata request when the card unmounts", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return unresolved();
    });
    const view = render(<YouTubeEmbed url="https://youtu.be/abort000001" compact />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("never paints a late title from a previous video", async () => {
    const first = deferred();
    const second = deferred();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const view = render(<YouTubeEmbed url="https://youtu.be/late0000001" compact />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    view.rerender(<YouTubeEmbed url="https://youtu.be/late0000002" compact />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(titleResponse("Old video title"));
    });
    expect(screen.queryByText("Old video title")).toBeNull();

    await act(async () => {
      second.resolve(titleResponse("New video title"));
    });
    expect(await screen.findByText("New video title")).toBeTruthy();
    expect(screen.queryByText("Old video title")).toBeNull();
  });

  it("opens one compact player in the overlay and restores focus on close", async () => {
    fetchMock.mockImplementation(unresolved);
    render(<YouTubeEmbed url="https://youtu.be/overlay0001" compact />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    await screen.findByTitle("Embedded YouTube video");

    const trigger = screen.getByRole("button", { name: "Watch larger" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Video player" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTitle("Embedded YouTube video")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Close video" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Video player" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
