// @vitest-environment jsdom
import type { PostItem } from "@norfold/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge, detailStatusBadges } from "./StatusChip";

afterEach(cleanup);

const post = (fields: Pick<PostItem, "type" | "status">) => fields as PostItem;

describe("report-surface status badges", () => {
  it.each([
    { type: "LOST", status: "OPEN", badges: ["lost:Lost", "unrecovered:Unrecovered"] },
    { type: "FOUND", status: "OPEN", badges: ["found:Found", "unrecovered:Unrecovered"] },
    { type: "LOST", status: "MATCHED", badges: ["lost:Lost", "matched:Matched"] },
    { type: "FOUND", status: "RECOVERED", badges: ["found:Found", "recovered:Recovered"] },
    { type: "LOST", status: "CLOSED", badges: ["lost:Lost", "closed:Closed"] },
  ] as const)("$status $type reads as $badges", ({ type, status, badges }) => {
    expect(detailStatusBadges(post({ type, status })).map(({ kind, label }) => `${kind}:${label}`))
      .toEqual([...badges]);
  });

  it("renders a tone class, an icon and the label as text", () => {
    render(<StatusBadge kind="unrecovered" label="Unrecovered" testId="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("Unrecovered");
    expect(badge.getAttribute("data-status")).toBe("unrecovered");
    expect(badge.className).toContain("fb-type-badge");
    expect(badge.className).toContain("fb-status-open");
    expect(badge.querySelector("svg")).toBeTruthy();
  });
});
