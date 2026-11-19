package com.findback.app.media;

import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure ownership and request-cache model for keyboard/provider insertions.
 *
 * Two independent facts, deliberately kept apart:
 *
 * 1. Ownership. One live owner (account + conversation + monotonic generation)
 *    authorizes NEW arrivals and final publication. A generation change is the
 *    single invalidation primitive for new work.
 * 2. Slot ownership. A committed item reserves a physical slot BEFORE its copy
 *    is queued, and only that worker's own completion releases it: its
 *    {@code finally}, or the refusal path when the task was never queued.
 *    Enable, disable, a route change and a cache clear never free a slot a
 *    queued or running task still holds, so published plus queued plus running
 *    copies can never exceed {@link #MAX_REQUESTS} across any amount of
 *    focus/blur churn, and no grant outlives its slot.
 *
 * Publishing transfers the worker's own slot into the cache entry rather than
 * adding beside it, so an entry is never counted twice and the same bound still
 * holds. A reservation is identity-checked and idempotent: unique tokens mean a
 * late or repeated release is a no-op and can never free another task's slot.
 *
 * The cache never evicts a live request to make room; a newer arrival is
 * refused instead, so an insert JS is still reading cannot be deleted
 * underneath it.
 *
 * No Android types: JVM unit tests exercise the real transitions.
 */
public final class KeyboardMediaState {
    public static final int MAX_REQUESTS = 8;
    /** One bridge string per read: 512 KiB of bytes is ~683 KiB of base64. */
    public static final int MAX_CHUNK_BYTES = 512 * 1024;
    public static final long REQUEST_TTL_MS = 120_000L;
    /** Mirrors the private chat file lane's ceiling. */
    public static final long MAX_ANIMATION_BYTES = 20L * 1024 * 1024;

    private static final KeyboardMediaState SHARED = new KeyboardMediaState();

    /** Process-wide state shared by the WebView receiver and the plugin. */
    public static KeyboardMediaState shared() {
        return SHARED;
    }

    public static final class Owner {
        public final String accountId;
        public final String conversationId;
        public final long generation;

        Owner(String accountId, String conversationId, long generation) {
            this.accountId = accountId;
            this.conversationId = conversationId;
            this.generation = generation;
        }
    }

    public static final class Entry {
        public final String id;
        public final String accountId;
        public final String conversationId;
        public final String mime;
        public final boolean animated;
        public final int width;
        public final int height;
        public final long byteLength;
        public final long createdAt;
        public final long generation;
        public final File file;

        Entry(String id, Owner owner, String mime, boolean animated, int width, int height,
              long byteLength, long createdAt, File file) {
            this.id = id;
            this.accountId = owner.accountId;
            this.conversationId = owner.conversationId;
            this.generation = owner.generation;
            this.mime = mime;
            this.animated = animated;
            this.width = width;
            this.height = height;
            this.byteLength = byteLength;
            this.createdAt = createdAt;
            this.file = file;
        }
    }

    /**
     * One admitted item that has not been published yet: it is either queued or
     * running. Holding the slot before the queue is what keeps queued and
     * running copies inside the same bound as the visible cache.
     */
    public static final class Reservation {
        private final String token;
        private final long generation;

        Reservation(String token, long generation) {
            this.token = token;
            this.generation = generation;
        }
    }

    /** The cache and every admitted slot are full; the new arrival is refused. */
    public static final class TooManyRequests extends Exception {}

    /** No live composer owns this arrival any more. */
    public static final class NotEligible extends Exception {}

    private Owner owner;
    private long generation;
    private final Map<String, Entry> live = new LinkedHashMap<>();
    /** Physical slots held by queued or running workers; never cleared by ownership. */
    private final Map<String, Long> reserved = new LinkedHashMap<>();
    private long reservationSequence;

    public synchronized Owner enable(String accountId, String conversationId) {
        if (accountId == null || conversationId == null) throw new IllegalArgumentException("Owner required");
        generation += 1;
        owner = new Owner(accountId, conversationId, generation);
        // Slots are NOT touched: queued and running copies keep their grants
        // until their own worker finishes, which is the only thing that may
        // free them. New work is authorized by the new generation.
        return owner;
    }

    public synchronized void disable() {
        generation += 1;
        owner = null;
        // Same rule as enable: a withdrawn owner stops new arrivals, it never
        // frees a slot a provider read may still be using.
    }

    public synchronized Owner owner() {
        return owner;
    }

    public synchronized boolean eligible() {
        return owner != null;
    }

    public synchronized int size() {
        return live.size();
    }

    /** Physical slots currently held by queued or running workers. */
    public synchronized int reservationCount() {
        return reserved.size();
    }

    /** True only for the exact owner generation captured before an async step. */
    public synchronized boolean current(Owner expected) {
        return owner != null && expected != null && owner.generation == expected.generation;
    }

    /**
     * Admit one committed item before its copy is queued. The bound counts
     * published entries and admitted-but-unpublished slots together, so a burst
     * of insertions can never build an unbounded executor queue.
     */
    public synchronized Reservation reserve(Owner expected) throws NotEligible, TooManyRequests {
        if (!current(expected)) throw new NotEligible();
        if (live.size() + reserved.size() >= MAX_REQUESTS) throw new TooManyRequests();
        reservationSequence += 1;
        String token = "slot-" + reservationSequence;
        reserved.put(token, expected.generation);
        return new Reservation(token, expected.generation);
    }

    /**
     * Release one admitted slot. Called exactly once by the worker that owns
     * it, and never by an ownership or cache transition, so a slot outlives the
     * generation that created it. Exact-once by token: a second release, or a
     * release of a slot that was already transferred into the cache, is a
     * no-op and can never free a different task's slot.
     */
    public synchronized boolean release(Reservation reservation) {
        if (!owns(reservation)) return false;
        reserved.remove(reservation.token);
        return true;
    }

    private boolean owns(Reservation reservation) {
        if (reservation == null) return false;
        Long slotGeneration = reserved.get(reservation.token);
        return slotGeneration != null && slotGeneration.longValue() == reservation.generation;
    }

    /**
     * Remove and return expired entries so the caller can delete only their own
     * files. Never touches a non-expired request or a physical slot.
     */
    public synchronized List<Entry> sweep(long now) {
        List<Entry> gone = new ArrayList<>();
        Iterator<Map.Entry<String, Entry>> iterator = live.entrySet().iterator();
        while (iterator.hasNext()) {
            Entry entry = iterator.next().getValue();
            long age = now - entry.createdAt;
            if (age < 0 || age > REQUEST_TTL_MS) {
                gone.add(entry);
                iterator.remove();
            }
        }
        return gone;
    }

    /**
     * Add a completed cache file without a physical slot claim. The combined
     * bound still applies, so this can never overlap a running worker's slot.
     * Used by tests and by any caller that already holds no queue entry.
     */
    public synchronized Entry add(String id, Owner expected, File file, boolean animated, String mime,
                                  int width, int height, long byteLength, long now)
            throws TooManyRequests, NotEligible {
        if (!current(expected)) throw new NotEligible();
        if (live.size() + reserved.size() >= MAX_REQUESTS) throw new TooManyRequests();
        Entry entry = build(id, expected, file, animated, mime, width, height, byteLength, now);
        live.put(id, entry);
        return entry;
    }

    /**
     * Publish a completed cache file by transferring the worker's own slot into
     * the entry, in one atomic step. Nothing is counted twice, no other task's
     * slot can be consumed, and a token that was already used cannot publish a
     * second request. The owner is re-checked here, so a worker finishing after
     * a route change can never publish into the new conversation.
     */
    public synchronized Entry add(String id, Owner expected, Reservation reservation, File file, boolean animated,
                                  String mime, int width, int height, long byteLength, long now)
            throws TooManyRequests, NotEligible {
        if (!current(expected)) throw new NotEligible();
        if (!owns(reservation)) throw new NotEligible();
        // The bound already holds because this slot is part of it; the check is
        // a guard only, and it never consumes the token.
        if (live.size() >= MAX_REQUESTS) throw new TooManyRequests();
        Entry entry = build(id, expected, file, animated, mime, width, height, byteLength, now);
        reserved.remove(reservation.token);
        live.put(id, entry);
        return entry;
    }

    private Entry build(String id, Owner expected, File file, boolean animated, String mime,
                        int width, int height, long byteLength, long now) {
        if (id == null || file == null || !file.isFile() || file.length() != byteLength || byteLength <= 0) {
            throw new IllegalArgumentException("Invalid request entry");
        }
        return new Entry(id, expected, mime, animated, width, height, byteLength, now, file);
    }

    public synchronized Entry find(String id) {
        return id == null ? null : live.get(id);
    }

    /** Authorized for reading by the current owner only. */
    public synchronized boolean authorized(Entry entry) {
        return owner != null && entry != null && entry.generation == owner.generation;
    }

    public synchronized Entry remove(String id) {
        return id == null ? null : live.remove(id);
    }

    /**
     * Remove every published request; the caller deletes the returned entries'
     * files. Physical slots stay with their workers, so clearing the cache can
     * never free a slot a queued or running copy still holds.
     */
    public synchronized List<Entry> clear() {
        List<Entry> all = new ArrayList<>(live.values());
        live.clear();
        return all;
    }
}
