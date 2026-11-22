// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import { Capacitor } from "@capacitor/core";
import { BackButtonHandler } from "../components/BackButtonHandler";
import { resetBackInterceptors } from "../components/backNavigation";
import { LiveRegion } from "../components/LiveRegion";
import { popModalLayer, pushModalLayer, resetModalLayers } from "../hooks/modalLayers";
import type { MessagingThreadSync } from "../services/messaging/runtime";
import { ThreadSession } from "./Messaging";

/**
 * T2 acceptance for the `surface="dock"` thread.
 *
 * The host, the store and the CSS belong to T1; this suite proves the canonical
 * `ThreadSession` behaves as one window over a page: no back link, one
 * activity-gated lease, no reads while it is not showing, no ambient route
 * intent adopted or rewritten, and no presentation remount or fallback.
 */

const native = vi.hoisted(() => ({ back: null as null | (() => void) }));

const m = vi.hoisted(() => {
  const view = {
    mode: "CONNECTED", request: "NONE", ownBlocked: false, ownMuted: false,
    ownHidden: false, ownDeclined: false, requestEpoch: null,
    epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[],
  };
  return {
    view,
    watch: vi.fn(),
    stop: vi.fn(),
    markRead: vi.fn(),
    chat: {
      accountId: "account", status: "ready", revision: 1,
      threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
      conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }],
      currentProjections: { chat: view } as Record<string, typeof view> | null,
      displayProjections: undefined as Record<string, typeof view> | null | undefined,
    },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[],
    cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] },
    threadRead: vi.fn(), text: vi.fn(), send: vi.fn(), voice: vi.fn(), location: vi.fn(),
    clear: vi.fn(), remove: vi.fn(), relationship: vi.fn(), refresh: vi.fn(),
    receipt: vi.fn(), observe: vi.fn(), read: vi.fn(), download: vi.fn(),
    recover: vi.fn(), retry: vi.fn(), retryMedia: vi.fn(), mute: vi.fn(), pin: vi.fn(),
    holdIds: vi.fn(), hold: vi.fn(), purgeHold: vi.fn(),
    choose: vi.fn(), import: vi.fn(), file: vi.fn(), prepare: vi.fn(),
    search: vi.fn(), report: vi.fn(),
  };
});

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_name: string, listener: () => void) => {
      native.back = listener;
      return Promise.resolve({ remove: vi.fn() });
    },
    exitApp: vi.fn(),
  },
}));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({
  fetchAccountIdentities: async () => new Map(),
  readCachedAccountIdentities: () => new Map(),
}));
vi.mock("../services/people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/people")>()),
  searchPeople: m.search,
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({
  getCachedMessagingThreadState: () => m.cached,
  watchMessagingThread: m.watch,
  markMessagingConversationRead: m.markRead,
  sendMessagingText: m.text,
  sendMessagingMedia: m.send,
  sendMessagingVoice: m.voice,
  sendMessagingLocation: m.location,
  clearMessagingConversation: m.clear,
  removeMessagingMessage: m.remove,
  changeMessagingRelationship: m.relationship,
  refreshMessaging: m.refresh,
  readMessagingThreadState: () => m.threadRead(),
  fetchMessagingReceiptView: m.receipt,
  observeMessagingReceipt: m.observe,
  readMessagingMedia: m.read,
  downloadMessagingMedia: m.download,
  recoverMessagingText: m.recover,
  retryMessagingMessage: m.retry,
  retryMessagingMedia: m.retryMedia,
  setMessagingMuted: m.mute,
  pinMessagingMessage: m.pin,
  readMessagingUnsentHoldIds: () => m.holdIds(),
  readMessagingUnsentHold: () => m.hold(),
  purgeMessagingUnsentHold: () => m.purgeHold(),
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: m.report,
}));
vi.mock("../services/media/nativeMedia", () => ({
  chooseNativeImage: m.choose, chooseNativeImages: m.choose,
  importNativeImageUri: m.import, importedImageToFile: m.file,
}));

