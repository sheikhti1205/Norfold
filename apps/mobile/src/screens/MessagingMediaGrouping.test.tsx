// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { MessagingThread } from "./Messaging";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import { VideoPlayerProvider } from "../components/media/VideoPlayerProvider";
import { encodeChatFileMarker } from "../services/messaging/files";
import type { MessagingThreadSync } from "../services/messaging/runtime";

const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return { view, watch: vi.fn(), chat: { accountId: "account", status: "ready", revision: 1,
    threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
    conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }], currentProjections: { chat: view } },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[], cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] }, threadRead: vi.fn(),
    voice: vi.fn(), location: vi.fn(), mute: vi.fn(), pin: vi.fn(), prepare: vi.fn(), relationship: vi.fn(), text: vi.fn(), send: vi.fn(), read: vi.fn(), download: vi.fn(), remove: vi.fn(), recover: vi.fn(), retry: vi.fn(), receipt: vi.fn(), observe: vi.fn(), refresh: vi.fn(), choose: vi.fn(), import: vi.fn(), file: vi.fn(), upload: vi.fn(), removeFile: vi.fn(),
    holdIds: vi.fn(async () => [] as string[]), hold: vi.fn(async (): Promise<Record<string, unknown> | null> => null), purgeHold: vi.fn(async () => undefined),
    report: vi.fn(async (_input: unknown, _signal?: AbortSignal) => ({ reportId: "receipt" })) };
});
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: async () => new Map(), readCachedAccountIdentities: () => new Map() }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({ getCachedMessagingThreadState: () => m.cached, watchMessagingThread: m.watch, sendMessagingVoice: m.voice, sendMessagingLocation: m.location, setMessagingMuted: m.mute, pinMessagingMessage: m.pin, readMessagingThreadState: () => m.threadRead(), fetchMessagingReceiptView: m.receipt, observeMessagingReceipt: m.observe, markMessagingConversationRead: async () => {}, refreshMessaging: m.refresh, sendMessagingText: m.text, sendMessagingMedia: m.send, readMessagingMedia: m.read, downloadMessagingMedia: m.download, changeMessagingRelationship: m.relationship, clearMessagingConversation: async () => {}, removeMessagingMessage: m.remove, recoverMessagingText: m.recover, retryMessagingMessage: m.retry, readMessagingUnsentHoldIds: m.holdIds, readMessagingUnsentHold: m.hold, purgeMessagingUnsentHold: m.purgeHold }));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  uploadChatFile: m.upload,
  removeChatFile: m.removeFile,
}));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: (input: unknown, signal?: AbortSignal) => m.report(input, signal),
}));
vi.mock("../services/media/nativeMedia", () => ({ chooseNativeImages: m.choose, importNativeImageUri: m.import, importedImageToFile: m.file }));
beforeEach(() => { vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() })); m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.chat.revision = 1; m.messages = []; m.media = []; m.outbox = []; m.prepare.mockReset(); m.send.mockReset(); m.read.mockReset().mockResolvedValue(null); m.download.mockReset().mockResolvedValue(undefined); m.remove.mockReset().mockResolvedValue(undefined); m.recover.mockReset().mockResolvedValue(undefined); m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] }); m.observe.mockReset().mockResolvedValue(true); m.refresh.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}) });
  m.choose.mockReset(); m.import.mockReset(); m.file.mockReset();
  m.retry.mockReset().mockResolvedValue(undefined);
  m.upload.mockReset();
  m.removeFile.mockReset().mockResolvedValue(undefined);
  m.text.mockReset().mockResolvedValue("saved");
  m.location.mockReset().mockResolvedValue("shared"); m.chat.accountId = "account";
  m.relationship.mockReset().mockResolvedValue(undefined);
  m.mute.mockReset().mockResolvedValue(undefined); m.view.ownMuted = false; m.chat.status = "ready";
  m.pin.mockReset().mockResolvedValue(undefined); m.view.pinnedMessageIds = [];
  m.view.epoch = "relationship-a"; m.view.revision = 1; m.chat.currentProjections = { chat: m.view };
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.watch.mockReset().mockReturnValue(() => {});
  m.cached = null;
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.purgeHold.mockReset().mockImplementation(async () => undefined);
  m.report.mockReset().mockImplementation(async () => ({ reportId: "receipt" }));
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** One stored outgoing photo row plus the attachment metadata it needs. */
function photo(id: string, createdAt: number, caption = "") {
  return {
    message: { id, conversationId: "chat", authorId: "account", recipientId: "peer", body: caption,
      messageType: "MEDIA", createdAt, server: { eventId: `event-${id}`, sequence: createdAt } },
    attachment: { id: `media-${id}`, messageId: id, direction: "OUT", state: "READY", width: 2, height: 1, mime: "image/jpeg" },
  };
}

