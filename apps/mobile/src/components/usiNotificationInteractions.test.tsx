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
import { Notifications } from "../screens/Notifications";

const row = (extra: Record<string, unknown> = {}) => ({
  id: "n1", type: "LIKE", preview: null, read: false, createdAt: new Date().toISOString(),
  actorId: "actor", actorUsername: "Maya", postId: "post", postTitle: "Wallet", commentId: null,
  reactionKind: null, ...extra,
});
const show = () => render(<MemoryRouter><Notifications /></MemoryRouter>);
beforeEach(() => { mocks.fine = true; mocks.fetch.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("notification interactions", () => {
  it("adds fine-pointer actions but does not add them on touch-only input", async () => {
    mocks.fetch.mockResolvedValue([row()]);
    const view = show();
    await screen.findByTestId("notification-row");
    expect(screen.getByText("Mark as read")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
    view.unmount(); mocks.fine = false; show();
    await screen.findByTestId("notification-row");
    expect(screen.queryByText("Mark as read")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
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
    const view = show(); const element = await screen.findByTestId("notification-row");
    fireEvent.pointerEnter(element, { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(document.querySelector(".fb-notification-card img")).toBeTruthy();
    view.unmount(); mocks.fetch.mockResolvedValue([row()]); show();
    fireEvent.pointerEnter(await screen.findByTestId("notification-row"), { pointerType: "mouse" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(document.querySelector(".fb-notification-card")).toBeNull();
  });

  it("opens on right click and returns focus on Escape", async () => {
    mocks.fetch.mockResolvedValue([row()]); show();
    const link = await screen.findByRole("link", { name: /Maya.*Wallet/i });
    fireEvent.contextMenu(link);
    expect(await screen.findByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Mark as read" }), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(link));
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
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a context menu with the keyboard and restores row focus", async () => {
    mocks.fetch.mockResolvedValue([row()]); show();
    const link = await screen.findByRole("link", { name: /Maya.*Wallet/i });
    link.focus(); fireEvent.keyDown(link, { key: "ContextMenu" });
    expect(await screen.findByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Mark as read" }), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it("renders an aggregated like without inventing actors", async () => {
    mocks.fetch.mockResolvedValue([row({ actorNames: ["Maya"], actorCount: 3 })]); show();
    expect(await screen.findByRole("link", { name: /Maya and 2 others liked your report/i })).toBeTruthy();
  });

  it("offers report and copy only when the target and public link are available", async () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", "https://example.com");
    mocks.fetch.mockResolvedValue([row({ postId: "11111111-1111-4111-8111-111111111111" })]);
    const view = show();
    fireEvent.contextMenu(await screen.findByTestId("notification-row"));
    expect(await screen.findByRole("menuitem", { name: "Report" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();
    view.unmount(); mocks.fetch.mockResolvedValue([row({ postId: null })]); show();
    fireEvent.contextMenu(await screen.findByTestId("notification-row"));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: "Report" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
  });
});
