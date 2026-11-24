// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chatFileBody, type ChatFileMeta } from "./files";
import type { MediaAttachment, StoredHumanMessage } from "./history";
import { buildMediaRuns, MEDIA_RUN_MAX_GAP_MS, splitSmallMediaRuns, type MediaRun } from "./mediaRuns";

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const PEER = "00000000-0000-4000-8000-0000000000b1";
const CONVERSATION = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CONVERSATION = "00000000-0000-4000-8000-0000000000c2";
const REPORT = "00000000-0000-4000-8000-0000000000d1";
const OTHER_REPORT = "00000000-0000-4000-8000-0000000000d2";
const REPLY = "00000000-0000-4000-8000-0000000000e1";
const OTHER_REPLY = "00000000-0000-4000-8000-0000000000e2";
/** A local composition instant: tests use local constructors so a day boundary
 * is a calendar boundary in every runner timezone. */
const AT = new Date(2026, 0, 5, 9, 0, 0, 0).getTime();

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function message(overrides: Partial<StoredHumanMessage> = {}): StoredHumanMessage {
  return {
    id: nextId(),
    conversationId: CONVERSATION,
    authorId: AUTHOR,
    recipientId: PEER,
    body: "",
    messageType: "MEDIA",
    createdAt: AT,
    ...overrides,
  };
}

/** A still photo row: MEDIA with (optionally) an attachment record. */
function photo(overrides: Partial<StoredHumanMessage> = {}): StoredHumanMessage {
  return message(overrides);
}

function text(overrides: Partial<StoredHumanMessage> = {}): StoredHumanMessage {
  return message({ messageType: "TEXT", body: "hello", ...overrides });
}

const VIDEO: ChatFileMeta = {
  key: `files/${AUTHOR}/${CONVERSATION}/clip.mp4`,
  name: "clip.mp4",
  mime: "video/mp4",
  byteSize: 2048,
  kind: "video",
};

/** A video row: TEXT carrying the canonical file marker. */
function video(overrides: Partial<StoredHumanMessage> = {}): StoredHumanMessage {
  return message({ messageType: "TEXT", body: chatFileBody(VIDEO), ...overrides });
}

function attachment(messageId: string, overrides: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    id: `attachment-${messageId}`,
    messageId,
    direction: "OUT",
    sha256: "a".repeat(64),
    mime: "image/jpeg",
    byteSize: 1024,
    width: 800,
    height: 600,
    durationMs: null,
    expiresAt: null,
    state: "READY",
    attempts: 0,
    lastAccessAt: AT,
    ...overrides,
  };
}

function ids(run: MediaRun): string[] {
  return run.messages.map((entry) => entry.id);
}

function kinds(runs: readonly MediaRun[]): string[] {
  return runs.map((run) => run.kind);
}