/** One stored outgoing video row: a TEXT body carrying the canonical marker. */
function video(id: string, createdAt: number) {
  return {
    id, conversationId: "chat", authorId: "account", recipientId: "peer", messageType: "TEXT", createdAt,
    body: encodeChatFileMarker({ key: `files/account/chat/${id}.mp4`, name: `${id}.mp4`,
      mime: "video/mp4", byteSize: 12, kind: "video" }),
    server: { eventId: `event-${id}`, sequence: createdAt },
  };
}

function thread() {
  return <VideoPlayerProvider><MemoryRouter initialEntries={["/connections/chat"]}>
    <LiveRegion /><MessagingRestoration />
    <Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes>
  </MemoryRouter></VideoPlayerProvider>;
}

async function open() {
  const rendered = render(thread());
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  return rendered;
}

it("keeps two nearby photos as separate message rows", async () => {
  const first = photo("photo-1", 1_000, "First caption");
  const second = photo("photo-2", 1_400, "Second caption");
  m.messages = [first.message, second.message];
  m.media = [first.attachment, second.attachment];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // Owner direction 2026-11-20: WhatsApp Desktop keeps three nearby photos as
  // three messages, so an album needs at least four media items and a pair stays
  // two ordinary rows - no album list item, no album label.
  expect(screen.queryByRole("listitem", { name: /photos/i })).toBeNull();
  expect(document.querySelector(".fb-chat-run")).toBeNull();
  expect(document.querySelectorAll("li.fb-chat-line")).toHaveLength(2);
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(2);
  // A caption never moves to a neighbour: each stays inside its own row.
  expect(document.querySelector('[data-chat-message="photo-1"]')?.textContent).toContain("First caption");
  expect(document.querySelector('[data-chat-message="photo-1"]')?.textContent).not.toContain("Second caption");
  expect(document.querySelector('[data-chat-message="photo-2"]')?.textContent).toContain("Second caption");
});

it("keeps each caption on its own cell in a four-photo album", async () => {
  const shots = [photo("photo-1", 1_000, "First caption"), photo("photo-2", 1_400),
    photo("photo-3", 1_800, "Third caption"), photo("photo-4", 2_200)];
  m.messages = shots.map((shot) => shot.message);
  m.media = shots.map((shot) => shot.attachment);
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // Four items do form the album (owner direction 2026-11-20); it is a native
  // list item with a name, not a second group node, and a caption never moves
  // to a leader or to a neighbour.
  const album = screen.getByRole("listitem", { name: "4 photos" });
  expect(album.tagName).toBe("LI");
  expect(album.parentElement?.tagName).toBe("OL");
  expect(album.getAttribute("role")).toBeNull();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(4);
  expect(document.querySelector('[data-chat-message="photo-1"]')?.textContent).toContain("First caption");
  expect(document.querySelector('[data-chat-message="photo-1"]')?.textContent).not.toContain("Third caption");
  expect(document.querySelector('[data-chat-message="photo-3"]')?.textContent).toContain("Third caption");
});

it("keeps a nearby photo and video as separate message rows", async () => {
  const still = photo("photo-1", 2_000);
  m.messages = [still.message, video("clip-1", 2_400)];
  m.media = [still.attachment];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // Owner direction 2026-11-20: two media items stay separate, so there is no
  // album and no "1 photo and 1 video" label; the clip keeps its own row.
  expect(screen.queryByRole("listitem", { name: /photo|video/i })).toBeNull();
  expect(document.querySelector(".fb-chat-run")).toBeNull();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(2);
  expect(screen.getByText("clip-1.mp4")).toBeTruthy();
});

it("keeps a text message between two photos as its own row", async () => {
  const first = photo("photo-1", 1_000);
  const second = photo("photo-2", 1_200);
  m.messages = [first.message,
    { id: "text-1", conversationId: "chat", authorId: "account", recipientId: "peer", body: "In between",
      messageType: "TEXT", createdAt: 1_100, server: { eventId: "event-text", sequence: 2 } },
    second.message];
  m.media = [first.attachment, second.attachment];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // Two media rows that are not adjacent are two singles, not one album.
  expect(screen.queryByRole("listitem", { name: /photo/i })).toBeNull();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(3);
  expect(screen.getByText("In between")).toBeTruthy();
});