const REPORT_ID = "8a2f5c1e-3b7d-4c9a-9e1f-2d6b8c4a7e10";

function storedMessage(over: Record<string, unknown> = {}) {
  return {
    id: "msg-1", conversationId: "chat",
    authorId: "peer", recipientId: "account",
    body: "Hello from the dock", messageType: "TEXT",
    server: { sequence: 1 }, ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  native.back = null;
  // The real platform reports `web`; only that gate is overridden so the real
  // Back handler and the real interceptor stack run, exactly as on a device.
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
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
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.chat.conversations = [{ conversationId: "chat", peerId: "peer", cachedProjection: m.view }];
  m.chat.currentProjections = { chat: m.view };
  m.chat.displayProjections = undefined;
  m.messages = [];
  m.media = [];
  m.outbox = [];
  m.cached = null;
  m.stop.mockReset();
  m.watch.mockReset().mockReturnValue(m.stop);
  m.markRead.mockReset().mockResolvedValue(undefined);
  m.threadRead.mockReset().mockImplementation(async () => ({
    messages: m.messages, outbox: m.outbox, media: m.media,
  }));
  m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] });
  m.observe.mockReset().mockResolvedValue(true);
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.purgeHold.mockReset().mockImplementation(async () => undefined);
  m.text.mockReset().mockResolvedValue("saved");
  m.report.mockReset().mockResolvedValue({ reportId: "receipt" });
  for (const call of [m.send, m.voice, m.location, m.clear, m.remove, m.relationship,
    m.refresh, m.read, m.download, m.recover, m.retry, m.retryMedia, m.mute, m.pin,
    m.prepare, m.choose, m.import, m.file, m.search]) {
    call.mockReset();
  }
});

afterEach(() => {
  cleanup();
  resetBackInterceptors();
  resetModalLayers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

type DockProps = {
  active?: boolean;
  onToggleCompact?: () => void;
  onClose?: () => void;
  onExpand?: () => void;
  onUnsentWorkChange?: (hasUnsent: boolean) => void;
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function dockApp(props: DockProps = {}, entry = "/posts/1") {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <LiveRegion />
      <LocationProbe />
      <BackButtonHandler />
      <ThreadSession accountId="account" conversationId="chat" surface="dock" {...props} />
    </MemoryRouter>
  );
}

function location() {
  return screen.getByTestId("location").textContent;
}

/** The press Capacitor delivers for the Android Back button/gesture. */
function pressBack() {
  act(() => native.back!());
}

async function openDock(props: DockProps = {}, entry = "/posts/1") {
  const view = render(dockApp(props, entry));
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  await waitFor(() => expect(typeof native.back).toBe("function"));
  return view;
}

async function leaveDialog() {
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toMatch(/leave this chat/i);
  return dialog;
}

it("renders the canonical header without a back link and with window controls", async () => {
  await openDock();
  expect(screen.queryByRole("link", { name: "Back to chats" })).toBeNull();
  expect(screen.getByRole("button", { name: "Collapse chat" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "Open full chat" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Close chat" })).toBeTruthy();
  // The details toggle still belongs to the canonical header in the window.
  expect(screen.getByRole("button", { name: "Conversation options" })).toBeTruthy();
});

it("keeps only the four real window controls, with no call or presence chrome", async () => {
  await openDock();
  const header = document.querySelector(".fb-chat-header") as HTMLElement | null;
  expect(header).toBeTruthy();
  // Info, collapse/minimize, expand, close. Nothing is added to match the
  // Messenger reference: the product has no call capability and no presence
  // signal, so the phone/video buttons and the green dot stay out.
  const controls = Array.from(header!.querySelectorAll(".fb-chat-icon"));
  expect(controls).toHaveLength(4);
  for (const control of controls) {
    expect(control.getAttribute("aria-label")).toBeTruthy();
    expect(control.querySelector("svg")).toBeTruthy();
  }
  expect(screen.queryByRole("button", { name: /call|video|phone/i })).toBeNull();
  expect(header!.querySelector("[data-presence], .fb-chat-presence, .fb-chat-online")).toBeNull();
  expect(screen.queryByText(/active now/i)).toBeNull();
  // The secondary line stays the real relationship label.
  expect(within(header!).getByText("Friends")).toBeTruthy();
});

it("keeps one compact control and labels it by activity", async () => {
  const onToggleCompact = vi.fn();
  const view = await openDock({ onToggleCompact });
  fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  expect(onToggleCompact).toHaveBeenCalledTimes(1);

  view.rerender(dockApp({ onToggleCompact, active: false }));
  const expand = screen.getByRole("button", { name: "Expand chat" });
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(expand);
  expect(onToggleCompact).toHaveBeenCalledTimes(2);
  // One control in both states; never two competing buttons.
  expect(screen.queryByRole("button", { name: "Collapse chat" })).toBeNull();
});

it("closes and expands only through the canonical guard, never by navigating", async () => {
  const onClose = vi.fn();
  const onExpand = vi.fn();
  await openDock({ onClose, onExpand });
  fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onExpand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));
  expect(onExpand).toHaveBeenCalledTimes(1);
  expect(location()).toBe("/posts/1");
});

it("asks before opening the full chat with unsent work, then expands without closing", async () => {
  const onClose = vi.fn();
  const onExpand = vi.fn();
  await openDock({ onClose, onExpand });
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Unsent expand" } });

  fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));
  const dialog = await leaveDialog();
  expect(onExpand).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(location()).toBe("/posts/1");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(onExpand).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  // Staying keeps the same window and the exact draft: the guard is a question,
  // not a navigation or a remount of the work it is protecting.
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(field);
  expect(field).toHaveProperty("value", "Unsent expand");
  expect(location()).toBe("/posts/1");

  fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));
  fireEvent.click(within(await leaveDialog()).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(onExpand).toHaveBeenCalledTimes(1));
  expect(onClose).not.toHaveBeenCalled();
  // The adapter converts the consent into the host's callback; the page beneath
  // is never navigated, which is why location must not move here either.
  expect(location()).toBe("/posts/1");
});

