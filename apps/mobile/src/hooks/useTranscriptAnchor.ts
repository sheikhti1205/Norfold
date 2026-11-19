import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";

/**
 * How close to the newest message still counts as following. A reader inside
 * this band keeps the end pinned, but only their own downward move re-enters
 * it: a relayout that merely leaves them near the end is not a request to
 * follow, and a reader above the band owns their position.
 */
export const FOLLOW_PX = 32;
/** Distance from the end at which the floating latest control appears. */
export const JUMP_PX = 400;

interface TranscriptAnchorPoint {
  /** The message row the reader was looking at. */
  id: string;
  /** That row's top relative to the scroll area's top edge. */
  offset: number;
}

function transcriptDistance(area: HTMLElement) {
  return area.scrollHeight - area.scrollTop - area.clientHeight;
}

/**
 * The first message row in document order that satisfies `match`. A message row
 * is either the list's own child (a lone message) or one of the rows inside a
 * run that holds several messages as one album. Day chips share the list and
 * carry no `data-chat-message`, so they are skipped. The indexed walk allocates
 * nothing: this runs on every scroll frame and on every resize settle of a long
 * thread.
 */
function findTranscriptRow(area: HTMLElement, match: (row: HTMLElement) => boolean) {
  const list = area.querySelector<HTMLElement>(".fb-chat-transcript");
  if (!list) return null;
  for (let index = 0; index < list.children.length; index += 1) {
    const child = list.children[index];
    if (!(child instanceof HTMLElement)) continue;
    if (child.dataset.chatMessage) {
      if (match(child)) return child;
      continue;
    }
    // A run's own rows are its direct children, so one level down reaches every
    // message in the album without a per-frame query or an extra allocation.
    const members = child.children;
    for (let member = 0; member < members.length; member += 1) {
      const row = members[member];
      if (row instanceof HTMLElement && row.dataset.chatMessage && match(row)) return row;
    }
  }
  return null;
}

/**
 * The first row whose box still reaches into the viewport. A row that scrolled
 * fully past is no longer the reading point; one taller than the viewport
 * still is.
 */
function captureTranscriptAnchor(area: HTMLElement, anchor: RefObject<TranscriptAnchorPoint | null>) {
  const top = area.getBoundingClientRect().top;
  const first = findTranscriptRow(area, (row) => row.getBoundingClientRect().bottom > top);
  const id = first?.dataset.chatMessage;
  anchor.current = first && id
    ? { id, offset: first.getBoundingClientRect().top - top }
    : null;
}

/**
 * Put the saved row back where the reader had it. The correction is a
 * scrollTop delta, so growth or shrink anywhere above the row is absorbed
 * without an absolute offset guess. Re-capture after the move so a clamped edge
 * or a resized anchor row becomes the next baseline.
 */
function restoreTranscriptAnchor(area: HTMLElement, following: RefObject<boolean>,
  anchor: RefObject<TranscriptAnchorPoint | null>) {
  const saved = following.current ? null : anchor.current;
  if (following.current) {
    // A reader who is following the conversation never keeps a saved row: the
    // newest message is the position, however tall the thread grows.
    area.scrollTop = area.scrollHeight;
    anchor.current = null;
  } else if (saved) {
    const row = findTranscriptRow(area, (candidate) => candidate.dataset.chatMessage === saved.id);
    if (row) {
      const delta = row.getBoundingClientRect().top - area.getBoundingClientRect().top - saved.offset;
      if (delta) area.scrollTop += delta;
    } else {
      // The saved row left the thread (unsent, deleted). Keep the reader where
      // they are rather than guessing a new position.
      anchor.current = null;
    }
  }
  captureTranscriptAnchor(area, anchor);
  return transcriptDistance(area);
}

export interface TranscriptFollow {
  /** TRUE while the newest message should stay in view. An upward scroll
   *  revokes it until the reader returns to the end or asks for latest. */
  following: RefObject<boolean>;
  /** Stop following and forget the saved reading point (an explicit jump). */
  suspend: () => void;
  /** Follow the newest message again (a send or the floating control). */
  followLatest: () => void;
}

/**
 * Intent-owned scroll for the message transcript.
 *
 * Follow is a latch, not a measurement taken after new content has already
 * moved the page. A new message, an async photo reflow, a viewport or composer
 * resize and a return to a visible tab all restore the message the reader was
 * looking at; only a reader already following the end is moved to the newest
 * message. The token is a message id plus its distance from the scroll area's
 * top, so it survives DOM rebuilds that keep the row.
 *
 * One owner deliberately covers React commits, ResizeObserver, image loads and
 * visibility: independent followers would undo each other and could restore a
 * previous conversation's position after a switch.
 */
