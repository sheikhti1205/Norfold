// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

const origin = "https://findbackapp.social";
const id = "5b6f7c8d-1234-4abc-8def-123456789012";
const id2 = "0f0e0d0c-1111-4222-8333-444455556666";

function frame(children: ReactNode) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ChatMessageText", () => {
  it("renders the body exactly inside one paragraph", () => {
    const body = "Meet at 5 🎉\nhttps://example.com/a?x=1";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe(body);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(paragraph?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector(".fb-chat-message-previews")).toBeNull();

    const anchor = container.querySelector("a");
    expect(anchor?.textContent).toBe("https://example.com/a?x=1");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/a?x=1");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("opens safe generic links without fetching any metadata", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = "Read https://example.com/report/1 now";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe(body);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links a canonical report internally and renders one live preview", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const url = `${origin}/r/${id}?focus=comments&comment=${id}`;
    const body = `Shared ${url} again`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    const anchor = container.querySelector("a");
    expect(anchor?.textContent).toBe(url);
    expect(anchor?.getAttribute("href")).toBe(`/posts/${id}?comment=${id}#detail-comments`);

    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(id);
    expect(screen.getByTestId("report-preview").textContent).toBe(id);
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("renders each report card once while keeping every link", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${origin}/api/share/${id} ${origin}/r/${id} ${origin}/r/${id2}`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={preview} />));

    expect(preview.mock.calls).toEqual([[id], [id2]]);
    expect(screen.getAllByTestId("report-preview").map((node) => node.textContent)).toEqual([id, id2]);
    expect(container.querySelectorAll("a")).toHaveLength(3);
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("suppresses a preview whose report is already the message context", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = `${origin}/r/${id} ${origin}/r/${id}`;
    const preview = vi.fn((postId: string) => <span data-testid="report-preview">{postId}</span>);
    const { container } = render(frame(
      <ChatMessageText body={body} contextReportId={id} renderReportPreview={preview} />,
    ));

    expect(preview).not.toHaveBeenCalled();
    expect(container.querySelector(".fb-chat-message-previews")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(`/posts/${id}`);
    expect(container.querySelector("p")?.textContent).toBe(body);
  });

  it("mounts a YouTube player only after a deliberate press", async () => {
    const body = "Watch https://youtu.be/dQw4w9WgXcQ now";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelector("p")?.textContent).toBe(body);
    expect(screen.queryByTitle("Embedded YouTube video")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const player = await screen.findByTitle("Embedded YouTube video");
    expect(player.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("keeps repeated YouTube links as text but renders one player", () => {
    const body = "https://youtu.be/dQw4w9WgXcQ and https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));

    expect(container.querySelectorAll("p a")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Play video" })).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe(body);
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

  it("preserves mixed punctuation and unicode around a link", () => {
    const body = "héllo 🎉 (https://example.com/a), “ok”... done";
    const { container } = render(frame(<ChatMessageText body={body} renderReportPreview={() => null} />));
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/a");
    expect(anchor?.textContent).toBe("https://example.com/a");
    expect(container.querySelector("p")?.textContent).toBe(body);
  });
});