it("ignores an ambient report query instead of adopting it for the first send", async () => {
  await openDock({}, `/posts/1?report=${REPORT_ID}`);
  expect(screen.queryByText(/which report/i)).toBeNull();

  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  // Consuming it would have rewritten the page beneath; the dock never does.
  expect(screen.queryByText(/which report/i)).toBeNull();
  expect(location()).toBe(`/posts/1?report=${REPORT_ID}`);
});

it("does not consume or rewrite ambient search, media or location intents", async () => {
  for (const search of ["?search=1", "?media=1", "?location=1"]) {
    await openDock({}, `/posts/1${search}`);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(location()).toBe(`/posts/1${search}`);
    cleanup();
  }
});

it("ignores ambient chat intents even while the window is inactive", async () => {
  await openDock({ active: false }, `/posts/1?report=${REPORT_ID}&search=1`);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/which report/i)).toBeNull();
  expect(location()).toBe(`/posts/1?report=${REPORT_ID}&search=1`);
});

it("closes a clean window on Escape without navigating the page underneath", async () => {
  const onClose = vi.fn();
  await openDock({ onClose });
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(location()).toBe("/posts/1");
});

it("asks before dropping an unsent draft, and closes only on the explicit choice", async () => {
  const onClose = vi.fn();
  await openDock({ onClose });
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Unsent words" } });

  fireEvent.keyDown(document.body, { key: "Escape" });
  const dialog = await leaveDialog();
  expect(onClose).not.toHaveBeenCalled();
  expect(location()).toBe("/posts/1");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(onClose).not.toHaveBeenCalled();
  expect(field).toHaveProperty("value", "Unsent words");

  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.click(within(await leaveDialog()).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(location()).toBe("/posts/1");
});

it("closes on Android Back and never falls through to the page history", async () => {
  const onClose = vi.fn();
  await openDock({ onClose });
  pressBack();
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(location()).toBe("/posts/1");
});

it("still asks Android Back about unsent work before closing", async () => {
  const onClose = vi.fn();
  await openDock({ onClose });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Keep me" } });

  pressBack();
  const dialog = await leaveDialog();
  expect(onClose).not.toHaveBeenCalled();
  expect(location()).toBe("/posts/1");
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it("holds no lease while inactive and releases it when the window hides", async () => {
  const view = await openDock({ active: false });
  expect(m.watch).not.toHaveBeenCalled();

  view.rerender(dockApp({ active: true }));
  await waitFor(() => expect(m.watch).toHaveBeenCalledWith("account", "chat"));
  expect(m.stop).not.toHaveBeenCalled();

  view.rerender(dockApp({ active: false }));
  await waitFor(() => expect(m.stop).toHaveBeenCalledTimes(1));
});

it("marks a loaded conversation read only while the window is actually showing", async () => {
  m.messages = [storedMessage()];
  const view = await openDock({ active: false });
  await waitFor(() => expect(screen.getByText("Hello from the dock")).toBeTruthy());
  expect(m.markRead).not.toHaveBeenCalled();
  // A hidden body measures zero distance, so a visibilitychange must not be
  // read as "at the bottom" of a conversation nobody is looking at.
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(m.markRead).not.toHaveBeenCalled();

  view.rerender(dockApp({ active: true }));
  await waitFor(() => expect(m.markRead).toHaveBeenCalledWith("account", "chat", 1));
});

it("holds reads while any modal layer owns the reader", async () => {
  m.messages = [storedMessage()];
  act(() => pushModalLayer("reader-layer"));
  const view = render(dockApp());
  await waitFor(() => expect(screen.getByText("Hello from the dock")).toBeTruthy());
  expect(m.markRead).not.toHaveBeenCalled();

  act(() => popModalLayer("reader-layer"));
  await waitFor(() => expect(m.markRead).toHaveBeenCalledWith("account", "chat", 1));
  view.unmount();
});

it("closes its portalled task surface when the window hides and keeps the draft", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(380);
  const view = await openDock({ active: true });
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Draft survives" } });

  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  await screen.findByRole("dialog", { name: "Conversation info" });

  view.rerender(dockApp({ active: false }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Draft survives");
});

it("closes a message menu portalled above a page it no longer floats over", async () => {
  m.messages = [storedMessage()];
  const view = await openDock({ active: true });
  await screen.findByText("Hello from the dock");
  fireEvent.click(screen.getByRole("button", { name: "Options for received message" }));
  await screen.findByRole("menu", { name: "Message actions" });

  view.rerender(dockApp({ active: false }));
  await waitFor(() => expect(screen.queryByRole("menu", { name: "Message actions" })).toBeNull());
});

it("mirrors unsent work to the host without moving the work itself", async () => {
  const onUnsentWorkChange = vi.fn();
  const view = await openDock({ onUnsentWorkChange });
  await waitFor(() => expect(onUnsentWorkChange).toHaveBeenLastCalledWith(false));
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Some work" } });
  await waitFor(() => expect(onUnsentWorkChange).toHaveBeenLastCalledWith(true));
  fireEvent.change(field, { target: { value: "" } });
  await waitFor(() => expect(onUnsentWorkChange).toHaveBeenLastCalledWith(false));
  view.rerender(dockApp({ onUnsentWorkChange }));
  expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
});

it("measures the window box, not the viewport, for utilities and the details pane", async () => {
  vi.stubGlobal("innerWidth", 1440);
  let width = 380;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);

  const view = await openDock({ active: true });
  await waitFor(() => expect(screen.queryByRole("navigation", { name: "App utilities" })).toBeNull());
  expect(screen.queryByRole("button", { name: "Sync messages" })).toBeNull();
  expect(screen.getByRole("button", { name: "Conversation options" })).toBeTruthy();

  // The same 1440px viewport becomes wide only because the window did.
  width = 900;
  act(() => { window.dispatchEvent(new Event("resize")); });
  view.rerender(dockApp({ active: true }));
  await waitFor(() => expect(screen.getByRole("navigation", { name: "App utilities" })).toBeTruthy());
  // The header icon and the now-visible third pane both name Sync; the header
  // one is what proves the wide window layout, so count rather than assume one.
  expect(screen.getAllByRole("button", { name: "Sync messages" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Hide conversation details" })).toBeTruthy();
});

it("keeps the same rows and draft across a minimize, with no re-read or remount", async () => {
  m.messages = [storedMessage()];
  const view = await openDock({ active: true });
  await screen.findByText("Hello from the dock");
  const transcript = screen.getByRole("list", { name: "Messages" });
  const row = within(transcript).getByText("Hello from the dock");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Still here" } });

  view.rerender(dockApp({ active: false }));
  view.rerender(dockApp({ active: true }));
  expect(screen.getByRole("list", { name: "Messages" })).toBe(transcript);
  expect(within(transcript).getByText("Hello from the dock")).toBe(row);
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Still here");
  // Hiding and restoring the window is not a new conversation: one read only.
  expect(m.threadRead).toHaveBeenCalledTimes(1);
});

it("labels from the accepted presentation and never revives a cleared relationship", async () => {
  m.messages = [storedMessage()];
  m.chat.currentProjections = null;
  m.chat.displayProjections = { chat: m.view };
  const view = await openDock({ active: true });
  await screen.findByText("Hello from the dock");
  const transcript = screen.getByRole("list", { name: "Messages" });
  expect(screen.getAllByText("Friends").length).toBeGreaterThan(0);

  // A routine pass clears authority but keeps the last accepted presentation.
  m.chat.displayProjections = { chat: { ...m.view, revision: 2 } };
  view.rerender(dockApp({ active: true }));
  expect(screen.getAllByText("Friends").length).toBeGreaterThan(0);
  // The label may come from the accepted display set, but no action is derived
  // from it: the mute switch renders and stays disabled without live authority.
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  const trigger = screen.getByRole("button", { name: "Conversation options" });
  const info = await screen.findByRole("dialog", { name: "Conversation info" });
  const popover = info.closest(".fb-chat-info-popover");
  expect(popover).toBeInstanceOf(HTMLElement);
  expect(popover!.contains(info)).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(within(info).getByRole("switch", { name: "Mute notifications" })).toHaveProperty("disabled", true);
  // React Aria's Dialog inside a Popover listens for Escape at document level,
  // not at the trigger or document.body.
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.getByRole("list", { name: "Messages" })).toBe(transcript);

  // An explicit null means no presentation fallback: the cached CONNECTED row
  // must not resurrect a relationship label the account no longer holds.
  m.chat.displayProjections = null;
  view.rerender(dockApp({ active: true }));
  expect(screen.queryByText("Friends")).toBeNull();
  expect(screen.getAllByText("Saved chat").length).toBeGreaterThan(0);
  expect(screen.getByText("Hello from the dock")).toBeTruthy();
});

it("keeps every conversation action inside the dock info popover", async () => {
  await openDock({ active: true });
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  const info = await screen.findByRole("dialog", { name: "Conversation info" });
  within(info).getByRole("button", { name: "Search chat" });
  within(info).getByRole("button", { name: "Media" });
  within(info).getByRole("switch", { name: "Mute notifications" });
  within(info).getByRole("button", { name: "Clear chat for me" });
  within(info).getByRole("button", { name: "Report account" });
});

it("caps the dock info popover height from the layered-popover prop", async () => {
  await openDock({ active: true });
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  const info = await screen.findByRole("dialog", { name: "Conversation info" });
  const popover = info.closest(".fb-chat-info-popover");
  expect(popover).toBeInstanceOf(HTMLElement);
  // React Aria writes the capped max-height inline while the popover is open;
  // a stylesheet rule cannot replace it.
  expect((popover as HTMLElement).style.maxHeight).toBeTruthy();
});
