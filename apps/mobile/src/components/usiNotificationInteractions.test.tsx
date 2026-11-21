// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), fine: true }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./inputCapabilities", () => ({ useFinePointer: () => mocks.fine }));
vi.mock("../services/notifications", () => ({
  fetchNotifications: mocks.fetch, markNotificationsRead: vi.fn(async () => 1),
  markNotificationsUnread: vi.fn(async () => 1), deleteNotifications: vi.fn(async () => 1),
  restoreNotifications: vi.fn(async () => 1),
}));
import { ACTION_RAIL_HOVER_MS, Notifications } from "../screens/Notifications";

const row = (extra: Record<string, unknown> = {}) => ({
  id: "n1", type: "LIKE", preview: null, read: false, createdAt: new Date().toISOString(),
  actorId: "actor", actorUsername: "Maya", postId: "post", postTitle: "Wallet", commentId: null,
  reactionKind: null, ...extra,
});
const show = () => render(<MemoryRouter><Notifications /></MemoryRouter>);
beforeEach(() => { mocks.fine = true; mocks.fetch.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("notification interactions", () => {
  it("opens the one floating rail after the hover dwell, with the three actions", async () => {
    mocks.fetch.mockResolvedValue([row()]);
    show();
    const element = await screen.findByTestId("notification-row");
    vi.useFakeTimers();
    fireEvent.pointerEnter(element, { pointerType: "mouse" });
    await act(async () => { await vi.advanceTimersByTimeAsync(ACTION_RAIL_HOVER_MS + 50); });
    const rails = screen.getAllByRole("toolbar");
    expect(rails).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from activity" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the same rail from the three-dot trigger instead of an older menu", async () => {
    mocks.fine = false;
    mocks.fetch.mockResolvedValue([row()]);
    show();
    await screen.findByTestId("notification-row");
    fireEvent.click(screen.getByRole("button", { name: /More actions for/i }));
    expect(await screen.findByRole("toolbar")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
  });

  it("leaves the row itself as the only trigger when hover is available", async () => {
    mocks.fetch.mockResolvedValue([row()]);
    show();
    await screen.findByTestId("notification-row");
    expect(screen.queryByRole("button", { name: /More actions for/i })).toBeNull();
  });

  it("portals the rail into the enclosing popover instead of an inert body sibling", async () => {
    mocks.fine = false;
    mocks.fetch.mockResolvedValue([row()]);
    const view = render(
      <MemoryRouter>
        <section className="fb-popover fb-notification-popover">
          <Notifications preview />
        </section>
      </MemoryRouter>,
    );
    await screen.findByTestId("notification-row");
    fireEvent.click(screen.getByRole("button", { name: /More actions for/i }));
    const rail = await screen.findByRole("toolbar");
    // A popover marks every outside body child inert. A body-portaled rail still
    // hovers and paints, but every click falls through to the row's report link.
    expect(rail.parentElement).toBe(view.container.querySelector(".fb-popover"));
    expect(rail.parentElement).not.toBe(document.body);
  });

  it("keeps one rail when a right-click is followed by hover", async () => {
    mocks.fetch.mockResolvedValue([row()]);
    show();
    const link = await screen.findByRole("link", { name: /Maya.*Wallet/i });
    fireEvent.contextMenu(link);
    expect(await screen.findByRole("toolbar")).toBeTruthy();
    fireEvent.pointerEnter(screen.getByTestId("notification-row"), { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    // The existing rail stays open: hover does not tear it down and re-arm it.
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(document.querySelector(".fb-notification-card")).toBeNull();
  });

  it("opens from the keyboard context-menu key and returns focus on Escape", async () => {
    mocks.fetch.mockResolvedValue([row()]); show();
    const link = await screen.findByRole("link", { name: /Maya.*Wallet/i });
    link.focus(); fireEvent.keyDown(link, { key: "ContextMenu" });
    expect(await screen.findByRole("toolbar")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it("offers Restore in the deleted view's rail", async () => {
    mocks.fine = false;
    mocks.fetch.mockResolvedValue([row()]); show();
    fireEvent.click(screen.getByRole("button", { name: "Deleted" }));
    await screen.findByTestId("notification-row");
    fireEvent.click(screen.getByRole("button", { name: /More actions for/i }));
    expect(await screen.findByRole("button", { name: "Restore to activity" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove from activity" })).toBeNull();
  });

  it("opens the Deleted rail from hover, so restore never needs a three-dot", async () => {
    mocks.fetch.mockResolvedValue([row()]); show();
    fireEvent.click(screen.getByRole("button", { name: "Deleted" }));
    const element = await screen.findByTestId("notification-row");
    fireEvent.pointerEnter(element, { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ACTION_RAIL_HOVER_MS + 40)); });
    expect(screen.getByRole("button", { name: "Restore to activity" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /More actions for/i })).toBeNull();
  });

  it.each(["MODERATION", "UNKNOWN"])('does not preview %s even with a thumbnail', async (type) => {
    mocks.fetch.mockResolvedValue([row({ type, thumbnailUrl: "https://example.com/a.jpg" })]);
    show(); const element = await screen.findByTestId("notification-row");
    fireEvent.pointerEnter(element, { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(document.querySelector(".fb-notification-card")).toBeNull();
  });

  it("previews only when a thumbnail exists", async () => {
    mocks.fetch.mockResolvedValue([row({ thumbnailUrl: "https://example.com/a.jpg" })]);
    const view = show();
    // pointerover is the browser event React turns into onPointerEnter on the
    // row, with the title itself as the target: that is the preview's owner.
    const subject = await screen.findByText("Wallet");
    fireEvent.pointerOver(subject, { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(document.querySelector(".fb-notification-card img")).toBeTruthy();
    expect(screen.queryAllByRole("toolbar")).toHaveLength(0);
    view.unmount(); mocks.fetch.mockResolvedValue([row()]); show();
    const nextSubject = await screen.findByText("Wallet");
    fireEvent.pointerOver(nextSubject, { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(document.querySelector(".fb-notification-card")).toBeNull();
  });

  it("still reaches the action rail by hovering the row of a previewable notification", async () => {
    mocks.fetch.mockResolvedValue([row({ thumbnailUrl: "https://example.com/a.jpg" })]);
    show();
    const element = await screen.findByTestId("notification-row");
    vi.useFakeTimers();
    // pointerover on the row itself is the browser path React turns into the
    // row's onPointerEnter; its target is the row, not the preview target.
    fireEvent.pointerOver(element, { pointerType: "mouse" });
    await act(async () => { await vi.advanceTimersByTimeAsync(ACTION_RAIL_HOVER_MS + 50); });
    // The row outside the preview target keeps the options reachable by hover.
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(document.querySelector(".fb-notification-card")).toBeNull();
  });

  it("replaces the preview with the rail when the pointer leaves the preview target", async () => {
    mocks.fetch.mockResolvedValue([row({ thumbnailUrl: "https://example.com/a.jpg" })]);
    show();
    const subject = await screen.findByText("Wallet");
    vi.useFakeTimers();
    fireEvent.pointerOver(subject, { pointerType: "mouse" });
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(document.querySelector(".fb-notification-card")).toBeTruthy();
    expect(screen.queryAllByRole("toolbar")).toHaveLength(0);
    fireEvent.pointerOver(screen.getByTestId("notification-row"), { pointerType: "mouse" });
    await act(async () => { await vi.advanceTimersByTimeAsync(ACTION_RAIL_HOVER_MS + 50); });
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(document.querySelector(".fb-notification-card")).toBeNull();
  });

  it("cancels a long press after movement beyond eight pixels", async () => {
    mocks.fetch.mockResolvedValue([row()]); show();
    const element = await screen.findByTestId("notification-row");
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerType: { value: "touch" }, clientX: { value: x }, clientY: { value: 0 } });
      fireEvent(element, event);
    };
    pointer("pointerdown", 0); pointer("pointermove", 9);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 475)); });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("renders an aggregated like without inventing actors", async () => {
    mocks.fetch.mockResolvedValue([row({ actorNames: ["Maya"], actorCount: 3 })]); show();
    expect(await screen.findByRole("link", { name: /Maya and 2 others liked your report/i })).toBeTruthy();
  });
});