describe("media runs", () => {
  it("returns no runs for an empty transcript", () => {
    expect(buildMediaRuns([], [])).toEqual([]);
  });

  it("groups consecutive photos that share one composition instant", () => {
    const first = photo();
    const second = photo();
    const third = photo();
    const runs = buildMediaRuns(
      [first, second, third],
      [attachment(first.id), attachment(second.id), attachment(third.id)],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("group");
    expect(ids(runs[0]!)).toEqual([first.id, second.id, third.id]);
    expect(runs[0]!.key).toBe(`group:${first.id}`);
  });

  it("accepts a gap of exactly 60 seconds", () => {
    const first = photo({ createdAt: AT });
    const second = photo({ createdAt: AT + 60_000 });
    const runs = buildMediaRuns([first, second], []);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("group");
  });

  it("breaks at 60 seconds plus one millisecond", () => {
    const first = photo({ createdAt: AT });
    const second = photo({ createdAt: AT + MEDIA_RUN_MAX_GAP_MS + 1 });
    expect(kinds(buildMediaRuns([first, second], []))).toEqual(["single", "single"]);
  });

  it("measures the rolling gap against the previous item, not the first", () => {
    const first = photo({ createdAt: AT });
    const second = photo({ createdAt: AT + 60_000 });
    const third = photo({ createdAt: AT + 120_000 });
    const runs = buildMediaRuns([first, second, third], []);
    expect(runs).toHaveLength(1);
    expect(ids(runs[0]!)).toEqual([first.id, second.id, third.id]);
  });

  it("keeps a ten-item rolling chain that is longer than 60 seconds in total", () => {
    const chain = Array.from({ length: 10 }, (_, index) => photo({ createdAt: AT + index * 7_000 }));
    const runs = buildMediaRuns(chain, []);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("group");
    expect(runs[0]!.messages).toHaveLength(10);
    expect(chain[9]!.createdAt! - chain[0]!.createdAt!).toBe(63_000);
  });

  it("does not group a media item whose time is missing or invalid", () => {
    const first = photo({ createdAt: AT });
    const missing = photo({ createdAt: undefined });
    const nonFinite = photo({ createdAt: Number.NaN });
    const negative = photo({ createdAt: -1 });
    const runs = buildMediaRuns([first, missing, nonFinite, negative], []);
    expect(kinds(runs)).toEqual(["single", "single", "single", "single"]);
  });

  it("never groups photos whose composition instant is the zero sentinel", () => {
    const first = photo({ createdAt: 0 });
    const second = photo({ createdAt: 0 });
    const runs = buildMediaRuns([first, second], []);
    expect(kinds(runs)).toEqual(["single", "single"]);
    expect(runs[0]!.messages[0]).toBe(first);
    expect(runs[1]!.messages[0]).toBe(second);
  });

  it("never groups videos whose composition instant is the zero sentinel", () => {
    const first = video({ createdAt: 0 });
    const second = video({ createdAt: 0 });
    const runs = buildMediaRuns([first, second], []);
    expect(kinds(runs)).toEqual(["single", "single"]);
  });

  it("treats the zero sentinel as a boundary between known instants", () => {
    const known = photo({ createdAt: AT });
    const unknown = video({ createdAt: 0 });
    const later = photo({ createdAt: AT + 1_000 });
    const runs = buildMediaRuns([known, unknown, later], []);
    expect(kinds(runs)).toEqual(["single", "single", "single"]);
  });

  it("does not group a negative gap", () => {
    const first = photo({ createdAt: AT });
    const earlier = photo({ createdAt: AT - 1 });
    expect(kinds(buildMediaRuns([first, earlier], []))).toEqual(["single", "single"]);
  });

  it("breaks a run on a non-media message and keeps that message as its own single", () => {
    const first = photo({ createdAt: AT });
    const middle = text({ createdAt: AT + 1 });
    const last = photo({ createdAt: AT + 2 });
    const runs = buildMediaRuns([first, middle, last], []);
    expect(kinds(runs)).toEqual(["single", "single", "single"]);
    expect(ids(runs[0]!)).toEqual([first.id]);
    expect(ids(runs[1]!)).toEqual([middle.id]);
    expect(ids(runs[2]!)).toEqual([last.id]);
  });

  it("breaks on an author change", () => {
    const first = photo();
    const second = photo({ authorId: PEER, recipientId: AUTHOR });
    expect(kinds(buildMediaRuns([first, second], []))).toEqual(["single", "single"]);
  });

  it("breaks on a conversation change", () => {
    const first = photo();
    const second = photo({ conversationId: OTHER_CONVERSATION });
    expect(kinds(buildMediaRuns([first, second], []))).toEqual(["single", "single"]);
  });

  it("breaks when the reply target changes", () => {
    const first = photo({ replyToId: REPLY });
    const second = photo({ replyToId: undefined });
    const third = photo({ replyToId: OTHER_REPLY });
    expect(kinds(buildMediaRuns([first, second, third], [])))
      .toEqual(["single", "single", "single"]);
    const paired = buildMediaRuns([first, photo({ replyToId: REPLY })], []);
    expect(paired[0]!.kind).toBe("group");
  });

  it("breaks when the report context changes", () => {
    const first = photo({ contextReportId: REPORT });
    const second = photo({ contextReportId: OTHER_REPORT });
    const third = photo({ contextReportId: undefined });
    expect(kinds(buildMediaRuns([first, second, third], [])))
      .toEqual(["single", "single", "single"]);
    const paired = buildMediaRuns([first, photo({ contextReportId: REPORT })], []);
    expect(paired[0]!.kind).toBe("group");
  });

  it("breaks on an unsent item and never groups it", () => {
    const first = photo({ createdAt: AT });
    const unsent = photo({ createdAt: AT + 1, unsentAt: AT + 2, body: "" });
    const last = photo({ createdAt: AT + 2 });
    const runs = buildMediaRuns([first, unsent, last], []);
    expect(kinds(runs)).toEqual(["single", "single", "single"]);
    expect(runs[1]!.messages[0]).toBe(unsent);
  });

  it("breaks at a local calendar-day boundary even inside 60 seconds", () => {
    const late = photo({ createdAt: new Date(2026, 0, 5, 23, 59, 30).getTime() });
    const early = photo({ createdAt: new Date(2026, 0, 6, 0, 0, 30).getTime() });
    expect(early.createdAt! - late.createdAt!).toBe(60_000);
    expect(kinds(buildMediaRuns([late, early], []))).toEqual(["single", "single"]);
  });

  it("groups a video and a still sent together", () => {
    const still = photo({ createdAt: AT });
    const clip = video({ createdAt: AT });
    const runs = buildMediaRuns([still, clip], [attachment(still.id)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("group");
    expect(ids(runs[0]!)).toEqual([still.id, clip.id]);
    expect(runs[0]!.messages[1]!.body).toBe(clip.body);
  });

  it("keeps each caption attached to its own item instead of suppressing bodies", () => {
    const first = photo({ body: "first caption" });
    const second = photo({ body: "second caption" });
    const runs = buildMediaRuns([first, second], []);
    expect(runs[0]!.kind).toBe("group");
    expect(runs[0]!.messages.map((entry) => entry.body)).toEqual(["first caption", "second caption"]);
    expect(runs[0]!.messages[0]).toBe(first);
    expect(runs[0]!.messages[1]).toBe(second);
  });

  it("groups pending, failed and evicted photos without filtering them away", () => {
    const queued = photo();
    const failed = photo();
    const evicted = photo();
    const withoutRecord = photo();
    const media = [
      attachment(queued.id, { state: "QUEUED" }),
      attachment(failed.id, { state: "FAILED" }),
      attachment(evicted.id, { state: "EVICTED" }),
    ];
    const runs = buildMediaRuns([queued, failed, evicted, withoutRecord], media);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("group");
    expect(runs[0]!.messages).toHaveLength(4);
  });

  it("collapses to a single when one member of a two-item run is deleted", () => {
    const first = photo();
    const second = photo();
    expect(buildMediaRuns([first, second], [])[0]!.kind).toBe("group");
    const collapsed = buildMediaRuns([first], []);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.kind).toBe("single");
    expect(collapsed[0]!.key).toBe(`single:${first.id}`);
  });

  it("splits a chain after a deleted middle item when the remaining gap exceeds 60 seconds", () => {
    const first = photo({ createdAt: AT });
    const middle = photo({ createdAt: AT + 30_000 });
    const last = photo({ createdAt: AT + 61_000 });
    expect(buildMediaRuns([first, middle, last], [])[0]!.kind).toBe("group");
    expect(kinds(buildMediaRuns([first, last], []))).toEqual(["single", "single"]);
  });

  it("does not treat voice, documents, audio, GIFs or file-lane images as groupable media", () => {
    const voice = message({ messageType: "VOICE" });
    const voiceAttachment = attachment(voice.id, {
      mime: "audio/webm", width: 1, height: 1, durationMs: 1500,
    });
    const pdf = text({
      body: chatFileBody({
        key: `files/${AUTHOR}/${CONVERSATION}/doc.pdf`,
        name: "doc.pdf",
        mime: "application/pdf",
        byteSize: 10,
        kind: "pdf",
      }),
    });
    const audio = text({
      body: chatFileBody({
        key: `files/${AUTHOR}/${CONVERSATION}/song.mp3`,
        name: "song.mp3",
        mime: "audio/mpeg",
        byteSize: 10,
        kind: "audio",
      }),
    });
    const gif = text({ body: "https://klipy.example/gif/abc.gif" });
    const sticker = text({ body: "https://klipy.example/sticker/abc.webp" });
    const fileImage = text({
      body: chatFileBody({
        key: `files/${AUTHOR}/${CONVERSATION}/photo.png`,
        name: "photo.png",
        mime: "image/png",
        byteSize: 10,
        kind: "document",
      }),
    });
    const runs = buildMediaRuns([voice, pdf, audio, gif, sticker, fileImage], [voiceAttachment]);
    expect(runs).toHaveLength(6);
    expect(kinds(runs)).toEqual(["single", "single", "single", "single", "single", "single"]);
  });

  it("keeps the group key stable when a later item joins", () => {
    const first = photo();
    const second = photo();
    const third = photo();
    const two = buildMediaRuns([first, second], []);
    const three = buildMediaRuns([first, second, third], []);
    expect(two[0]!.key).toBe(three[0]!.key);
  });

  it("preserves input order and returns the stored message objects unchanged", () => {
    const first = photo({ createdAt: AT + 1_000 });
    const middle = text({ createdAt: AT });
    const last = video({ createdAt: AT + 2_000 });
    const runs = buildMediaRuns([first, middle, last], []);
    expect(runs.map((run) => run.messages[0]!.id)).toEqual([first.id, middle.id, last.id]);
    expect(runs[0]!.messages[0]).toBe(first);
    expect(runs[1]!.messages[0]).toBe(middle);
    expect(runs[2]!.messages[0]).toBe(last);
    expect(runs[2]!.messages[0]!.createdAt).toBe(AT + 2_000);
    expect(runs[2]!.messages[0]!.body).toBe(last.body);
  });
});

describe("small media runs stay separate", () => {
  it("expands a two-item group into two singles in order", () => {
    const first = photo();
    const second = photo({ createdAt: AT + 1_000 });
    const runs = buildMediaRuns([first, second], []);
    expect(runs[0]!.kind).toBe("group");
    const display = splitSmallMediaRuns(runs);
    // WhatsApp Desktop keeps three nearby photos as three messages, so an album
    // needs at least four items and a pair is two
    // ordinary rows. The transcript objects themselves never change.
    expect(kinds(display)).toEqual(["single", "single"]);
    expect(display[0]!.key).toBe(`single:${first.id}`);
    expect(display[1]!.key).toBe(`single:${second.id}`);
    expect(display[0]!.messages[0]).toBe(first);
    expect(display[1]!.messages[0]).toBe(second);
  });

  it("expands a three-item group into three singles in order", () => {
    const first = photo();
    const second = photo({ createdAt: AT + 1_000 });
    const third = photo({ createdAt: AT + 2_000 });
    const display = splitSmallMediaRuns(buildMediaRuns([first, second, third], []));
    expect(kinds(display)).toEqual(["single", "single", "single"]);
    expect(display.map((run) => run.messages[0]!.id)).toEqual([first.id, second.id, third.id]);
    expect(display.every((run) => run.messages.length === 1)).toBe(true);
  });

  it("leaves a four-item group intact", () => {
    const shots = Array.from({ length: 4 }, (_, index) => photo({ createdAt: AT + index * 1_000 }));
    const runs = buildMediaRuns(shots, []);
    expect(runs).toHaveLength(1);
    const display = splitSmallMediaRuns(runs);
    expect(display).toHaveLength(1);
    // Four items are the album threshold: the very same run passes through.
    expect(display[0]).toBe(runs[0]);
    expect(display[0]!.kind).toBe("group");
    expect(display[0]!.messages).toHaveLength(4);
  });

  it("keeps a lone single a single", () => {
    const unsent = photo({ unsentAt: AT + 1 });
    const runs = buildMediaRuns([unsent], []);
    expect(runs[0]!.kind).toBe("single");
    const display = splitSmallMediaRuns(runs);
    expect(display).toHaveLength(1);
    expect(display[0]).toBe(runs[0]);
  });

  it("keeps surrounding runs in order while expanding only the small ones", () => {
    const pair = [photo(), photo({ createdAt: AT + 1_000 })];
    const middle = text({ createdAt: AT + 2_000 });
    const four = Array.from({ length: 4 }, (_, index) => photo({ createdAt: AT + 3_000 + index * 1_000 }));
    const runs = buildMediaRuns([...pair, middle, ...four], []);
    expect(kinds(runs)).toEqual(["group", "single", "group"]);
    const display = splitSmallMediaRuns(runs);
    expect(kinds(display)).toEqual(["single", "single", "single", "group"]);
    expect(display[3]).toBe(runs[2]);
  });
});
