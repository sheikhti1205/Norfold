// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { VerifiedBadge, verifiedTier } from "./VerifiedBadge";
import { PostIdentityHeader } from "./PostAnatomy";
import { makePost } from "../fixture/posts";

afterEach(cleanup);

describe("verification badges", () => {
  it.each([
    [false, false, false, "none"], [true, false, false, "email"],
    [false, true, false, "phone"], [true, true, false, "both"],
    [false, false, true, "phone"], [true, false, true, "both"],
    [undefined, undefined, undefined, "none"],
  ] as const)("maps flags %s %s %s to %s", (email, phone, telegram, tier) => {
    expect(verifiedTier(email, phone, telegram)).toBe(tier);
  });

  it.each([
    [true, false, "Email verified"], [false, true, "Phone verified"],
    [true, true, "Email and phone verified"],
  ] as const)("renders exactly one accessible badge", (email, phone, label) => {
    render(<VerifiedBadge emailVerified={email} phoneVerified={phone} />);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: label })).toBeTruthy();
  });

  it("renders no placeholder for an unverified account", () => {
    const { container } = render(<VerifiedBadge />);
    expect(container.childNodes).toHaveLength(0);
  });

  it("shows the handle and timestamp after the identity and badge", () => {
    const post = makePost("badge-test");
    post.author = { ...post.author, emailVerified: true, phoneVerified: false };
    render(<MemoryRouter><PostIdentityHeader post={post} /></MemoryRouter>);
    const badge = screen.getByRole("img", { name: "Email verified" });
    const handle = screen.getByTestId("post-author");
    const time = screen.getByTestId("post-time");
    expect(handle.textContent).toBe(`@${post.author.username}`);
    expect(handle.className).not.toContain("sr-only");
    expect(badge.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(time.getAttribute("title")).toBe(new Date(post.createdAt).toLocaleString());
  });
});
