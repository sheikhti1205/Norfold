// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { LiveRegion } from "../components/LiveRegion";
import type { MessagingThreadSync } from "../services/messaging/runtime";
import { ThreadSession } from "./Messaging";

/**
 * The composer's text is the reader's work, not the window's. Closing the dock
 * or leaving the route unmounts `ThreadSession`, and this suite proves the text
 * comes back on the next mount for the same account and conversation — and only
 * there: a durable send clears it, and another account never sees it.
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
      accountId: "account", status: "ready", revision: 1, error: null as string | null,
      threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
      conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }],
      currentProjections: { chat: view } as Record<string, typeof view> | null,
    },
    watch: vi.fn(), threadRead: vi.fn(), text: vi.fn(), send: vi.fn(), voice: vi.fn(),
    location: vi.fn(), mute: vi.fn(), pin: vi.fn(), relationship: vi.fn(),
    read: vi.fn(), download: vi.fn(), remove: vi.fn(), recover: vi.fn(), retry: vi.fn(),
    retryMedia: vi.fn(), receipt: vi.fn(), observe: vi.fn(), refresh: vi.fn(),
    markRead: vi.fn(), holdIds: vi.fn(), hold: vi.fn(), purgeHold: vi.fn(),
  };
});

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({
  fetchAccountIdentities: async () => new Map(),
  readCachedAccountIdentities: () => new Map(),
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({
  getCachedMessagingThreadState: () => null,
  watchMessagingThread: m.watch,
  sendMessagingVoice: m.voice,
  sendMessagingLocation: m.location,
  setMessagingMuted: m.mute,
  pinMessagingMessage: m.pin,
  readMessagingThreadState: () => m.threadRead(),
  fetchMessagingReceiptView: m.receipt,
  observeMessagingReceipt: m.observe,
  markMessagingConversationRead: m.markRead,
  refreshMessaging: m.refresh,
  retryMessagingMedia: m.retryMedia,
  sendMessagingText: m.text,
  sendMessagingMedia: m.send,
  readMessagingMedia: m.read,
  downloadMessagingMedia: m.download,
  changeMessagingRelationship: m.relationship,
  clearMessagingConversation: async () => {},
  removeMessagingMessage: m.remove,
  recoverMessagingText: m.recover,
  retryMessagingMessage: m.retry,
  readMessagingUnsentHoldIds: m.holdIds,
  readMessagingUnsentHold: m.hold,
  purgeMessagingUnsentHold: m.purgeHold,
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: vi.fn() }));
vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  uploadChatFile: vi.fn(),
  removeChatFile: vi.fn(),
}));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: vi.fn(async () => ({ reportId: "receipt" })),
}));
vi.mock("../services/media/nativeMedia", () => ({
  chooseNativeImage: vi.fn(), chooseNativeImages: vi.fn(),
  importNativeImageUri: vi.fn(), importedImageToFile: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200,
    toJSON: () => ({}),
  } as DOMRect);
  m.view.mode = "CONNECTED";
  m.view.request = "NONE";
  m.view.ownBlocked = false;
  m.view.ownMuted = false;
  m.view.ownHidden = false;
  m.view.ownDeclined = false;
  m.view.requestEpoch = null;
  m.view.epoch = "relationship-a";
  m.view.revision = 1;
  m.view.pinnedMessageIds = [];
  m.chat.accountId = "account";
  m.chat.status = "ready";
  m.chat.revision = 1;
  m.chat.error = null;
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.chat.conversations = [{ conversationId: "chat", peerId: "peer", cachedProjection: m.view }];
  m.chat.currentProjections = { chat: m.view };
  m.watch.mockReset().mockReturnValue(() => undefined);
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: [], outbox: [], media: [] }));
  m.text.mockReset().mockResolvedValue("saved");
  m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] });
  m.observe.mockReset().mockResolvedValue(true);
  m.markRead.mockReset().mockResolvedValue(undefined);
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.purgeHold.mockReset().mockImplementation(async () => undefined);
  for (const call of [m.send, m.voice, m.location, m.mute, m.pin, m.relationship,
    m.read, m.download, m.remove, m.recover, m.retry, m.retryMedia, m.refresh]) {
    call.mockReset().mockResolvedValue(undefined);
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function session(accountId: string, surface: "route" | "dock") {
  return <MemoryRouter initialEntries={["/posts/1"]}>
    <LiveRegion />
    <ThreadSession accountId={accountId} conversationId="chat" surface={surface} />
  </MemoryRouter>;
}

/** Mount a thread and wait until its saved history has replaced the opener. */
async function open(accountId = "account", surface: "route" | "dock" = "dock") {
  m.chat.accountId = accountId;
  const rendered = render(session(accountId, surface));
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  return rendered;
}

function field() { return screen.getByRole("textbox", { name: "Message" }); }

it("restores a typed dock draft on the next mount of the same conversation", async () => {
  const first = await open();
  fireEvent.change(field(), { target: { value: "draft probe 38d13387" } });
  expect(field()).toHaveProperty("value", "draft probe 38d13387");
  first.unmount();

  await open();
  expect(field()).toHaveProperty("value", "draft probe 38d13387");
  // Restoring the words is not sending them: the reopen made no send call.
  expect(m.text).not.toHaveBeenCalled();
});

it("restores the same draft when a route thread is left and reopened", async () => {
  const first = await open("account", "route");
  fireEvent.change(field(), { target: { value: "Route draft" } });
  first.unmount();

  await open("account", "route");
  expect(field()).toHaveProperty("value", "Route draft");
});

it("clears the stored draft once the text message is durably sent", async () => {
  const first = await open();
  fireEvent.change(field(), { target: { value: "Send this once" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(field()).toHaveProperty("value", ""));
  first.unmount();

  await open();
  expect(field()).toHaveProperty("value", "");
});

it("never restores one account's draft inside another account's thread", async () => {
  const first = await open("account-a");
  fireEvent.change(field(), { target: { value: "Only for A" } });
  first.unmount();

  await open("account-b");
  expect(field()).toHaveProperty("value", "");
});
