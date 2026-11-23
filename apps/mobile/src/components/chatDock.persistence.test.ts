// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatDockState } from "./chatDock";

/**
 * Reload acceptance for the chat dock's open windows.
 *
 * `sessionStorage` lives on the jsdom window, so it survives `vi.resetModules()`
 * exactly as it survives a page reload: a test writes the record through one
 * module instance and reads it back through a fresh one. A real mutation is the
 * only writer, so the record can never drift from what the rail actually showed.
 */

type Store = typeof import("./chatDock");

async function reloadStore(): Promise<Store> {
  vi.resetModules();
  return import("./chatDock");
}

const KEY = (accountId: string) => `fb-chat-dock-entries:${accountId}`;

/** The rail as plain text: entries in order, then the tucked flag and the rank. */
function railText(state: ChatDockState | null): string {
  if (state === null) return "null";
  const entries = state.entries
    .map((entry) => `${entry.conversationId ?? "-"}:${entry.phase}:${entry.seq}`)
    .join(",") || "empty";
  return `${entries}|tucked:${state.tucked}|seq:${state.seq}`;
}

/** A probe bound to one freshly imported module, with optional read capture. */
function probe(store: Store, reads: Array<ChatDockState | null> = []) {
  return function DockProbe({ viewer }: { viewer: string | null }) {
    const state = store.useChatDock(viewer);
    reads.push(state);
    return createElement("output", { "data-testid": "rail" }, railText(state));
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

afterEach(cleanup);

describe("chatDock reload persistence", () => {
  it("restores the same account's windows, phases and focus order after a reload", async () => {
    const first = await reloadStore();
    first.openChatDock("me", null, "c1", 3);
    first.openChatDock("me", null, "c2", 3);
    first.minimizeChatDock("me", "c1");

    // Exactly the state that must be restored: no account id, no dismissal.
    expect(JSON.parse(sessionStorage.getItem(KEY("me")) ?? "null")).toEqual({
      seq: 2,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "minimized", seq: 1 },
        { conversationId: "c2", phase: "open", seq: 2 },
      ],
    });

    const second = await reloadStore();
    render(createElement(probe(second), { viewer: "me" }));
    expect(screen.getByTestId("rail").textContent)
      .toBe("c1:minimized:1,c2:open:2|tucked:false|seq:2");
  });

  it("keeps the tucked rail and its heads across a reload", async () => {
    const first = await reloadStore();
    first.openChatDock("me", null, "c1", 3);
    first.openChatDock("me", null, "c2", 3);
    first.tuckChatDock("me");

    const second = await reloadStore();
    render(createElement(probe(second), { viewer: "me" }));
    // Tucking fits every open thread into a bubble and leaves the rest order
    // alone, so the circle comes back with the same two heads.
    expect(screen.getByTestId("rail").textContent)
      .toBe("c1:minimized:1,c2:minimized:2|tucked:true|seq:2");
  });

  it("never hydrates another account's rail", async () => {
    const first = await reloadStore();
    first.openChatDock("me", null, "c1", 3);

    const second = await reloadStore();
    const Probe = probe(second);
    render(createElement(Probe, { viewer: "other" }));
    expect(screen.getByTestId("rail").textContent).toBe("empty|tucked:true|seq:0");

    // The same module still restores its own account once asked for it.
    cleanup();
    render(createElement(Probe, { viewer: "me" }));
    expect(screen.getByTestId("rail").textContent).toBe("c1:open:1|tucked:false|seq:1");
  });

  it("treats corrupt or wrong-shaped storage as a first visit", async () => {
    const corrupt = [
      "{not json",
      "null",
      "[]",
      JSON.stringify({ seq: 1, tucked: "false", entries: [{ conversationId: "c9", phase: "open", seq: 1 }] }),
      JSON.stringify({ seq: 1, tucked: false, entries: { c9: "open" } }),
      JSON.stringify({ seq: 1, tucked: false }),
      JSON.stringify({ seq: 1, entries: [] }),
    ];
    for (const raw of corrupt) {
      sessionStorage.setItem(KEY("me"), raw);
      const store = await reloadStore();
      const view = render(createElement(probe(store), { viewer: "me" }));
      // A half-readable record is not restored in part: the circle only.
      expect(screen.getByTestId("rail").textContent, raw).toBe("empty|tucked:true|seq:0");
      view.unmount();
    }
  });

  it("drops invalid and duplicate entries and keeps at most five most recent heads", async () => {
    sessionStorage.setItem(KEY("me"), JSON.stringify({
      seq: 1,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "open", seq: 1 },
        { conversationId: "c1", phase: "minimized", seq: 9 },
        { conversationId: "", phase: "open", seq: 9 },
        { conversationId: "c2", phase: "expanded", seq: 9 },
        { conversationId: "c3", phase: "open", seq: 2 },
        { conversationId: "c4", phase: "open", seq: 3 },
        { conversationId: "c5", phase: "open", seq: 4 },
        { conversationId: "c6", phase: "open", seq: 5 },
        { conversationId: "c7", phase: "open", seq: 6 },
        "junk",
        null,
      ],
    }));
    const store = await reloadStore();
    render(createElement(probe(store), { viewer: "me" }));
    // Six valid entries: the oldest falls away with the corrupt ones, and the
    // rank is clamped up to the highest restored entry so no two windows tie.
    expect(screen.getByTestId("rail").textContent)
      .toBe("c3:open:2,c4:open:3,c5:open:4,c6:open:5,c7:open:6|tucked:false|seq:6");
  });

  it("restores nothing after Close, so a reload paints only the circle", async () => {
    const first = await reloadStore();
    first.openChatDock("me", null, "c1", 3);
    first.closeChatDockSurface("me");
    expect(sessionStorage.getItem(KEY("me"))).toBeNull();

    const second = await reloadStore();
    render(createElement(probe(second), { viewer: "me" }));
    expect(screen.getByTestId("rail").textContent).toBe("empty|tucked:true|seq:0");
  });

  it("never stores the new-message picker", async () => {
    const first = await reloadStore();
    first.openChatDock("me", null, null, 3);
    expect(JSON.parse(sessionStorage.getItem(KEY("me")) ?? "null"))
      .toEqual({ seq: 1, tucked: false, entries: [] });

    const second = await reloadStore();
    render(createElement(probe(second), { viewer: "me" }));
    // The open rail returns without it: no picker, no phantom conversation.
    expect(screen.getByTestId("rail").textContent).toBe("empty|tucked:false|seq:1");
  });

  it("folds surplus hydrated windows on the first capacity clamp and never untucks", async () => {
    sessionStorage.setItem(KEY("me"), JSON.stringify({
      seq: 3,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "open", seq: 1 },
        { conversationId: "c2", phase: "open", seq: 2 },
        { conversationId: "c3", phase: "open", seq: 3 },
      ],
    }));
    const store = await reloadStore();
    render(createElement(probe(store), { viewer: "me" }));
    // Hydration is adopted during the first render, so the clamp's first run
    // sees the restored windows instead of returning early on an empty store.
    act(() => store.clampChatDockCapacity("me", 1));
    expect(JSON.parse(sessionStorage.getItem(KEY("me")) ?? "null")).toEqual({
      seq: 3,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "minimized", seq: 1 },
        { conversationId: "c2", phase: "minimized", seq: 2 },
        { conversationId: "c3", phase: "open", seq: 3 },
      ],
    });
  });

  it("hands React the same hydrated snapshot on every render", async () => {
    sessionStorage.setItem(KEY("me"), JSON.stringify({
      seq: 4,
      tucked: true,
      entries: [{ conversationId: "c1", phase: "minimized", seq: 4 }],
    }));
    const store = await reloadStore();
    const reads: Array<ChatDockState | null> = [];
    const Probe = probe(store, reads);
    const view = render(createElement("div", null,
      createElement(Probe, { viewer: "me" }),
      createElement(Probe, { viewer: "me" })));
    view.rerender(createElement(Probe, { viewer: "me" }));

    // A fresh object per read would re-render forever; hydration is cached.
    expect(reads.length).toBeGreaterThan(1);
    expect(reads[0]).not.toBeNull();
    for (const read of reads) expect(read).toBe(reads[0]);
    // Hydration only reads: the record is untouched until a real mutation.
    expect(JSON.parse(sessionStorage.getItem(KEY("me")) ?? "null").seq).toBe(4);
  });
});
