package com.findback.app.needle

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure-JVM tests for [NeedleMemoryPolicy]. The instrumentation that reads
 * ActivityManager.MemoryInfo is deliberately not exercised here: this suite
 * pins the decision only, so it needs no device or Android runtime.
 */
class NeedleMemoryPolicyTest {

    /** The pinned needle3.cact file size, in bytes. */
    private val modelBytes = 35_335_380L

    @Test
    fun requiredBytesCoversResidentCopiesTransientReadAndHeadroom() {
        // Three file-sized copies (resident tensor set + one transient read)
        // plus the headroom floor.
        assertEquals(
            NeedleMemoryPolicy.HEADROOM_BYTES + modelBytes * 3L,
            NeedleMemoryPolicy.requiredBytes(modelBytes),
        )
        // An unknown/zero file size still leaves the headroom floor.
        assertEquals(NeedleMemoryPolicy.HEADROOM_BYTES, NeedleMemoryPolicy.requiredBytes(0L))
    }

    @Test
    fun refusesTheSystemLowMemoryFlagEvenWithPlentyAvailable() {
        assertFalse(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = 8_000_000_000L,
                thresholdBytes = 100_000_000L,
                lowMemory = true,
                modelBytes = modelBytes,
            ),
        )
    }

    @Test
    fun requiresHeadroomAboveTheSystemsOwnThreshold() {
        val required = NeedleMemoryPolicy.requiredBytes(modelBytes)
        val threshold = 200_000_000L
        // Exactly the requirement is enough; one byte less is not.
        assertTrue(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = threshold + required,
                thresholdBytes = threshold,
                lowMemory = false,
                modelBytes = modelBytes,
            ),
        )
        assertFalse(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = threshold + required - 1L,
                thresholdBytes = threshold,
                lowMemory = false,
                modelBytes = modelBytes,
            ),
        )
    }

    @Test
    fun refusesWhenAvailabilityIsAlreadyAtOrBelowTheThreshold() {
        assertFalse(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = 200_000_000L,
                thresholdBytes = 200_000_000L,
                lowMemory = false,
                modelBytes = modelBytes,
            ),
        )
    }

    @Test
    fun refusesUnreadableOrNonPositiveAvailability() {
        assertFalse(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = 0L,
                thresholdBytes = 0L,
                lowMemory = false,
                modelBytes = modelBytes,
            ),
        )
        assertFalse(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = -1L,
                thresholdBytes = 0L,
                lowMemory = false,
                modelBytes = modelBytes,
            ),
        )
    }

    @Test
    fun saturatedSizingNeverOverflowsIntoAnAcceptingAnswer() {
        // A nonsensically large file must not overflow into a small (or
        // negative) requirement that then looks affordable.
        val required = NeedleMemoryPolicy.requiredBytes(Long.MAX_VALUE)
        assertTrue(required > 0L)
        assertFalse(
            NeedleMemoryPolicy.canLoad(
                availMemBytes = 1_000_000_000L,
                thresholdBytes = 0L,
                lowMemory = false,
                modelBytes = Long.MAX_VALUE,
            ),
        )
    }
}
