// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isMediaOnlyMessage } from "./Messaging";

/**
 * Content semantics of the flush media bubble. The predicate, not a rewritten
 * body, decides whether a photo owns the bubble, so a caption, quote, report,
 * location, control or failure state always keeps the readable padded surface.
 * Painted result stays a deployed-browser check; the CSS gate on a real picture
 * is asserted in the static ownership contract.
 */
describe("media-only message semantics", () => {
  const base = {
    messageType: "MEDIA",
    server: { sequence: 1 },
    body: "",
    unsentAt: undefined as number | undefined,
    replyToId: undefined as string | undefined,
    contextReportId: undefined as string | undefined,
    location: undefined as unknown,
  };
  const quiet = { actionable: false };

  it("owns the bubble only for a bare delivered photo", () => {
    expect(isMediaOnlyMessage(base, { state: "READY" }, quiet)).toBe(true);
    expect(isMediaOnlyMessage(base, { state: "EVICTED" }, quiet)).toBe(true);
  });

  it("keeps padded content for every caption, quote, report or location", () => {
    expect(isMediaOnlyMessage({ ...base, body: "look" }, { state: "READY" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage({ ...base, replyToId: "q" }, { state: "READY" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage({ ...base, contextReportId: "r" }, { state: "READY" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage({ ...base, location: { lat: 1, lng: 2 } }, { state: "READY" }, quiet)).toBe(false);
  });

  it("keeps a padded status row whenever a control or failure is present", () => {
    expect(isMediaOnlyMessage(base, { state: "READY" }, { actionable: true })).toBe(false);
    expect(isMediaOnlyMessage(base, { state: "FAILED" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage(base, { state: "AWAITING_ACK" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage(base, undefined, quiet)).toBe(false);
  });

  it("never treats an unsent, unaccepted or non-photo message as media-only", () => {
    expect(isMediaOnlyMessage({ ...base, unsentAt: Date.now() }, { state: "READY" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage({ ...base, server: undefined }, { state: "READY" }, quiet)).toBe(false);
    expect(isMediaOnlyMessage({ ...base, messageType: "TEXT" }, { state: "READY" }, quiet)).toBe(false);
  });
});
