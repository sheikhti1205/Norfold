package com.findback.app.media;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * Ownership and cache transitions for keyboard insertions. The model is pure
 * Java, so these are the real rules the plugin worker relies on: a generation
 * change invalidates every older capture, and a full cache refuses a NEW
 * arrival instead of deleting a request a reader may still be pulling.
 *
 * The admission slot is physical, not per generation: a committed item reserves
 * its place before its copy is queued, and only that worker's own completion
 * releases it. Enable, disable, a route change and a cache clear stop new work
 * but never free a slot a provider read may still be using, so published plus
 * queued plus running copies share one bound across any amount of churn.
 */
public class KeyboardMediaStateTest {
    private static File media(byte[] bytes) throws Exception {
        File file = File.createTempFile("keyboard-media", ".bin");
        Files.write(file.toPath(), bytes);
        return file;
    }

    private static void discard(File file) {
        assertTrue(file.delete());
    }

    @Test public void ownerGenerationIsTheSingleInvalidationPrimitive() {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner first = state.enable("account", "chat");
        assertTrue(state.eligible());
        assertTrue(state.current(first));
        KeyboardMediaState.Owner second = state.enable("account", "other");
        assertNotEquals(first.generation, second.generation);
        assertFalse(state.current(first));
        assertTrue(state.current(second));
        state.disable();
        assertFalse(state.eligible());
        assertFalse(state.current(second));
    }

