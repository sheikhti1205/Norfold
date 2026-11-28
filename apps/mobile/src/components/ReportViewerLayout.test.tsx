// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportViewerLayout, type ReportViewerLayoutProps } from "./ReportViewerLayout";

afterEach(cleanup);

const props: ReportViewerLayoutProps = {
  identity: <span>Author</span>,
  title: <span>Title</span>,
  description: <span>Description</span>,
  meta: <span>Facts</span>,
  reportExtra: <span>Extra</span>,
  comments: "Comments",
  actions: "Actions",
  composer: "Composer",
};

describe("ReportViewerLayout", () => {
  it("renders named panes and report content with media", () => {
    render(<ReportViewerLayout {...props} media={<span>Photo</span>} />);
    const report = screen.getByRole("region", { name: "Report" });
    expect(report).toBe(screen.getByTestId("report-viewer-report-pane"));
    expect(screen.getByRole("region", { name: "Conversation" })).toBe(screen.getByTestId("report-viewer-conversation-pane"));
    for (const text of ["Author", "Title", "Description", "Facts"]) expect(within(report).getByText(text)).toBeTruthy();
    expect(within(report).getByTestId("report-viewer-media")).toBeTruthy();
  });

  it("omits the media region when media is absent", () => {
    render(<ReportViewerLayout {...props} />);
    expect(screen.queryByTestId("report-viewer-media")).toBeNull();
  });

  it("places comments before the footer and actions before the composer", () => {
    render(<ReportViewerLayout {...props} />);
    const footer = screen.getByTestId("report-viewer-footer");
    expect(screen.getByText("Comments").compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Actions").compareDocumentPosition(screen.getByText("Composer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps extra report content out of the conversation", () => {
    render(<ReportViewerLayout {...props} />);
    expect(within(screen.getByTestId("report-viewer-report-pane")).getByText("Extra")).toBeTruthy();
    expect(within(screen.getByTestId("report-viewer-conversation-pane")).queryByText("Extra")).toBeNull();
  });

  it("opens on the report title, ahead of the media", () => {
    render(<ReportViewerLayout {...props} media={<span>Photo</span>} />);
    const report = screen.getByRole("region", { name: "Report" });
    const title = within(report).getByText("Title");
    const photo = within(report).getByTestId("report-viewer-media");
    expect(title.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the action row in the report when the conversation is its own surface", () => {
    render(<ReportViewerLayout {...props} conversation={false} />);
    const report = screen.getByRole("region", { name: "Report" });
    expect(screen.queryByTestId("report-viewer-conversation-pane")).toBeNull();
    expect(within(report).getByTestId("report-viewer-inline-actions")).toBeTruthy();
    expect(within(report).getByText("Actions")).toBeTruthy();
    expect(screen.queryByText("Composer")).toBeNull();
  });
});

describe("ReportViewerLayout surface contract", () => {
  const css = readFileSync("src/components/ReportViewerLayout.css", "utf8");

  it("keeps one readable measure and a foot clear of the panel floor", () => {
    expect(css).toContain("max-width: min(100%, 32rem);");
    expect(css).toContain("padding: 10px 16px 32px;");
    expect(css).toContain("scroll-padding-block-end: 24px;");
  });

  it("anchors the close control to the panel corner, not the conversation divider", () => {
    expect(css).not.toContain(".fb-report-panel .fb-floating-close");
  });

  it("fades the report column edges instead of slicing content at the seam", () => {
    expect(css).toContain("linear-gradient(to bottom, var(--fb-surface), transparent)");
    expect(css).toContain("linear-gradient(to top, var(--fb-surface), transparent)");
  });

  it("keeps the split conversation at its comfort width and the panel wide enough to hold it", () => {
    expect(css).toContain("--fb-rv-conversation: clamp(420px, 40%, 44%);");
    expect(css).toContain("width: var(--fb-rv-conversation);");
    expect(css).toContain("min-width: 420px;");
    expect(css).toContain("right: var(--fb-rv-conversation);");
    expect(css).not.toContain("right: clamp(");
    expect(css).toContain(".fb-modal-panel.fb-report-panel:has(.fb-rv[data-conversation=\"split\"]) { max-width: min(92%, 60rem); }");
  });
});
