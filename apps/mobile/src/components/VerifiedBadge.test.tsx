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

  it("shows the display name and timestamp after the identity and badge, with no handle", () => {
    const post = makePost("badge-test");
    post.author = { ...post.author, emailVerified: true, phoneVerified: false };
    render(<MemoryRouter><PostIdentityHeader post={post} /></MemoryRouter>);
    const badge = screen.getByRole("img", { name: "Email verified" });
    const name = screen.getByRole("link", { name: "Open Samira's profile" });
    const time = screen.getByTestId("post-time");
    expect(name.textContent).toContain("Samira");
    expect(name.textContent).not.toContain("@");
    expect(screen.queryByText(`@${post.author.username}`)).toBeNull();
    expect(name.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(badge.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(time.getAttribute("title")).toBe(new Date(post.createdAt).toLocaleString());
  });
});