    @Test public void addRechecksTheOwnerCapturedBeforeTheCopy() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner captured = state.enable("account", "chat");
        state.enable("account", "elsewhere");
        File file = media(new byte[] { 1, 2, 3 });
        try {
            assertThrows(KeyboardMediaState.NotEligible.class,
                    () -> state.add("request", captured, file, false, "image/jpeg", 1, 1, 3, 0));
            assertEquals(0, state.size());
        } finally {
            discard(file);
        }
    }

    @Test public void fullCacheRefusesTheNewArrivalAndNeverEvictsALiveOne() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3, 4, 5 });
        try {
            for (int index = 0; index < KeyboardMediaState.MAX_REQUESTS; index += 1) {
                assertNotNull(state.add("request-" + index, owner, file, true, "image/gif", 1, 1, 5, index));
            }
            assertThrows(KeyboardMediaState.TooManyRequests.class,
                    () -> state.add("one-too-many", owner, file, true, "image/gif", 1, 1, 5, 100));
            assertEquals(KeyboardMediaState.MAX_REQUESTS, state.size());
            assertNotNull("the oldest in-flight request survives a refusal", state.find("request-0"));
        } finally {
            discard(file);
        }
    }

    /**
     * The reported burst: the first copy is still running (its slot held),
     * seven more are admitted, and every further arrival is refused rather than
     * queued. Published plus admitted is the only number that matters.
     */
    @Test public void burstWhileTheFirstCopyIsBlockedStaysInsideTheBound() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        List<KeyboardMediaState.Reservation> held = new ArrayList<>();
        held.add(state.reserve(owner));
        int admitted = 1;
        for (int attempt = 0; attempt < 50; attempt += 1) {
            try {
                held.add(state.reserve(owner));
                admitted += 1;
            } catch (KeyboardMediaState.TooManyRequests refused) {
                // Expected once the bound is reached; the loop must stay stable.
            }
        }
        assertEquals(KeyboardMediaState.MAX_REQUESTS, admitted);
        assertEquals(KeyboardMediaState.MAX_REQUESTS, state.reservationCount());
        assertEquals(0, state.size());

        // One slot freed by a finishing worker reopens exactly one arrival.
        assertTrue(state.release(held.remove(0)));
        assertNotNull(state.reserve(owner));
        assertEquals(KeyboardMediaState.MAX_REQUESTS, state.reservationCount());
        assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(owner));
    }

    /**
     * The churn hole: freeing slots on a generation change would let a burst
     * retain provider grants and queue entries while old workers still read.
     * Eight queued copies keep the bound through focus/blur, a route change and
     * a cache clear, and only their own releases reopen it.
     */
    @Test public void churnNeverFreesASlotAQueuedCopyStillHolds() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner first = state.enable("account", "chat");
        List<KeyboardMediaState.Reservation> held = new ArrayList<>();
        for (int index = 0; index < KeyboardMediaState.MAX_REQUESTS; index += 1) {
            held.add(state.reserve(first));
        }
        state.disable();
        state.enable("account", "chat");
        state.enable("account", "other");
        state.clear();
        KeyboardMediaState.Owner current = state.owner();
        assertNotNull(current);
        assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(current));
        assertEquals(KeyboardMediaState.MAX_REQUESTS, state.reservationCount());

        for (KeyboardMediaState.Reservation reservation : held) {
            assertTrue(state.release(reservation));
        }
        assertEquals(0, state.reservationCount());
        assertNotNull(state.reserve(current));
    }

    /** A published entry and an unpublished slot share the same ceiling. */
    @Test public void publishedAndQueuedCopiesShareOneCeiling() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3 });
        try {
            state.add("published", owner, file, true, "image/gif", 1, 1, 3, 0);
            for (int index = 1; index < KeyboardMediaState.MAX_REQUESTS; index += 1) {
                state.reserve(owner);
            }
            assertEquals(7, state.reservationCount());
            assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(owner));
        } finally {
            discard(file);
        }
    }

    /**
     * Publishing consumes the worker's own slot instead of adding beside it, so
     * a full queue can publish all eight entries without ever double counting
     * or exceeding the bound. A transferred token cannot publish twice.
     */
    @Test public void publishingTransfersTheSlotInsteadOfAddingBesideIt() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        List<KeyboardMediaState.Reservation> held = new ArrayList<>();
        for (int index = 0; index < KeyboardMediaState.MAX_REQUESTS; index += 1) {
            held.add(state.reserve(owner));
        }
        File file = media(new byte[] { 1, 2, 3 });
        try {
            KeyboardMediaState.Reservation publishing = held.get(0);
            KeyboardMediaState.Entry entry = state.add("request-0", owner, publishing, file, true,
                    "image/gif", 1, 1, 3, 0);
            assertEquals("request-0", entry.id);
            assertEquals(1, state.size());
            assertEquals(KeyboardMediaState.MAX_REQUESTS - 1, state.reservationCount());
            assertEquals(KeyboardMediaState.MAX_REQUESTS, state.size() + state.reservationCount());
            assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(owner));
            assertFalse("a transferred token releases nothing", state.release(publishing));
            assertThrows("one slot cannot publish a second entry", KeyboardMediaState.NotEligible.class,
                    () -> state.add("request-again", owner, publishing, file, true, "image/gif", 1, 1, 3, 0));
            assertEquals(1, state.size());
            assertEquals(KeyboardMediaState.MAX_REQUESTS - 1, state.reservationCount());
        } finally {
            discard(file);
        }
    }

    /**
     * The publication fence is retained: a worker finishing after a route
     * change is refused and keeps its slot until its own finally releases it.
     */
    @Test public void publishingAfterARouteChangeIsRefusedAndKeepsTheSlotForItsWorker() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner first = state.enable("account", "chat");
        KeyboardMediaState.Reservation stale = state.reserve(first);
        state.enable("account", "other");
        File file = media(new byte[] { 1, 2, 3 });
        try {
            assertThrows(KeyboardMediaState.NotEligible.class, () -> state.add("stale", first, stale, file,
                    true, "image/gif", 1, 1, 3, 1));
            assertEquals(0, state.size());
            assertEquals("the refused worker still owns its slot until finally",
                    1, state.reservationCount());
            assertTrue(state.release(stale));
            assertEquals(0, state.reservationCount());
        } finally {
            discard(file);
        }
    }

    @Test public void releaseIsExactOnceByToken() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        KeyboardMediaState.Reservation reservation = state.reserve(owner);
        assertEquals(1, state.reservationCount());
        assertTrue(state.release(reservation));
        assertEquals(0, state.reservationCount());
        assertFalse("the second release of one slot is a no-op", state.release(reservation));
        assertEquals(0, state.reservationCount());
    }

    /** Two queued copies freed in any order each release exactly one slot. */
    @Test public void eachStaleTaskReleasesItsOwnSlotOnce() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner first = state.enable("account", "chat");
        KeyboardMediaState.Reservation one = state.reserve(first);
        KeyboardMediaState.Reservation two = state.reserve(first);
        state.enable("account", "other");
        assertEquals("both queued copies still own a physical slot", 2, state.reservationCount());
        assertTrue(state.release(one));
        assertEquals(1, state.reservationCount());
        assertFalse("one slot never releases twice", state.release(one));
        assertEquals(1, state.reservationCount());
        assertTrue(state.release(two));
        assertEquals(0, state.reservationCount());
    }

    /**
     * A worker that finishes after a route change frees only its own physical
     * slot. Its token can never touch a newer generation's reservations, and a
     * repeated release cannot underflow the count.
     */
    @Test public void staleReleaseCannotUnderflowANewerGeneration() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner first = state.enable("account", "chat");
        KeyboardMediaState.Reservation stale = state.reserve(first);
        KeyboardMediaState.Owner second = state.enable("account", "other");
        assertEquals("a generation change keeps the queued copy's slot", 1, state.reservationCount());
        assertTrue("the finishing worker frees its own slot", state.release(stale));
        assertEquals(0, state.reservationCount());

        for (int index = 0; index < KeyboardMediaState.MAX_REQUESTS; index += 1) {
            assertNotNull(state.reserve(second));
        }
        assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(second));
        assertFalse("a second release never frees a newer slot", state.release(stale));
        assertEquals(KeyboardMediaState.MAX_REQUESTS, state.reservationCount());
    }

    @Test public void aWithdrawnOwnerAdmitsNothing() {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        state.disable();
        assertThrows(KeyboardMediaState.NotEligible.class, () -> state.reserve(owner));
        assertEquals(0, state.reservationCount());
    }

    /**
     * Clearing the cache deletes published entries only. Slots stay with the
     * queued or running copies that still own a provider grant.
     */
    @Test public void clearingTheCacheKeepsAdmittedSlotsUntilTheirWorkersFinish() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3 });
        try {
            KeyboardMediaState.Reservation queued = state.reserve(owner);
            state.add("one", owner, file, false, "image/jpeg", 1, 1, 3, 0);
            assertEquals(1, state.reservationCount());
            assertEquals(1, state.clear().size());
            assertEquals("the queued copy still owns its slot", 1, state.reservationCount());
            assertEquals(0, state.size());
            assertTrue(state.release(queued));
            assertEquals(0, state.reservationCount());
        } finally {
            discard(file);
        }
    }

    /** Withdrawing the owner never frees a slot a queued copy is still using. */
    @Test public void disablingTheOwnerKeepsQueuedSlotsForThePhysicalBound() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        List<KeyboardMediaState.Reservation> held = new ArrayList<>();
        for (int index = 0; index < KeyboardMediaState.MAX_REQUESTS; index += 1) {
            held.add(state.reserve(owner));
        }
        state.disable();
        assertEquals(KeyboardMediaState.MAX_REQUESTS, state.reservationCount());
        KeyboardMediaState.Owner returned = state.enable("account", "chat");
        assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(returned));
        assertTrue(state.release(held.get(0)));
        assertNotNull("the returned owner gets the one freed slot", state.reserve(returned));
    }

    /** A cache clear alone leaves running copies' slots and grants untouched. */
    @Test public void cacheCleanupAloneNeverFreesInflightSlots() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3 });
        try {
            state.add("published", owner, file, false, "image/jpeg", 1, 1, 3, 0);
            for (int index = 0; index < KeyboardMediaState.MAX_REQUESTS - 1; index += 1) {
                state.reserve(owner);
            }
            assertEquals(1, state.size());
            assertEquals(7, state.reservationCount());
            assertThrows(KeyboardMediaState.TooManyRequests.class, () -> state.reserve(owner));

            assertEquals(1, state.clear().size());
            assertEquals(0, state.size());
            assertEquals("the clear deletes the live entry only", 7, state.reservationCount());
            // Seven physical slots were never freed, so only one arrival fits.
            assertNotNull(state.reserve(owner));
            assertThrows("seven queued copies still fill the bound",
                    KeyboardMediaState.TooManyRequests.class, () -> state.reserve(owner));
        } finally {
            discard(file);
        }
    }

    @Test public void sweepReturnsOnlyExpiredEntriesAndLeavesFreshWorkAlone() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3, 4, 5 });
        try {
            state.add("old", owner, file, true, "image/gif", 1, 1, 5, 0);
            state.add("fresh", owner, file, true, "image/gif", 1, 1, 5, 100);
            assertTrue(state.sweep(KeyboardMediaState.REQUEST_TTL_MS).isEmpty());
            List<KeyboardMediaState.Entry> gone = state.sweep(KeyboardMediaState.REQUEST_TTL_MS + 1);
            assertEquals(1, gone.size());
            assertEquals("old", gone.get(0).id);
            assertEquals(1, state.size());
            assertNotNull(state.find("fresh"));
        } finally {
            discard(file);
        }
    }

    @Test public void authorizationTracksTheCurrentGenerationOnly() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3, 4, 5 });
        try {
            KeyboardMediaState.Entry entry = state.add("request", owner, file, true, "image/gif", 1, 1, 5, 0);
            assertTrue(state.authorized(entry));
            state.enable("account", "chat");
            assertFalse("re-advertising starts a new generation", state.authorized(entry));
        } finally {
            discard(file);
        }
    }

    @Test public void invalidEntriesAreRefusedBeforeTheyReachTheCache() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File missing = new File(System.getProperty("java.io.tmpdir"), "keyboard-media-does-not-exist.bin");
        assertThrows(IllegalArgumentException.class,
                () -> state.add("missing", owner, missing, false, "image/jpeg", 1, 1, 1, 0));
        File file = media(new byte[] { 1, 2, 3 });
        try {
            assertThrows(IllegalArgumentException.class,
                    () -> state.add("mismatch", owner, file, false, "image/jpeg", 1, 1, 9, 0));
            assertThrows(IllegalArgumentException.class,
                    () -> state.add("zero", owner, file, false, "image/jpeg", 1, 1, 0, 0));
            assertEquals(0, state.size());
        } finally {
            discard(file);
        }
    }

    @Test public void clearReturnsEveryEntrySoOnlyItsOwnFilesAreDeleted() throws Exception {
        KeyboardMediaState state = new KeyboardMediaState();
        KeyboardMediaState.Owner owner = state.enable("account", "chat");
        File file = media(new byte[] { 1, 2, 3 });
        try {
            state.add("one", owner, file, false, "image/jpeg", 1, 1, 3, 0);
            state.add("two", owner, file, true, "image/gif", 1, 1, 3, 0);
            List<KeyboardMediaState.Entry> cleared = state.clear();
            assertEquals(2, cleared.size());
            assertEquals(0, state.size());
            assertNull(state.find("one"));
        } finally {
            discard(file);
        }
    }
}
