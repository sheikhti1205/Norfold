// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

const origin = "https://findbackapp.social";
const id = "5b6f7c8d-1234-4abc-8def-123456789012";
const id2 = "0f0e0d0c-1111-4222-8333-444455556666";
const video = "https://youtu.be/dQw4w9WgXcQ";

/**
 * A visible generic card asks the service for metadata. These tests assert the
 * card and the suppressed URL, not the provider, so that request stays pending:
 * no jsdom network and no late state update. Link classification is the real
 * service code, so previewable and non-previewable cases stay honest.
 */
vi.mock("../services/linkPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/linkPreview")>();
  return { ...actual, fetchLinkPreview: vi.fn(() => new Promise<never>(() => {})) };
});

function frame(children: ReactNode) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

/** The compact player asks the provider for a title; never let a test reach it. */
function stubProvider(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
}

/** The address of a fetch input (string, URL or Request-like), or "" when absent. */
function fetchTarget(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown } | null)?.url;
  return typeof url === "string" ? url : "";
}

/**
 * The exact host of a fetch target, or "" when it cannot be resolved.
 *
 * A substring test is not a host check: `example.com.evil.test` and a query
 * string holding that text both contain "example.com" while addressing another
 * host. Resolving the input and comparing the parsed hostname is the assertion
 * this test actually means to make.
 */
