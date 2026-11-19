package com.findback.app.media;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * All-or-nothing cache writes for keyboard insertions.
 *
 * The target file belongs to the caller from the moment the copy starts: every
 * failure path deletes whatever partial bytes exist, so a provider read that
 * throws or a source over the file-lane cap can never leave a partial .bin
 * behind that no request id names.
 *
 * Pure {@code java.io}; the JVM tests drive the real overflow and failure
 * paths with plain streams.
 */
final class KeyboardMediaFiles {
    private KeyboardMediaFiles() {}

    /**
     * Copy at most {@code maximum} bytes into {@code target}.
     *
     * @return the number of bytes written
     * @throws IOException when the source fails or the cap is crossed; the
     *         target is deleted before the exception leaves this method
     */
    static long store(InputStream source, File target, long maximum) throws IOException {
        long total = 0;
        try (OutputStream output = new FileOutputStream(target)) {
            byte[] chunk = new byte[16384];
            int read;
            while ((read = source.read(chunk)) != -1) {
                total += read;
                if (total > maximum) throw new IOException("Keyboard media over the file-lane limit");
                output.write(chunk, 0, read);
            }
        } catch (IOException | RuntimeException failure) {
            try {
                target.delete();
            } catch (RuntimeException ignored) {
                // A cache cleanup that fails cannot make the copy succeed.
            }
            throw failure;
        }
        return total;
    }
}
