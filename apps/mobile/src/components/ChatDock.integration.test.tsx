// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBackInterceptors } from "./backNavigation";
import { LiveRegion } from "./LiveRegion";
import { resetModalLayers } from "../hooks/modalLayers";
import { ChatDock } from "./ChatDock";
import { resetChatDock } from "./chatDock";

/**
 * Host seam regression against the real adapter.
 *
 * `ChatDock.test.tsx` replaces ThreadSession to keep its assertions narrow.
 * This suite does the opposite: it mounts the exported adapter from
 * `screens/Messaging` so a prop or markup drift between the host and the
 * canonical window fails here, not only in a mocked tree.
 */

const m = vi.hoisted(() => {
  const view = {
    mode: "CONNECTED", request: "NONE", ownBlocked: false, ownMuted: false,
    ownHidden: false, ownDeclined: false, requestEpoch: null,
    epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[],
  };
  const identity = { id: "p1", username: "alice", displayName: "Alice", avatarUrl: null };
  return {
    view,
    identity,
    chat: {
      accountId: "me", status: "ready", localReady: true, error: null, revision: 1,
      threadSync: { conversationId: "c1", mode: "ready", missing: 0 },
      conversations: [{
        conversationId: "c1", peerId: "p1", unreadCount: 1,
        lastMessage: { id: "m1", conversationId: "c1", authorId: "p1", recipientId: "me", body: "Hello", messageType: "TEXT" },
        cachedProjection: view, lastSequence: 1, pendingCount: 0, updatedAt: 1,
      }],
      currentProjections: { c1: view },
      displayProjections: undefined,
    },
    watch: vi.fn(() => () => undefined),
    markRead: vi.fn(async () => undefined),
    threadRead: vi.fn(async () => ({ messages: [], outbox: [], media: [] })),
  };
});

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "me" }, booting: false, needsProfile: false }) }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/accountLabels", () => ({
  readCachedAccountIdentities: () => new Map([[m.identity.id, m.identity]]),
  fetchAccountIdentities: async () => new Map([[m.identity.id, m.identity]]),
}));
// Spread the original so `PeopleSearch`, which also reads `normalizePeopleQuery`,
// still resolves its exports while search itself stays offline.
vi.mock("../services/people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/people")>()),
  searchPeople: vi.fn(async () => ({ items: [], nextCursor: null })),
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: vi.fn() }));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: vi.fn(),
}));
vi.mock("../services/media/nativeMedia", () => ({
  chooseNativeImage: vi.fn(), chooseNativeImages: vi.fn(),
  importNativeImageUri: vi.fn(), importedImageToFile: vi.fn(),
}));
vi.mock("../services/messaging/runtime", () => ({
  refreshMessaging: vi.fn(async () => undefined),
  requestMessagingConversation: vi.fn(async () => "c-new"),
  getMessagingRuntimeSnapshot: () => ({
    accountId: "me", status: "ready", conversations: [], currentProjections: null, displayProjections: null,
  }),
  subscribeMessagingRuntime: () => () => undefined,
  exportMessagingMedia: vi.fn(),
  exportMessagingSnapshot: vi.fn(),
  importMessagingSnapshot: vi.fn(),
  webInstallationId: () => "installation",
  getMessagingRuntimeGeneration: () => 0,
  getCachedMessagingThreadState: () => null,
  watchMessagingThread: m.watch,
  markMessagingConversationRead: m.markRead,
  sendMessagingText: vi.fn(),
  sendMessagingMedia: vi.fn(),
  sendMessagingVoice: vi.fn(),
  sendMessagingLocation: vi.fn(),
  clearMessagingConversation: vi.fn(),
  removeMessagingMessage: vi.fn(),
  changeMessagingRelationship: vi.fn(),
  runMessagingAuthorityAction: vi.fn(),
  fetchMessagingReceiptView: vi.fn(async () => ({ context: "authority", readIds: [] })),
  observeMessagingReceipt: vi.fn(async () => true),
  readMessagingMedia: vi.fn(),
  downloadMessagingMedia: vi.fn(),
  recoverMessagingText: vi.fn(),
  retryMessagingMessage: vi.fn(),
  retryMessagingMedia: vi.fn(),
  setMessagingMuted: vi.fn(),
  pinMessagingMessage: vi.fn(),
  readMessagingThreadState: m.threadRead,
  readMessagingUnsentHold: vi.fn(async () => null),
  readMessagingUnsentHoldIds: vi.fn(async () => []),
  purgeMessagingUnsentHold: vi.fn(async () => undefined),
}));

function Probe() {
  const location = useLocation();
  return (
    <>
      <LiveRegion />
      <output data-testid="path">{location.pathname}</output>
      <ChatDock hostOccluded={false} bottomNavVisible={true} />
    </>
  );
}

function mount(path = "/search") {
  return render(<MemoryRouter initialEntries={[path]}><Probe /></MemoryRouter>);
}

/** The only way into a window: the capsule's Compose action, then Recent. */
function openWithAlice() {
  fireEvent.click(screen.getByRole("button", { name: /^Compose/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Open conversation with Alice/ }));
}

beforeEach(() => {
  localStorage.clear();
  resetChatDock();
});
afterEach(() => {
  cleanup();
  resetChatDock();
  resetBackInterceptors();
  resetModalLayers();
  localStorage.clear();
});

describe("ChatDock with the real ThreadSession", () => {
  it("opens the canonical dock without navigating the page underneath", async () => {
    mount("/search");
    openWithAlice();

    const panel = await screen.findByRole("complementary", { name: "Chat" });
    expect(panel.querySelector('section.fb-chat-page[data-surface="dock"]')).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Collapse chat" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Back to chats" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open full chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close chat" })).toBeTruthy();
    // The canonical details toggle stays inside the window, not in a second bar.
    expect(screen.getByRole("button", { name: "Conversation options" })).toBeTruthy();
    expect(screen.getByTestId("path").textContent).toBe("/search");
  });

  it("closes the real thread and leaves the Compose capsule in the corner", async () => {
    mount("/search");
    openWithAlice();
    await screen.findByRole("button", { name: "Close chat" });

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Chat" })).toBeNull());
    // Closing through the window dismisses the conversation, so no bubble
    // survives it; an empty dock is a Compose affordance, not a dead circle.
    expect(screen.queryByRole("button", { name: /Restore chat/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Compose/ })).toBeTruthy();
    expect(screen.getByTestId("path").textContent).toBe("/search");
  });

  it("expands to the canonical route through the real adapter", async () => {
    mount("/search");
    openWithAlice();
    await screen.findByRole("button", { name: "Open full chat" });

    fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/chats/c1"));
    // The chat route owns the conversation; the floating shortcut stands down.
    expect(screen.queryByRole("button", { name: "Compose" })).toBeNull();
  });
});
