// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { ChatIdentity } from "./Messaging";

afterEach(cleanup);

it("is one direct link to the full-screen profile, with no popover step", () => {
  const name = "a-very-long-participant-name-that-needs-to-remain-readable";
  render(<MemoryRouter><ChatIdentity peerId="peer" username="peer_name" name={name} status="Connected" /></MemoryRouter>);
  const link = screen.getByRole("link", { name: `Open ${name}'s profile` });
  expect(link.getAttribute("href")).toBe("/u/peer_name");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: `About ${name}` })).toBeNull();
});

it("does not offer participant details before a name is available", () => {
  render(<ChatIdentity status="Connected" />);
  expect(screen.getByText("Conversation")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

it("treats the avatar and name as one identity link without a dropdown chevron", () => {
  render(<MemoryRouter><ChatIdentity peerId="peer" username="peer_name" name="peer_name" status="Connected" /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Open peer_name's profile" });
  const avatar = link.querySelector('[data-testid="user-avatar"]') as HTMLElement | null;
  expect(avatar).toBeTruthy();
  expect(avatar!.style.width).toBe("44px");
  expect(avatar!.style.height).toBe("44px");
  expect(link.textContent).toContain("peer_name");
  expect(link.textContent).not.toContain("@");
  expect(document.querySelector(".lucide-chevron-down")).toBeNull();
});

it("carries the conversation context the profile page revalidates", () => {
  render(<MemoryRouter><ChatIdentity peerId="peer" name="Sam Rivera" username="sam_r" status="Connected" conversationId="c1" /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Open Sam Rivera's profile" });
  expect(link.textContent).toContain("Sam Rivera");
  expect(link.textContent).not.toContain("@sam_r");
  expect(link.getAttribute("href")).toBe("/u/sam_r?conversation=c1");
});
