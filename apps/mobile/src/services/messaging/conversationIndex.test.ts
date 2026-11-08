// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LocalConversationState } from "./conversationIndex";
import { summarizeConversations } from "./conversationIndex";
import type { StoredHumanMessage } from "./history";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const CONVERSATION = "00000000-0000-4000-8000-000000000006";
const scope = { accountId: A, deviceId: "00000000-0000-4000-8000-000000000003" };
const state: LocalConversationState = { conversationId: CONVERSATION, peerId: B,
  readThrough: 0, updatedAt: 1 };

function message(overrides: Partial<StoredHumanMessage> & Pick<StoredHumanMessage, "id">): StoredHumanMessage {
  return { conversationId: CONVERSATION, authorId: A, recipientId: B, body: "text", ...overrides };
}

describe("conversation summaries", () => {
  it("does not promote an unpositioned unsent tombstone above newer messages", () => {
    const summaries = summarizeConversations(scope, [state], [
      message({ id: "00000000-0000-4000-8000-000000000011", body: "first",
        server: { eventId: "00000000-0000-4000-8000-000000000021", sequence: 1 } }),
      message({ id: "00000000-0000-4000-8000-000000000012", body: "second",
        server: { eventId: "00000000-0000-4000-8000-000000000022", sequence: 2 } }),
      // The legacy orphan: body erased, no server position.
      message({ id: "00000000-0000-4000-8000-000000000013", body: "", unsentAt: 5 }),
    ], []);
    expect(summaries[0]!.lastMessage?.id).toBe("00000000-0000-4000-8000-000000000012");
  });

  it("still lets a genuinely pending send be the newest preview", () => {
    const summaries = summarizeConversations(scope, [state], [
      message({ id: "00000000-0000-4000-8000-000000000011", body: "sent",
        server: { eventId: "00000000-0000-4000-8000-000000000021", sequence: 1 } }),
      message({ id: "00000000-0000-4000-8000-000000000014", body: "still sending" }),
    ], [{ messageId: "00000000-0000-4000-8000-000000000014", status: "QUEUED", attempts: 0 }]);
    expect(summaries[0]!.lastMessage?.id).toBe("00000000-0000-4000-8000-000000000014");
  });

  it("leaves the preview empty when the only record is an unpositioned tombstone", () => {
    const summaries = summarizeConversations(scope, [state], [
      message({ id: "00000000-0000-4000-8000-000000000013", body: "", unsentAt: 5 }),
    ], []);
    expect(summaries[0]!.lastMessage).toBeNull();
  });

  it("keeps a positioned unsent message as the preview when it is genuinely newest", () => {
    const summaries = summarizeConversations(scope, [state], [
      message({ id: "00000000-0000-4000-8000-000000000012", body: "second",
        server: { eventId: "00000000-0000-4000-8000-000000000022", sequence: 2 } }),
      message({ id: "00000000-0000-4000-8000-000000000015", body: "", unsentAt: 6,
        server: { eventId: "00000000-0000-4000-8000-000000000025", sequence: 3 } }),
    ], []);
    expect(summaries[0]!.lastMessage?.id).toBe("00000000-0000-4000-8000-000000000015");
  });

  it("never counts an unsent tombstone as unread", () => {
    const incoming = (overrides: Partial<StoredHumanMessage> & Pick<StoredHumanMessage, "id">) =>
      message({ ...overrides, authorId: B, recipientId: A });
    const summaries = summarizeConversations(scope, [state], [
      incoming({ id: "00000000-0000-4000-8000-000000000016", body: "new",
        server: { eventId: "00000000-0000-4000-8000-000000000026", sequence: 4 } }),
      incoming({ id: "00000000-0000-4000-8000-000000000017", body: "", unsentAt: 7 }),
    ], []);
    expect(summaries[0]!.unreadCount).toBe(1);
    expect(summaries[0]!.lastMessage?.id).toBe("00000000-0000-4000-8000-000000000016");
  });
});
