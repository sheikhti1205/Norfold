// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { CHAT_PANE } from "../components/panePreference";
import { chatPaneBounds, Connections } from "./Messaging";

/**
 * R19 acceptance for the conversation list at an enlarged root text size.
 *
 * Measured in Chrome at a 1440px window and a 32px root: the list
 * pane stayed at its authored 260-320px, so "Admin" broke between every letter
 * between the 44px avatar and the timestamp, and the bar's title and the
 * search placeholder were clipped. The pane's track is now derived from the
 * root size (`chatPaneBounds`) instead of a fixed pixel count, and SplitView's
 * existing viability sum decides whether that measure still fits beside a
 * thread. This suite pins the derivation and the three layouts it produces:
 * ordinary desktop, enlarged desktop, and the single routed pane.
 *
 * jsdom has no layout engine, so the split's container width is the viewport
 * fallback from `useContentWidth`; no element measurement is simulated.
 */

const m = vi.hoisted(() => {
  const view = {
    mode: "CONNECTED", request: "NONE", ownBlocked: false, ownMuted: false,
    ownHidden: false, ownDeclined: false, requestEpoch: null,
    epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[],
  };
  return {
    view,
    chat: {
      accountId: "account", status: "ready", localReady: true, error: null as string | null,
      revision: 1,
      conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }],
      currentProjections: { chat: view } as Record<string, typeof view> | null,
      displayProjections: undefined as Record<string, typeof view> | null | undefined,
    },
    refresh: vi.fn(),
  };
});

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({
  fetchAccountIdentities: async () => new Map(),
  readCachedAccountIdentities: () => new Map(),
}));
vi.mock("../services/people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/people")>()),
  searchPeople: vi.fn(),
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({
  refreshMessaging: m.refresh,
  getCachedMessagingThreadState: () => null,
  watchMessagingThread: () => () => undefined,
  markMessagingConversationRead: async () => undefined,
  sendMessagingText: vi.fn(), sendMessagingMedia: vi.fn(), sendMessagingVoice: vi.fn(),
  sendMessagingLocation: vi.fn(), clearMessagingConversation: vi.fn(), removeMessagingMessage: vi.fn(),
  changeMessagingRelationship: vi.fn(), readMessagingThreadState: async () => ({ messages: [], media: [], outbox: [] }),
  fetchMessagingReceiptView: vi.fn(), observeMessagingReceipt: vi.fn(), readMessagingMedia: vi.fn(),
  downloadMessagingMedia: vi.fn(), recoverMessagingText: vi.fn(), retryMessagingMessage: vi.fn(),
  retryMessagingMedia: vi.fn(), setMessagingMuted: vi.fn(), pinMessagingMessage: vi.fn(),
  readMessagingUnsentHoldIds: async () => [], readMessagingUnsentHold: async () => null,
  purgeMessagingUnsentHold: async () => undefined,
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: vi.fn() }));
vi.mock("../services/messaging/backupRuntime", () => ({
  driveBackup: () => ({ promptDecision: () => null }),
  startDriveBackup: () => () => undefined,
  clearDriveBackup: () => undefined,
}));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: vi.fn(),
}));
vi.mock("../services/media/nativeMedia", () => ({
  chooseNativeImage: vi.fn(), chooseNativeImages: vi.fn(),
  importNativeImageUri: vi.fn(), importedImageToFile: vi.fn(),
}));

const originalWidth = window.innerWidth;

beforeEach(() => {
  localStorage.clear();
  m.chat.currentProjections = { chat: m.view };
  m.chat.displayProjections = undefined;
  m.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("font-size");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The `/chats` parent route with the real split view; only the window width is
 *  chosen by the test, because jsdom reports every element as 0px wide and
 *  `useContentWidth` therefore falls back to the viewport. */
function renderChats(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  render(<MemoryRouter initialEntries={["/chats"]}><Connections /></MemoryRouter>);
}

function divider() {
  return screen.queryByRole("separator", { name: "Resize conversation list" });
}

it("keeps the authored pixel track at the 16px root", () => {
  expect(chatPaneBounds(16)).toEqual(CHAT_PANE);
});

it("scales the track with the reader's text size", () => {
  expect(chatPaneBounds(20)).toEqual({
    ...CHAT_PANE, defaultWidth: 400, minWidth: 325, maxWidth: 600,
  });
  expect(chatPaneBounds(32)).toEqual({
    ...CHAT_PANE, defaultWidth: 640, minWidth: 520, maxWidth: 960,
  });
  // The collapsed rail is avatars, not text, and keeps its pixel budget.
  expect(chatPaneBounds(32).collapsedWidth).toBe(CHAT_PANE.collapsedWidth);
});

it("keeps the authored pixels when the root size cannot be read", () => {
  for (const value of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(chatPaneBounds(value)).toEqual(CHAT_PANE);
  }
});

it("leaves ordinary desktop density exactly as it was", () => {
  renderChats(1368);
  const handle = divider();
  expect(handle).not.toBeNull();
  expect(handle!.getAttribute("aria-valuenow")).toBe("320");
  expect(handle!.getAttribute("aria-valuemin")).toBe("260");
  expect(handle!.getAttribute("aria-valuemax")).toBe("480");
});

it("gives the 200% desktop a readable list column instead of a clipped one", () => {
  document.documentElement.style.fontSize = "32px";
  renderChats(1368);
  const handle = divider();
  expect(handle).not.toBeNull();
  expect(handle!.getAttribute("aria-valuenow")).toBe("640");
  expect(handle!.getAttribute("aria-valuemin")).toBe("520");
  expect(handle!.getAttribute("aria-valuemax")).toBe("960");
  // The wide sidebar form, not a single narrow column wearing its chrome.
  expect(screen.getByRole("button", { name: "Collapse conversation list" })).toBeTruthy();
});

it("falls back to the one routed list when the measure cannot fit beside a thread", () => {
  document.documentElement.style.fontSize = "32px";
  renderChats(1080);
  expect(divider()).toBeNull();
  expect(screen.queryByRole("button", { name: "Collapse conversation list" })).toBeNull();
  expect(screen.getByRole("region", { name: "Chats" })).toBeTruthy();
});

it("keeps the 320px phone list as the only pane", () => {
  renderChats(320);
  expect(divider()).toBeNull();
  expect(screen.getByRole("region", { name: "Chats" })).toBeTruthy();
  expect(screen.getByRole("searchbox", { name: "Search people or chats" })).toBeTruthy();
});
