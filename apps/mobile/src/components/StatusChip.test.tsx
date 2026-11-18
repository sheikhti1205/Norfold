// @vitest-environment jsdom
import type { PostItem, PostStatus, PostType } from "@norfold/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge, detailStatusBadges } from "./StatusChip";

afterEach(cleanup);

function badgesFor(type: PostType, status: PostStatus) {
  return detailStatusBadges({ type, status } as PostItem).map(({ kind, label }) => `${kind}:${label}`);
}

describe("report-surface status badges", () => {
  it("reads the type and lifecycle as two separate facts", () => {
    expect(badgesFor("FOUND", "OPEN")).toEqual(["found:Found", "unrecovered:Unrecovered"]);
    expect(badgesFor("LOST", "OPEN")).toEqual(["lost:Lost", "unrecovered:Unrecovered"]);
    expect(badgesFor("LOST", "MATCHED")).toEqual(["lost:Lost", "matched:Matched"]);
    expect(badgesFor("FOUND", "RECOVERED")).toEqual(["found:Found", "recovered:Recovered"]);
    expect(badgesFor("LOST", "CLOSED")).toEqual(["lost:Lost", "closed:Closed"]);
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
