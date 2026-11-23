import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllConversationDrafts,
  clearConversationDraft,
  readConversationDraft,
  writeConversationDraft,
} from "./conversationDrafts";

describe("conversation drafts", () => {
  beforeEach(() => { clearAllConversationDrafts(); });

  it("returns the text that was written", () => {
    writeConversationDraft("account-a", "chat-1", "Meet me at the gate");
    expect(readConversationDraft("account-a", "chat-1")).toBe("Meet me at the gate");
  });

  it("treats an empty or whitespace-only write as a clear", () => {
    writeConversationDraft("account-a", "chat-1", "Draft");
    writeConversationDraft("account-a", "chat-1", "   \n\t ");
    expect(readConversationDraft("account-a", "chat-1")).toBe("");
  });

  it("keeps one account's text out of every other account", () => {
    writeConversationDraft("account-a", "chat-1", "Private words");
    expect(readConversationDraft("account-b", "chat-1")).toBe("");
    writeConversationDraft("account-b", "chat-1", "B words");
    expect(readConversationDraft("account-a", "chat-1")).toBe("Private words");
    expect(readConversationDraft("account-b", "chat-1")).toBe("B words");
  });

  it("clears one conversation without touching the others", () => {
    writeConversationDraft("account-a", "chat-1", "One");
    writeConversationDraft("account-a", "chat-2", "Two");
    clearConversationDraft("account-a", "chat-1");
    expect(readConversationDraft("account-a", "chat-1")).toBe("");
    expect(readConversationDraft("account-a", "chat-2")).toBe("Two");
  });

  it("evicts the least recently used entry once the cap is reached", () => {
    for (let index = 1; index <= 64; index++) writeConversationDraft("account-a", `chat-${index}`, `text ${index}`);
    // A read is recent use, so the conversation the reader is looking at must
    // not be the one the next write evicts.
    expect(readConversationDraft("account-a", "chat-1")).toBe("text 1");
    writeConversationDraft("account-a", "chat-65", "text 65");

    expect(readConversationDraft("account-a", "chat-1")).toBe("text 1");
    expect(readConversationDraft("account-a", "chat-2")).toBe("");
    expect(readConversationDraft("account-a", "chat-3")).toBe("text 3");
    expect(readConversationDraft("account-a", "chat-65")).toBe("text 65");
  });

  it("empties every account on sign-out", () => {
    writeConversationDraft("account-a", "chat-1", "A text");
    writeConversationDraft("account-b", "chat-2", "B text");
    clearAllConversationDrafts();
    expect(readConversationDraft("account-a", "chat-1")).toBe("");
    expect(readConversationDraft("account-b", "chat-2")).toBe("");
  });
});
