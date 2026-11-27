package com.findback.app.needle

/**
 * Load-time memory admission for the retained Needle engine.
 *
 * The pinned needle3 `.cact` file is mapped into a resident tensor set and
 * read through a transient buffer while loading, so admitting a load needs
 * more than the file size. The decision is made from live
 * `ActivityManager.MemoryInfo` facts — `availMem`, the system's own
 * `threshold` (where the OS starts killing processes) and `lowMemory` —
 * never from total RAM and never from the web's `deviceMemory` estimate.
 *
 * Conservative on purpose: three file-sized copies (resident tensors, the
 * loader's read buffer and promotion slack) plus a fixed floor above the
 * system threshold. A refusal here is recoverable — the person may retry when
 * the device is calmer — so a false "not now" costs a retry, while a false
 * "yes" can let the OS evict the app mid-load.
 *
 * Pure and side-effect free so the decision is unit-testable without a device;
 * [FindbackNeedle] owns the actual `MemoryInfo` read.
 */
internal object NeedleMemoryPolicy {

    /** Fixed breathing room on top of the weight copies: 192 MiB. */
    const val HEADROOM_BYTES: Long = 192L * 1024L * 1024L

    /**
     * Copies of the weights that can be live at once while the engine loads:
     * the resident tensor set, the loader's own read buffer, and slack for the
     * promotion/mapping step.
     */
    private const val WEIGHT_COPIES: Long = 3L

    /** Bytes that must be free above the system's own low-memory threshold. */
    fun requiredBytes(modelBytes: Long): Long {
        val weights = if (modelBytes > 0L) saturatingMultiply(modelBytes, WEIGHT_COPIES) else 0L
        return saturatingAdd(HEADROOM_BYTES, weights)
    }

    /**
     * Whether the engine may load with these facts. Refuses the system's own
     * low-memory flag, unreadable/non-positive availability, availability at or
     * below the OS threshold, and anything short of [requiredBytes] above that
     * threshold.
     */
    fun canLoad(availMemBytes: Long, thresholdBytes: Long, lowMemory: Boolean, modelBytes: Long): Boolean {
        if (lowMemory) return false
        if (availMemBytes <= 0L) return false
        if (availMemBytes <= thresholdBytes) return false
        return saturatingAdd(thresholdBytes, requiredBytes(modelBytes)) <= availMemBytes
    }

    private fun saturatingAdd(left: Long, right: Long): Long {
        val sum = left + right
        return if (sum < 0L) Long.MAX_VALUE else sum
    }

    private fun saturatingMultiply(value: Long, factor: Long): Long {
        if (value <= 0L) return 0L
        if (value > Long.MAX_VALUE / factor) return Long.MAX_VALUE
        return value * factor
    }
}
