// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { PostItem } from "@norfold/shared";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatReportPreview } from "./ChatReportPreview";

const origin = "https://findbackapp.social";
const REPORT = "5b6f7c8d-1234-4abc-8def-123456789012";

function post(overrides: Partial<PostItem> = {}): PostItem {
  return {
    id: REPORT,
    userId: "author-1",
    author: {
      id: "author-1",
      username: "sam",
      emailVerified: true,
      phoneVerified: false,
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    type: "FOUND",
    title: "Blue wallet",
    description: "Found near the station.",
    category: "Bags & Wallets",
    status: "OPEN",
    eventDate: "2026-10-20",
    latitude: null,
    longitude: null,
    locationLabel: "Near the station",
    youtubeUrl: null,
    attachments: [],
    likeCount: 0,
    dislikeCount: 0,
    ratingAvg: null,
    ratingCount: 0,
    commentCount: 0,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...overrides,
  };
}

function frame(children: ReactNode) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("ChatReportPreview", () => {
  it("renders one compact link with the real report facts and host", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    render(frame(<ChatReportPreview post={post({ status: "RECOVERED" })} reportId={REPORT}
      coverSrc="/wallet.jpg" />));

    const link = screen.getByRole("link", { name: /Blue wallet/ });
    expect(link.getAttribute("href")).toBe(`/posts/${REPORT}`);
    expect(link.getAttribute("data-chat-report")).toBe(REPORT);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();

    const cover = link.querySelector("img");
    expect(cover?.getAttribute("src")).toBe("/wallet.jpg");
    // The title beside the picture carries the meaning; the cover is decorative.
    expect(cover?.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();

    expect(screen.getByText("Found report")).toBeTruthy();
    expect(screen.getByText("Near the station")).toBeTruthy();
    expect(screen.getByText("Recovered")).toBeTruthy();
    expect(link.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-20");
    expect(screen.getByText("findbackapp.social")).toBeTruthy();
  });

  it("does not repeat the Lost/Found fact as a second badge while the report is open", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    render(frame(<ChatReportPreview post={post({ type: "LOST", status: "OPEN" })} reportId={REPORT} />));

    expect(screen.getByText("Lost report")).toBeTruthy();
    expect(screen.getByText("Blue wallet")).toBeTruthy();
    expect(screen.queryByTestId("post-status-chip")).toBeNull();
  });

  it("keeps a resolved lifecycle state as the canonical status chip", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    render(frame(<ChatReportPreview post={post({ status: "MATCHED" })} reportId={REPORT} />));

    expect(screen.getByTestId("post-status-chip").textContent).toContain("Matched");
  });

  it("invents no cover when the parent resolved none", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const { container } = render(frame(<ChatReportPreview post={post()} reportId={REPORT} coverSrc={null} />));

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Blue wallet")).toBeTruthy();
  });

  it("omits the place line when the report has no location label", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const { container } = render(frame(<ChatReportPreview post={post({ locationLabel: null })} reportId={REPORT} />));

    expect(container.querySelector(".fb-chat-report-preview-place")).toBeNull();
    expect(screen.getByText("Blue wallet")).toBeTruthy();
  });

  it("never fabricates a host when the public share origin is unconfigured", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", "");
    const { container } = render(frame(<ChatReportPreview post={post()} reportId={REPORT} />));

    expect(container.querySelector(".fb-chat-report-preview-domain")).toBeNull();
    expect(screen.getByRole("link", { name: /Blue wallet/ })).toBeTruthy();
  });
});