export function useTranscriptAnchor({ container, conversationKey, messageIds, enabled, onDistance }: {
  container: RefObject<HTMLDivElement | null>;
  conversationKey: string;
  messageIds: readonly string[];
  enabled: boolean;
  onDistance?: (distance: number) => void;
}): TranscriptFollow {
  const following = useRef(true);
  const anchor = useRef<TranscriptAnchorPoint | null>(null);
  const distanceListener = useRef(onDistance);
  distanceListener.current = onDistance;
  const session = useRef(conversationKey);
  // Our own scroll writes are not reader intent. The baseline follows every
  // write, so the browser's later scroll event for that write reads as zero
  // movement instead of masking the reader's next real move.
  const lastScrollTop = useRef(0);
  const idsKey = useMemo(() => messageIds.join("\u0000"), [messageIds]);

  const suspend = useCallback(() => {
    following.current = false;
    anchor.current = null;
  }, []);
  const followLatest = useCallback(() => {
    following.current = true;
    anchor.current = null;
  }, []);

  /**
   * Fold a position change that has not arrived as a scroll event into the
   * follow latch. `captureOnMove` is true for a change the reader caused; a
   * browser clamp (content shrinking under the viewport) is not a gesture, so
   * it never revokes follow.
   *
   * Distance alone never re-latches. A decoded photo or a removed message can
   * bring a reader inside the band while they sit still, and that relayout is
   * not an instruction to follow; only their own downward move inside the band
   * restores it, and their own upward move above the band revokes it. A move
   * inside the band is either a browser clamp (which always lands at distance
   * 0) or a few-pixel nudge, so it never rebases the saved row: a shrink's
   * correction still measures from the reader's pre-relayout row.
   */
  const readScrollIntent = useCallback((captureOnMove: boolean) => {
    const area = container.current;
    if (!area) return 0;
    const top = area.scrollTop;
    const movement = top - lastScrollTop.current;
    lastScrollTop.current = top;
    const distance = transcriptDistance(area);
    if (distance < FOLLOW_PX) {
      if (movement > 0) following.current = true;
    } else if (movement < 0) {
      following.current = false;
    }
    if (following.current) anchor.current = null;
    else if (captureOnMove && movement !== 0 && distance >= FOLLOW_PX) {
      captureTranscriptAnchor(area, anchor);
    }
    return distance;
  }, [container]);

  /**
   * Restore the reader's point, then adopt the resulting position as the
   * baseline so our own write cannot be mistaken for a reader gesture.
   */
  const restore = useCallback(() => {
    const area = container.current;
    if (!area) return 0;
    const distance = restoreTranscriptAnchor(area, following, anchor);
    lastScrollTop.current = area.scrollTop;
    return distance;
  }, [container]);

  // Scroll carries the reader's own gesture, but clamps and the hook's own
  // programmatic writes arrive here too. Comparing against the adopted baseline
  // is what separates a real upward move from an echo of our last write.
  useEffect(() => {
    const area = container.current;
    if (!area || !enabled) return;
    lastScrollTop.current = area.scrollTop;
    const onScroll = () => {
      distanceListener.current?.(readScrollIntent(true));
    };
    const onResume = () => {
      if (document.visibilityState !== "visible") return;
      distanceListener.current?.(restore());
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("resize", onResume);
    return () => {
      area.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("resize", onResume);
    };
  }, [container, conversationKey, enabled, readScrollIntent, restore]);

  // Media decodes, late bytes and width changes happen without a message
  // commit. Observe the viewport and the list itself, and coalesce a burst into
  // one frame so a batch of decoded photos restores once.
  useLayoutEffect(() => {
    const area = container.current;
    if (!area || !enabled) return;
    let frame = 0;
    const settle = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // The reader may have moved after this frame was queued but before the
        // browser delivered their scroll event. Fold that movement in first, so
        // a pending restore or pin obeys the newer intent instead of undoing it.
        readScrollIntent(true);
        distanceListener.current?.(restore());
      });
    };
    // A decoded image changes height before any resize; its captured load is
    // the last DOM signal before the box settles. It stays attached when the
    // runtime has no ResizeObserver, where it is the only async reflow signal.
    area.addEventListener("load", settle, true);
    const Observer = typeof ResizeObserver === "function" ? ResizeObserver : null;
    const observer = Observer ? new Observer(settle) : null;
    observer?.observe(area);
    const list = area.querySelector(".fb-chat-transcript");
    if (observer && list) observer.observe(list);
    return () => {
      observer?.disconnect();
      area.removeEventListener("load", settle, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [container, conversationKey, enabled, readScrollIntent, restore]);

  // Committed messages and the first loaded transcript are layout changes too.
  // A conversation switch resets the latch so the previous thread's row can
  // never be restored into this one.
  useLayoutEffect(() => {
    const area = container.current;
    const switched = session.current !== conversationKey;
    if (switched) {
      session.current = conversationKey;
      following.current = true;
      anchor.current = null;
      // Adopt the box's actual position instead of assuming zero: a reused
      // scroll area can still sit at the previous thread's offset, and that
      // difference must not be read as the reader's first move.
      if (area) lastScrollTop.current = area.scrollTop;
    }
    if (!area || !enabled) return;
    // A commit can land between the reader's move and its delivered scroll
    // event. Reading the position here lets that gesture win over new content.
    if (!switched) readScrollIntent(true);
    distanceListener.current?.(restore());
  }, [idsKey, enabled, conversationKey, container, readScrollIntent, restore]);

  return { following, suspend, followLatest };
}
