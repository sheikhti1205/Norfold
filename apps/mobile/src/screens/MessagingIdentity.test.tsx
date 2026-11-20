// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { ChatIdentity } from "./Messaging";

afterEach(cleanup);

it("is one direct link to the full-screen profile, with no card until it is asked for", () => {
  const name = "a-very-long-participant-name-that-needs-to-remain-readable";
  render(<MemoryRouter><ChatIdentity peerId="peer" username="peer_name" name={name} status="Friends" /></MemoryRouter>);
  const link = screen.getByRole("link", { name: `Open ${name}'s profile` });
  expect(link.getAttribute("href")).toBe("/u/peer_name");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: `About ${name}` })).toBeNull();
});

it("does not offer participant details before a name is available", () => {
  render(<ChatIdentity status="Friends" />);
  expect(screen.getByText("Conversation")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

it("treats the avatar and name as one identity link without a dropdown chevron", () => {
  render(<MemoryRouter><ChatIdentity peerId="peer" username="peer_name" name="peer_name" status="Friends" /></MemoryRouter>);
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
  render(<MemoryRouter><ChatIdentity peerId="peer" name="Sam Rivera" username="sam_r" status="Friends" conversationId="c1" /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Open Sam Rivera's profile" });
  expect(link.textContent).toContain("Sam Rivera");
  expect(link.textContent).not.toContain("@sam_r");
  expect(link.getAttribute("href")).toBe("/u/sam_r?conversation=c1");
});

it("keeps the default full-page identity on its 44px squircle", () => {
  render(<MemoryRouter><ChatIdentity peerId="peer" username="peer_name" name="peer_name" status="Friends" /></MemoryRouter>);
  const avatar = screen.getByTestId("user-avatar");
  expect(avatar.style.width).toBe("44px");
  expect(avatar.style.height).toBe("44px");
  expect(avatar.classList.contains("fb-avatar-squircle")).toBe(true);
  expect(avatar.classList.contains("rounded-full")).toBe(false);
});

it("renders the dock variant as a 40px circle behind the one identity link", () => {
  render(<MemoryRouter><ChatIdentity variant="dock" peerId="peer" username="peer_name" name="peer_name" status="Friends" muted /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Open peer_name's profile" });
  const avatar = link.querySelector('[data-testid="user-avatar"]') as HTMLElement;
  expect(avatar.style.width).toBe("40px");
  expect(avatar.style.height).toBe("40px");
  expect(avatar.classList.contains("rounded-full")).toBe(true);
  expect(avatar.classList.contains("fb-avatar-squircle")).toBe(false);
  expect(link.textContent).toContain("peer_name");
  // The real relationship line and muted badge stay; no presence state exists.
  expect(document.querySelector(".fb-chat-secondary")?.textContent).toContain("Friends");
  expect(screen.getByRole("img", { name: "Notifications muted" })).toBeTruthy();
  expect(screen.queryByText(/active now/i)).toBeNull();
});

it("stacks the dock relationship line inside the identity copy, beside the avatar", () => {
  render(<MemoryRouter><ChatIdentity variant="dock" peerId="peer" username="peer_name" name="peer_name" status="Friends" muted /></MemoryRouter>);
  const copy = document.querySelector(".fb-chat-identity-copy") as HTMLElement | null;
  const status = copy?.querySelector(".fb-chat-secondary") as HTMLElement | null;
  expect(status).toBeTruthy();
  // A span, not a paragraph: the copy sits inside the heading link.
  expect(status!.tagName).toBe("SPAN");
  expect(status!.textContent).toContain("Friends");
  // One copy column: the name first, the relationship line directly under it.
  expect(copy!.firstElementChild?.classList.contains("fb-chat-identity-name")).toBe(true);
  expect(copy!.lastElementChild).toBe(status);
  // Still inside the one heading, so the avatar and both lines are one row.
  expect(copy!.closest("h1")).toBeTruthy();
  expect(document.querySelectorAll(".fb-chat-heading .fb-chat-secondary")).toHaveLength(1);
  // Nothing hangs below the heading identity: no second status block.
  expect(document.querySelector(".fb-chat-heading > p.fb-chat-secondary")).toBeNull();
});

it("keeps the full-page relationship line below the heading, outside the h1", () => {
  render(<MemoryRouter><ChatIdentity peerId="peer" username="peer_name" name="peer_name" status="Friends" /></MemoryRouter>);
  const heading = document.querySelector(".fb-chat-heading") as HTMLElement;
  const h1 = heading.querySelector("h1") as HTMLElement;
  const status = heading.querySelector("p.fb-chat-secondary") as HTMLElement | null;
  expect(status).toBeTruthy();
  expect(status!.tagName).toBe("P");
  expect(h1.contains(status)).toBe(false);
  // The copy holds the name only; the dock-only stacking never reaches the page.
  expect(document.querySelector(".fb-chat-identity-copy .fb-chat-secondary")).toBeNull();
  expect(document.querySelector(".fb-chat-identity-copy")!.children).toHaveLength(1);
});
