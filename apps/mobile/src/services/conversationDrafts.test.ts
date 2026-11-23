// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllConversationDrafts,
  clearConversationDraft,
  readConversationDraft,
  writeConversationDraft,
} from "./conversationDrafts";

function storageKey(accountId: string): string {
  return `fb-chat-drafts:${accountId}`;
}

/**
 * A reload: jsdom's `sessionStorage` outlives `vi.resetModules()`, the module
 * registry does not. The returned module is the fresh page instance.
 */
async function reload(): Promise<typeof import("./conversationDrafts")> {
  vi.resetModules();
  return import("./conversationDrafts");
}

/** The synchronous flush a real reload or tab close triggers. */
function pageHide(): void {
  window.dispatchEvent(new Event("pagehide"));
}

function storedRecord(accountId: string): Record<string, string> | null {
  const raw = sessionStorage.getItem(storageKey(accountId));
  return raw === null ? null : (JSON.parse(raw) as Record<string, string>);
}

function requireRecord(accountId: string): Record<string, string> {
  const record = storedRecord(accountId);
  if (record === null) throw new Error(`expected a stored record for ${accountId}`);
  return record;
}

describe("conversation drafts", () => {
  beforeEach(() => { clearAllConversationDrafts(); });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("restores unsent text after a reload for the same account", async () => {
    writeConversationDraft("account-a", "chat-1", "Meet me at the gate");
    writeConversationDraft("account-a", "chat-2", "Second window");
    pageHide();

    const fresh = await reload();
    expect(fresh.readConversationDraft("account-a", "chat-1")).toBe("Meet me at the gate");
    expect(fresh.readConversationDraft("account-a", "chat-2")).toBe("Second window");
  });

  it("does not bring a sent draft back after a reload", async () => {
    writeConversationDraft("account-a", "chat-1", "Sent words");
    pageHide();
    expect(storedRecord("account-a")).toEqual({ "chat-1": "Sent words" });

    // The send path clears with no debounce; the record must already be gone.
    clearConversationDraft("account-a", "chat-1");
    expect(sessionStorage.getItem(storageKey("account-a"))).toBeNull();

    const fresh = await reload();
    expect(fresh.readConversationDraft("account-a", "chat-1")).toBe("");
  });

  it("never shows one account's restored text to another account", async () => {
    writeConversationDraft("account-a", "chat-1", "Private words");
    pageHide();

    const fresh = await reload();
    expect(fresh.readConversationDraft("account-b", "chat-1")).toBe("");
    expect(fresh.readConversationDraft("account-a", "chat-1")).toBe("Private words");
  });

  it("persists exactly the entries the LRU cap keeps", async () => {
    for (let index = 1; index <= 64; index++) writeConversationDraft("account-a", `chat-${index}`, `text ${index}`);
    expect(readConversationDraft("account-a", "chat-1")).toBe("text 1");
    writeConversationDraft("account-a", "chat-65", "text 65");
    pageHide();

    const record = requireRecord("account-a");
    expect(Object.keys(record)).toHaveLength(64);
    expect(record["chat-1"]).toBe("text 1");
    expect(record["chat-2"]).toBeUndefined();
    expect(record["chat-65"]).toBe("text 65");

    const fresh = await reload();
    expect(fresh.readConversationDraft("account-a", "chat-2")).toBe("");
    expect(fresh.readConversationDraft("account-a", "chat-1")).toBe("text 1");
    expect(fresh.readConversationDraft("account-a", "chat-65")).toBe("text 65");
  });

  it("drops only the oldest entries a 256 KB record cannot hold", () => {
    const chunk = "x".repeat(5_000);
    for (let index = 1; index <= 64; index++) writeConversationDraft("account-a", `chat-${index}`, `${index}:${chunk}`);
    pageHide();

    const record = requireRecord("account-a");
    expect(Object.keys(record).length).toBeGreaterThan(0);
    expect(Object.keys(record).length).toBeLessThan(64);
    expect(record["chat-64"]).toBeDefined();
    expect(record["chat-1"]).toBeUndefined();
    // Only the stored record gave way; the reader's words are all still here.
    expect(readConversationDraft("account-a", "chat-1")).toHaveLength(chunk.length + 2);
  });

  it("keeps an over-budget draft in memory instead of truncating it", () => {
    const huge = "y".repeat(300_000);
    writeConversationDraft("account-a", "chat-1", huge);
    pageHide();

    expect(sessionStorage.getItem(storageKey("account-a"))).toBeNull();
    expect(readConversationDraft("account-a", "chat-1")).toBe(huge);
  });

  it("ignores a corrupt stored record", async () => {
    sessionStorage.setItem(storageKey("account-a"), "{not json");
    const fresh = await reload();
    expect(fresh.readConversationDraft("account-a", "chat-1")).toBe("");
  });

  it("ignores a stored record that is not a conversation map", async () => {
    sessionStorage.setItem(storageKey("account-a"), JSON.stringify(["chat-1"]));
    let fresh = await reload();
    expect(fresh.readConversationDraft("account-a", "chat-1")).toBe("");

    sessionStorage.setItem(storageKey("account-a"), JSON.stringify({ chat: 5 }));
    fresh = await reload();
    expect(fresh.readConversationDraft("account-a", "chat")).toBe("");
  });

  it("stays volatile and usable when sessionStorage refuses every access", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage disabled"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage disabled"); });

    expect(() => writeConversationDraft("account-a", "chat-1", "Volatile words")).not.toThrow();
    expect(() => pageHide()).not.toThrow();
    expect(readConversationDraft("account-a", "chat-1")).toBe("Volatile words");
    expect(() => writeConversationDraft("account-a", "chat-1", "   ")).not.toThrow();
    expect(readConversationDraft("account-a", "chat-1")).toBe("");
    expect(() => clearAllConversationDrafts()).not.toThrow();
  });

  it("removes every stored account record on sign-out, and nothing else", () => {
    writeConversationDraft("account-a", "chat-1", "A text");
    writeConversationDraft("account-b", "chat-2", "B text");
    pageHide();
    sessionStorage.setItem("findback.authReturnTo", "{}");
    expect(sessionStorage.getItem(storageKey("account-a"))).not.toBeNull();
    expect(sessionStorage.getItem(storageKey("account-b"))).not.toBeNull();

    clearAllConversationDrafts();

    expect(sessionStorage.getItem(storageKey("account-a"))).toBeNull();
    expect(sessionStorage.getItem(storageKey("account-b"))).toBeNull();
    expect(sessionStorage.getItem("findback.authReturnTo")).toBe("{}");
    sessionStorage.removeItem("findback.authReturnTo");
  });

  it("coalesces keystrokes and persists them on pagehide without waiting", () => {
    vi.useFakeTimers();
    writeConversationDraft("account-a", "chat-1", "H");
    writeConversationDraft("account-a", "chat-1", "He");
    writeConversationDraft("account-a", "chat-1", "Hey");
    expect(sessionStorage.getItem(storageKey("account-a"))).toBeNull();

    pageHide();

    expect(storedRecord("account-a")).toEqual({ "chat-1": "Hey" });
    vi.useRealTimers();
  });

  it("persists on its own once the debounce elapses", () => {
    vi.useFakeTimers();
    writeConversationDraft("account-a", "chat-1", "Later");
    expect(sessionStorage.getItem(storageKey("account-a"))).toBeNull();

    vi.advanceTimersByTime(400);

    expect(storedRecord("account-a")).toEqual({ "chat-1": "Later" });
    vi.useRealTimers();
  });

  it("flushes when the page becomes hidden", () => {
    vi.useFakeTimers();
    writeConversationDraft("account-a", "chat-1", "Hidden");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(storedRecord("account-a")).toEqual({ "chat-1": "Hidden" });
    vi.useRealTimers();
  });
});