function fetchHost(input: unknown): string {
  const target = fetchTarget(input);
  if (target === "") return "";
  try {
    // A relative request resolves against a fixed base: it cannot name the
    // pasted host, and no test depends on a particular page origin.
    return new URL(target, "https://norfold.test").hostname;
  } catch {
    return "";
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ChatMessageText", () => {
  it("renders an ordinary body exactly inside one paragraph", () => {
    // HTTP is deliberately not previewable, so this stays the inline safe anchor.
    const body = "Meet at 5 🎉\nhttp://example.com/a?x=1";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe(body);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(paragraph?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector(".fb-chat-message-previews")).toBeNull();

    const anchor = container.querySelector("a");
    expect(anchor?.textContent).toBe("http://example.com/a?x=1");
    expect(anchor?.getAttribute("href")).toBe("http://example.com/a?x=1");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("mounts one generic card for a previewable link and hides its raw URL", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const link = "https://example.com/report/1";
    const body = `Read ${link} now`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe("Read now");
    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
    expect(screen.queryByText(link)).toBeNull();

    const cards = container.querySelectorAll(".fb-chat-message-previews > .fb-linkp");
    expect(cards).toHaveLength(1);
    const anchor = cards[0]?.querySelector("a.fb-linkp-link");
    expect(anchor?.getAttribute("href")).toBe(link);
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    // Rendering prose must never contact the pasted host by itself, whatever
    // form the request target takes.
    expect(fetchMock.mock.calls.some(([input]) => fetchHost(input) === "example.com")).toBe(false);
  });

  it("renders one card for a repeated generic destination and hides every raw copy", () => {
    // Two spellings that normalize to the same destination own one card.
    const link = "https://example.com/a?x=1";
    const variant = `${link}#again`;
    const body = `${link} and ${variant}`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    const cards = container.querySelectorAll(".fb-chat-message-previews > .fb-linkp");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.querySelector("a")?.getAttribute("href")).toBe(link);
    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
    expect(screen.queryByText(link)).toBeNull();
    expect(screen.queryByText(variant)).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("and");
  });

  it("renders two cards for two different destinations in body order", () => {
    const first = "https://example.com/a";
    const second = "https://example.org/b";
    const body = `${first} ${second}`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    const cards = container.querySelectorAll(".fb-chat-message-previews > .fb-linkp");
    expect(cards).toHaveLength(2);
    expect(Array.from(cards, (card) => card.querySelector("a")?.getAttribute("href"))).toEqual([first, second]);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
  });

  it.each([
    ["plain HTTP", "http://example.com/a"],
    ["a local host", "https://localhost/x"],
    ["a private address", "https://192.168.1.5/x"],
    ["a non-default port", "https://example.com:8443/x"],
  ])("keeps %s as its inline anchor with no card", (_name, link) => {
    const body = `See ${link} now`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector(".fb-chat-message-previews")).toBeNull();
    const anchors = container.querySelectorAll(".fb-chat-message-text a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toBe(link);
    expect(anchors[0]?.getAttribute("href")).toBe(link);
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("replaces a represented report URL with one live preview", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const url = `${origin}/r/${id}?focus=comments&comment=${id}`;
    const body = `Shared ${url} again`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    // The preview is the representation; the provider URL is not printed above it.
    expect(container.querySelector("p")?.textContent).toBe("Shared again");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain(origin);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(id);
    expect(screen.getByTestId("report-preview").textContent).toBe(id);
  });

  it("renders one card per report id, never a paragraph of bare URLs", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${origin}/api/share/${id} ${origin}/r/${id} ${origin}/r/${id2}`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    expect(preview.mock.calls).toEqual([[id], [id2]]);
    expect(screen.getAllByTestId("report-preview").map((node) => node.textContent)).toEqual([id, id2]);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelectorAll(".fb-chat-message-previews > *")).toHaveLength(2);
  });

  it("suppresses a URL and its card when the report is already the message context", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${origin}/r/${id} ${origin}/r/${id}`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(
      <ChatMessageText body={body} contextReportId={id} renderReportPreview={preview} />,
    ));

    expect(preview).not.toHaveBeenCalled();
    expect(container.querySelector(".fb-chat-message-previews")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  const emptyCards: Array<[string, () => ReactNode]> = [
    ["null", () => null],
    ["undefined", () => undefined],
    ["false", () => false],
  ];
  it.each(emptyCards)("keeps the safe anchor when the parent card is %s", (_name, preview) => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const url = `${origin}/r/${id}`;
    const body = `${url} shared`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    expect(container.querySelector(".fb-chat-message-previews")).toBeNull();
    const anchor = container.querySelector("a");
    expect(anchor?.textContent).toBe(url);
    expect(anchor?.getAttribute("href")).toBe(`/posts/${id}`);
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("mounts a YouTube player only after a deliberate press and hides its raw URL", async () => {
    stubProvider();
    const body = `Watch ${video} now`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe("Watch now");
    // The player card may state its own host; the pasted URL is not in the prose.
    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
    expect(screen.queryByText(video)).toBeNull();
    expect(screen.queryByTitle("Embedded YouTube video")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const player = await screen.findByTitle("Embedded YouTube video");
    expect(player.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("renders one player for repeated video links instead of their URLs", () => {
    stubProvider();
    const other = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const body = `${video} and ${other}`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
    expect(screen.queryByText(video)).toBeNull();
    expect(screen.queryByText(other)).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("and");
    expect(screen.getAllByRole("button", { name: "Play video" })).toHaveLength(1);
  });

  it("keeps report and video previews in body order", () => {
    stubProvider();
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${video} ${origin}/r/${id}`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    const previews = container.querySelector(".fb-chat-message-previews");
    expect(previews?.children).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
    expect(screen.getByTestId("report-preview").textContent).toBe(id);
    expect(container.querySelector("p")).toBeNull();
  });

  it("shows a generic card beside a represented report", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const link = "https://example.com/a";
    const body = `Details ${link} ${origin}/r/${id}`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("Details");
    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
    expect(container.querySelectorAll(".fb-chat-message-previews > .fb-linkp")).toHaveLength(1);
    expect(screen.getByTestId("report-preview").textContent).toBe(id);
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/a",
    "https://user:pass@example.com/a",
  ])("never turns an unsafe scheme or credential URL into an anchor: %s", (body) => {
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("does not treat a lookalike report origin as a Norfold report", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `https://findbackapp.social.evil.example/r/${id}`;
    const preview = vi.fn();
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    expect(preview).not.toHaveBeenCalled();
    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByText(body)).toBeNull();
    const cards = container.querySelectorAll(".fb-chat-message-previews > .fb-linkp");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.querySelector("a")?.getAttribute("href")).toBe(body);
  });

  it("revokes a previous preview when the callback or the report changes", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const first = vi.fn((postId: string) => <span data-testid="report-preview">first:{postId}</span>);
    const { rerender } = render(frame(
      <ChatMessageText body={`${origin}/r/${id}`} renderReportPreview={first} />,
    ));
    expect(screen.getByTestId("report-preview").textContent).toBe(`first:${id}`);

    const second = vi.fn((postId: string) => <span data-testid="report-preview">second:{postId}</span>);
    rerender(frame(<ChatMessageText body={`${origin}/r/${id}`} renderReportPreview={second} />));
    expect(screen.getByTestId("report-preview").textContent).toBe(`second:${id}`);
    expect(screen.queryByText(`first:${id}`)).toBeNull();

    rerender(frame(<ChatMessageText body={`${origin}/r/${id2}`} renderReportPreview={second} />));
    expect(screen.getByTestId("report-preview").textContent).toBe(`second:${id2}`);
    expect(screen.queryByText(`second:${id}`)).toBeNull();
  });

  it("keeps the parent paragraph class used for emoji sizing", () => {
    const { container } = render(frame(
      <ChatMessageText body="🎉" className="fb-chat-emoji-only" renderReportPreview={() => null} />,
    ));
    const paragraph = container.querySelector("p");
    expect(paragraph?.className.split(" ")).toContain("fb-chat-emoji-only");
    expect(paragraph?.className.split(" ")).toContain("fb-chat-message-text");
    expect(paragraph?.textContent).toBe("🎉");
  });

  it("preserves mixed punctuation and unicode around an ordinary link", () => {
    const body = "héllo 🎉 (http://example.com/a), “ok”... done";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("http://example.com/a");
    expect(anchor?.textContent).toBe("http://example.com/a");
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("drops only the redundant space around a removed link", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `Find ${origin}/r/${id} near the station`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("Find near the station");
  });

  it("keeps a meaningful line break when a represented link owns its own line", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `First line\n${origin}/r/${id}\nSecond line`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("First line\nSecond line");
  });

  it("keeps the author's newline after a represented report", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `before ${origin}/r/${id}\nafter`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("before\nafter");
  });

  it("keeps the author's blank line after a represented report", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `before ${origin}/r/${id}\n\nafter`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("before\n\nafter");
  });

  it("drops the blank line a represented report leaves at the end", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `before\n${origin}/r/${id}`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("before");
  });

  it("keeps a newline caption after a represented video", () => {
    stubProvider();
    const body = `Watch ${video}\nthanks`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe("Watch\nthanks");
  });

  it("keeps the author's newline when a generic card sits between prose", () => {
    const link = "https://example.org";
    const body = `before ${link}\nafter`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe("before\nafter");
    expect(container.querySelectorAll(".fb-chat-message-previews > .fb-linkp")).toHaveLength(1);
    expect(screen.queryByText(link)).toBeNull();
  });

  it("keeps the author's blank line when a generic card sits between prose", () => {
    const link = "https://example.org";
    const body = `before ${link}\n\nafter`;
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe("before\n\nafter");
    expect(container.querySelectorAll(".fb-chat-message-previews > .fb-linkp")).toHaveLength(1);
    expect(screen.queryByText(link)).toBeNull();
  });

  it("preserves a caption newline across mixed report, video and generic links", () => {
    stubProvider();
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `Details https://example.org\n${video}\n${origin}/r/${id}\ncaption`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    expect(container.querySelector("p")?.textContent).toBe("Details\ncaption");
    expect(container.querySelector(".fb-chat-message-text a")).toBeNull();
    expect(container.querySelectorAll(".fb-chat-message-previews > .fb-linkp")).toHaveLength(1);
    expect(screen.getByTestId("report-preview").textContent).toBe(id);
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });

  it("does not invent a leading blank line when a represented link opens the body", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${origin}/r/${id}\nafter`;
    const { container } = render(frame(
      <ChatMessageText body={body} renderReportPreview={(postId) => <span data-testid="report-preview">{postId}</span>} />,
    ));

    expect(container.querySelector("p")?.textContent).toBe("after");
  });

  it("asks the parent for one card per report id even when its card is empty", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${origin}/r/${id} ${origin}/r/${id}`;
    const preview = vi.fn(() => null);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    expect(preview).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(container.querySelector("p")?.textContent).toBe(body);
  });
});
