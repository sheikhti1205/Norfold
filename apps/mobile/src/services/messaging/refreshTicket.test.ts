import { describe, expect, it } from "vitest";
import { mergeRefresh, ticketFor } from "./refreshTicket";

describe("mergeRefresh", () => {
  it("returns the incoming ticket when none is pending", () => {
    const next = ticketFor("fast", "a");
    expect(mergeRefresh(null, next)).toBe(next);
  });

  it("prefers full over fast in either position without retaining a target", () => {
    expect(mergeRefresh(ticketFor("full"), ticketFor("fast", "a"))).toEqual({ mode: "full" });
    expect(mergeRefresh(ticketFor("fast", "a"), ticketFor("full"))).toEqual({ mode: "full" });
  });

  it("keeps a shared fast target", () => {
    expect(mergeRefresh(ticketFor("fast", "a"), ticketFor("fast", "a"))).toEqual({ mode: "fast", conversationId: "a" });
  });

  it("widens different fast targets", () => {
    expect(mergeRefresh(ticketFor("fast", "a"), ticketFor("fast", "b"))).toEqual({ mode: "fast" });
  });

  it("widens targeted and untargeted fast tickets in either position", () => {
    expect(mergeRefresh(ticketFor("fast", "a"), ticketFor("fast"))).toEqual({ mode: "fast" });
    expect(mergeRefresh(ticketFor("fast"), ticketFor("fast", "a"))).toEqual({ mode: "fast" });
  });
});

describe("ticketFor", () => {
  it("omits an undefined conversation id", () => {
    expect("conversationId" in ticketFor("fast")).toBe(false);
  });

  it("preserves supplied ids for both modes", () => {
    expect(ticketFor("fast", "a")).toEqual({ mode: "fast", conversationId: "a" });
    expect(ticketFor("full", "a")).toEqual({ mode: "full", conversationId: "a" });
  });
});