it("keeps a singleton's own picture element when an album forms around it", async () => {
  const first = photo("photo-1", 1_000);
  m.messages = [first.message];
  m.media = [first.attachment];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  const rendered = await open();
  const before = document.querySelector('[data-chat-message="photo-1"] .fb-chat-photo');
  expect(before).toBeTruthy();
  // Owner direction 2026-11-20: one to three items stay separate, so an album
  // only forms when a fourth photo joins.
  const rest = [photo("photo-2", 1_200), photo("photo-3", 1_400), photo("photo-4", 1_600)];
  m.messages = [first.message, ...rest.map((shot) => shot.message)];
  m.media = [first.attachment, ...rest.map((shot) => shot.attachment)];
  m.chat.revision++;
  rendered.rerender(thread());
  await waitFor(() => expect(screen.getByRole("listitem", { name: "4 photos" })).toBeTruthy());
  // The album is a new container, never a remount: the first picture, its
  // player and its scroll anchor stay the same element.
  expect(document.querySelector('[data-chat-message="photo-1"] .fb-chat-photo')).toBe(before);
});

it("collapses an album back to a plain row when only one member remains", async () => {
  const shots = [photo("photo-1", 1_000), photo("photo-2", 1_200), photo("photo-3", 1_400), photo("photo-4", 1_600)];
  m.messages = shots.map((shot) => shot.message);
  m.media = shots.map((shot) => shot.attachment);
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  const rendered = await open();
  // Four items are a real album under the owner rule; deleting three members
  // must collapse it rather than leave a one-cell album behind.
  expect(screen.getByRole("listitem", { name: "4 photos" })).toBeTruthy();
  m.messages = [shots[0]!.message];
  m.media = [shots[0]!.attachment];
  m.chat.revision++;
  rendered.rerender(thread());
  await waitFor(() => expect(screen.queryByRole("listitem", { name: /photos/i })).toBeNull());
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(1);
  expect(document.querySelector(".fb-chat-run")).toBeNull();
});

/** A run of n stored outgoing photos, 400ms apart, inside one rolling media run. */
function photoAlbum(n: number) {
  const shots = Array.from({ length: n }, (_, index) => photo(`photo-${index + 1}`, 1_000 + index * 400));
  m.messages = shots.map((shot) => shot.message);
  m.media = shots.map((shot) => shot.attachment);
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  return shots;
}

it("caps a seven-photo album at four cells and counts the rest over the fourth", async () => {
  photoAlbum(7);
  await open();
  const album = screen.getByRole("listitem", { name: "7 photos" });
  // The album names the real total and keeps every member id for the jump
  // fallback, but only four member rows exist.
  expect(album.getAttribute("aria-label")).toBe("7 photos");
  expect(album.getAttribute("data-chat-run-members")).toBe(
    "photo-1 photo-2 photo-3 photo-4 photo-5 photo-6 photo-7");
  expect(album.getAttribute("tabindex")).toBe("-1");
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(4);
  for (const hidden of ["photo-5", "photo-6", "photo-7"]) {
    expect(document.querySelector(`[data-chat-message="${hidden}"]`)).toBeNull();
  }
  // Four visible members form a plain 2x2 grid: the hidden tail never leaves a
  // wide first cell behind.
  const cells = album.querySelectorAll(":scope > .fb-chat-line-row");
  expect(cells).toHaveLength(4);
  expect(album.querySelectorAll(".fb-chat-line-row-wide")).toHaveLength(0);
  // The overlay only paints once the stored bytes resolve, in the same commit
  // that inserts the counted viewer action, so wait for that action instead of
  // reading the overlay ahead of the media read.
  const viewMore = await screen.findByRole("button", { name: "View photo, 3 more" });
  // Exactly one overlay, the last child inside the fourth picture, so it is
  // clipped to the photo instead of covering the receipt row.
  const fourth = document.querySelector('[data-chat-message="photo-4"]')!;
  const more = fourth.querySelector(".fb-chat-photo-more");
  expect(more?.textContent).toBe("+3");
  expect(fourth.querySelector(".fb-chat-photo")?.lastElementChild).toBe(more);
  expect(document.querySelectorAll(".fb-chat-photo-more")).toHaveLength(1);
  // The picture keeps its viewer action and names the hidden count.
  expect(viewMore).toBeTruthy();
});

