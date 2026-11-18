// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationProjection } from "../services/messaging/conversationIndex";

const state = vi.hoisted(() => ({
  account: "viewer", status: "ready", projections: {} as Record<string, ConversationProjection> | null,
  conversations: [] as Array<{ peerId: string; cachedProjection: ConversationProjection | null }>,
  create: vi.fn(), send: vi.fn(), refresh: vi.fn(), end: vi.fn(),
}));
vi.mock("../auth", () => ({
  useAuth: () => ({ user: { id: state.account } }),
  useOptionalAuth: () => ({ user: { id: state.account } }),
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => ({
  accountId: state.account, status: state.status, currentProjections: state.projections,
  conversations: state.conversations,
}) }));
vi.mock("../services/messaging/runtime", () => ({
  requestMessagingConversation: (...args: unknown[]) => state.create(...args),
  refreshMessaging: (...args: unknown[]) => state.refresh(...args),
  sendMessagingText: (...args: unknown[]) => state.send(...args),
  changeMessagingRelationship: (...args: unknown[]) => state.end(...args),
}));
import { PeerIdentityActions } from "./PeerIdentityActions";
import { UserIdentityTrigger } from "./UserIdentityTrigger";
import type { PublicIdentity } from "./UserIdentityTrigger";

const person = { id: "peer", username: "river", displayName: "River Lee", avatarUrl: null };
const connected: ConversationProjection = { conversationId: "chat", peerId: "peer", mode: "CONNECTED", request: "NONE",
  requestEpoch: null, ownBlocked: false, ownHidden: false, ownDeclined: false, revision: 1 };

function Here() {
  const location = useLocation();
  return <p data-testid="here">{location.pathname}{location.search}</p>;
}

function mount(identity: PublicIdentity = person) {
  return render(identityTree(identity));
}
function identityTree(identity: PublicIdentity) {
  return <MemoryRouter><Routes>
    <Route path="/" element={<PeerIdentityActions person={identity} />} />
    <Route path="/chats/:id" element={<><h1>Chat opened</h1><Here /></>} />
  </Routes></MemoryRouter>;
}
beforeEach(() => {
  state.account = "viewer"; state.status = "ready"; state.projections = {}; state.conversations = [];
  state.create.mockReset().mockResolvedValue("chat"); state.send.mockReset().mockResolvedValue("message");
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.end.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it("supplies the §9 safety rows in a stranger card", async () => {
  mount();
  expect(screen.getByRole("button", { name: "Add friend River Lee" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
  expect(await screen.findByRole("menuitem", { name: "Report user" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Block account" })).toBeTruthy();
});

it("sends the friend request and opens the conversation in one action", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add friend River Lee" }));
  await screen.findByRole("heading", { name: "Chat opened" });
  expect(state.create).toHaveBeenCalledExactlyOnceWith("viewer", "peer");
  // The request flow never composes a hidden first message: the conversation is
  // the place to write.
  expect(state.send).not.toHaveBeenCalled();
});

it("keeps an outgoing request as one button that opens its conversation", async () => {
  state.projections = { chat: { ...connected, mode: "REQUEST", request: "OUTGOING" } };
  mount();
  expect(screen.getByText("Request sent. You can still message.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open chat River Lee" }));
  await screen.findByRole("heading", { name: "Chat opened" });
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps an incoming request as View request, with safety available", async () => {
  state.projections = { chat: { ...connected, mode: "REQUEST", request: "INCOMING" } };
  mount();
  expect(screen.getByText("This person asked to message you.")).toBeTruthy();
  // Safety is the profile's, so it is checked before the button replaces this
  // route with the conversation.
  expect(screen.getByRole("button", { name: "More profile actions" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View request River Lee" }));
  await screen.findByRole("heading", { name: "Chat opened" });
});

it("offers Message plus an explicit, confirmed Remove friend on a connected profile", () => {
  state.projections = { chat: connected };
  mount();
  expect(screen.getByRole("button", { name: "Message River Lee" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove friend" }));
  const confirm = screen.getByRole("group", { name: "Remove friend" });
  expect(confirm.textContent).toContain("Your messages stay in the conversation.");
  expect(screen.getByRole("button", { name: "More profile actions" })).toBeTruthy();
  expect(state.end).not.toHaveBeenCalled();
});

it("keeps a friend labelled as a friend while the live snapshot is still opening", () => {
  // The Connect directory already knows this person is a friend from its own
  // cached index; the card must not briefly offer a second friend request.
  state.status = "opening"; state.projections = null;
  state.conversations = [{ peerId: "peer", cachedProjection: connected }];
  mount();
  expect(screen.getByRole("button", { name: "Message River Lee" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add friend River Lee" })).toBeNull();
});

it("renders the identity as a direct profile link with no card until it is asked for", () => {
  render(<MemoryRouter><UserIdentityTrigger person={{ ...person, email: "private@example.test" } as typeof person} /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Open River Lee's profile" });
  expect(link.getAttribute("href")).toBe("/u/river");
  expect(link.textContent).not.toContain("private@example.test");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("carries the report subject into an existing conversation without sending", async () => {
  state.projections = { chat: connected };
  mount({ ...person, contextReportId: "report-id" });
  fireEvent.click(screen.getByRole("button", { name: "Message River Lee" }));
  await screen.findByRole("heading", { name: "Chat opened" });
  expect(screen.getByTestId("here").textContent).toBe("/chats/chat?report=report-id");
  expect(state.create).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});

it("opens report-origin first contact on that report", async () => {
  mount({ ...person, contextReportId: "report-id" });
  fireEvent.click(screen.getByRole("button", { name: "Add friend River Lee" }));
  await screen.findByRole("heading", { name: "Chat opened" });
  expect(state.create).toHaveBeenCalledExactlyOnceWith("viewer", "peer");
  expect(screen.getByTestId("here").textContent).toBe("/chats/chat?report=report-id");
  expect(state.send).not.toHaveBeenCalled();
});

it("says why a new request cannot start yet instead of failing silently", async () => {
  state.status = "offline"; state.projections = null;
  mount();
  const add = screen.getByRole("button", { name: "Add friend River Lee" });
  expect(add).toHaveProperty("disabled", false);
  fireEvent.click(add);
  expect(await screen.findByText("You're offline. Check your connection, then tap again.")).toBeTruthy();
  expect(state.refresh).toHaveBeenCalledWith("viewer");
  expect(state.create).not.toHaveBeenCalled();
});

it("shows no contact action for self or a locally blocked peer", () => {
  state.account = "peer"; const view = mount();
  expect(screen.queryByRole("button", { name: /Add friend/ })).toBeNull();
  state.account = "viewer"; state.projections = { chat: { ...connected, ownBlocked: true } };
  view.rerender(<MemoryRouter><PeerIdentityActions person={person} /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "Message River Lee" })).toBeNull();
  expect(screen.getByText("You blocked this account. Unblock it to message.")).toBeTruthy();
});

it("drops a pending first-contact navigation across an account replacement", async () => {
  let resolve!: (id: string) => void;
  state.create.mockReturnValue(new Promise<string>(done => { resolve = done; }));
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Add friend River Lee" }));
  state.account = "replacement";
  view.rerender(<MemoryRouter><PeerIdentityActions person={person} /></MemoryRouter>);
  await act(async () => { resolve("old-chat"); });
  expect(screen.queryByRole("heading", { name: "Chat opened" })).toBeNull();
});