it("keeps the fourth cell's status card intact when its photo has no bytes", async () => {
  const shots = photoAlbum(7);
  // The fourth cell is the one that would carry +3. Without bytes it must show
  // the honest status card instead of a count over a picture that is not there.
  m.media = shots.map((shot, index) => index === 3
    ? { ...shot.attachment, state: "EVICTED", expiresAt: Date.now() - 1_000 }
    : shot.attachment);
  await open();
  expect(screen.getByRole("listitem", { name: "7 photos" })).toBeTruthy();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(4);
  expect(document.querySelectorAll(".fb-chat-line-row")).toHaveLength(4);
  for (const hidden of ["photo-5", "photo-6", "photo-7"]) {
    expect(document.querySelector(`[data-chat-message="${hidden}"]`)).toBeNull();
  }
  const fourth = document.querySelector<HTMLElement>('[data-chat-message="photo-4"]')!;
  expect(await within(fourth).findByText("Photo unavailable")).toBeTruthy();
  expect(fourth.querySelector('.fb-chat-photo [role="status"]')).toBeTruthy();
  expect(document.querySelectorAll(".fb-chat-photo-more")).toHaveLength(0);
});

it("keeps five photos to four cells behind a +1 overlay", async () => {
  photoAlbum(5);
  await open();
  const album = screen.getByRole("listitem", { name: "5 photos" });
  expect(album.querySelectorAll(":scope > .fb-chat-line-row")).toHaveLength(4);
  expect(document.querySelector('[data-chat-message="photo-5"]')).toBeNull();
  // The count paints with the resolved picture, in the same commit as its
  // counted viewer action, so wait for that action before reading the overlay.
  const oneMore = await screen.findByRole("button", { name: "View photo, 1 more" });
  expect(document.querySelector(".fb-chat-photo-more")?.textContent).toBe("+1");
  expect(oneMore).toBeTruthy();
});

it("shows four photos with no overflow overlay", async () => {
  photoAlbum(4);
  await open();
  const album = screen.getByRole("listitem", { name: "4 photos" });
  expect(album.querySelectorAll(":scope > .fb-chat-line-row")).toHaveLength(4);
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(4);
  // An absent overlay only means something once every picture is painted: the
  // resolved branch of each cell renders its viewer button.
  await waitFor(() => expect(document.querySelectorAll(".fb-chat-photo > button")).toHaveLength(4));
  expect(document.querySelector(".fb-chat-photo-more")).toBeNull();
  expect(album.querySelectorAll(".fb-chat-line-row-wide")).toHaveLength(0);
});

it("keeps three photos as three separate rows", async () => {
  photoAlbum(3);
  await open();
  // Owner direction 2026-11-20: three items are below the four-item album
  // threshold, so each is an ordinary row with its own bubble, receipt and
  // menu - never an album, and never a wide opening cell.
  expect(screen.queryByRole("listitem", { name: /photos/i })).toBeNull();
  expect(document.querySelector(".fb-chat-run")).toBeNull();
  expect(document.querySelectorAll("li.fb-chat-line")).toHaveLength(3);
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(3);
  expect(document.querySelector(".fb-chat-line-row-wide")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Options for your message" })).toHaveLength(3);
});

it("caps a mixed photo/video album and keeps a bare clip as a compact tile", async () => {
  const stills = [photo("photo-1", 1_000), photo("photo-2", 1_800), photo("photo-3", 2_200), photo("photo-4", 2_600)];
  const clips = [video("clip-1", 1_400), video("clip-2", 3_000), video("clip-3", 3_400)];
  m.messages = [stills[0]!.message, clips[0]!, stills[1]!.message, stills[2]!.message,
    stills[3]!.message, clips[1]!, clips[2]!];
  m.media = stills.map((still) => still.attachment);
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const album = screen.getByRole("listitem", { name: "4 photos and 3 videos" });
  expect(album.querySelectorAll(":scope > .fb-chat-line-row")).toHaveLength(4);
  // A bare clip never forces the single-column stack: the album stays a grid.
  expect(album.classList.contains("fb-chat-run-stack")).toBe(false);
  // The clip in the visible set renders the shared compact tile action, and the
  // last visible cell is a photo, so the overflow sits on its picture.
  expect(await screen.findByRole("button", { name: "Play clip-1.mp4" })).toBeTruthy();
  expect(document.querySelector(".fb-chat-run-more-badge")).toBeNull();
  // The last visible cell is a photo, so its count waits on its resolved bytes
  // exactly like the capped album above.
  expect(await screen.findByRole("button", { name: "View photo, 3 more" })).toBeTruthy();
  expect(document.querySelector(".fb-chat-photo-more")?.textContent).toBe("+3");
});

it("opens the shared viewer from the capped fourth cell and lists all seven photos", async () => {
  photoAlbum(7);
  await open();
  fireEvent.click(await screen.findByRole("button", { name: "View photo, 3 more" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  const strip = await screen.findByRole("navigation", { name: "Thumbnails" });
  // The viewer reads every photo in the conversation, not only the four cells
  // the capped album paints.
  expect(within(strip).getAllByRole("button")).toHaveLength(7);
});
