package com.findback.app.media;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import org.junit.Test;

/**
 * The keyboard cache write is all-or-nothing. The reported case is a copy
 * that fails after the target file already exists: the bytes are refused and
 * the named-but-unpublished file must be gone, never left behind in cache.
 */
public class KeyboardMediaFilesTest {
    private static File target() throws Exception {
        File file = File.createTempFile("keyboard-store", ".bin");
        assertTrue(file.delete());
        return file;
    }

    @Test public void storesExactlyWhatTheSourceDelivers() throws Exception {
        File file = target();
        long written = KeyboardMediaFiles.store(new ByteArrayInputStream(new byte[] { 1, 2, 3, 4, 5 }), file, 5);
        assertEquals(5, written);
        assertTrue(file.isFile());
        assertEquals(5, file.length());
        assertArrayEquals(new byte[] { 1, 2, 3, 4, 5 }, Files.readAllBytes(file.toPath()));
        assertTrue(file.delete());
    }

    @Test public void anOverflowingSourceLeavesNoPartialFile() throws Exception {
        File file = target();
        try {
            KeyboardMediaFiles.store(new ByteArrayInputStream(new byte[] { 1, 2, 3, 4, 5 }), file, 3);
            fail("the cap must refuse the copy");
        } catch (IOException refused) {
            assertFalse("no partial target survives a refusal", file.exists());
        }
    }

    @Test public void aSourceThatFailsMidReadLeavesNoPartialFile() throws Exception {
        File file = target();
        InputStream failing = new InputStream() {
            private int served;
            @Override public int read() throws IOException {
                if (served < 4) return served++;
                throw new IOException("provider dropped the stream");
            }
            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                if (served >= 4) throw new IOException("provider dropped the stream");
                int count = Math.min(length, 4 - served);
                for (int index = 0; index < count; index += 1) buffer[offset + index] = (byte) (served + index);
                served += count;
                return count;
            }
        };
        try {
            KeyboardMediaFiles.store(failing, file, KeyboardMediaState.MAX_ANIMATION_BYTES);
            fail("a failed read must refuse the copy");
        } catch (IOException refused) {
            assertFalse("no partial target survives a failed read", file.exists());
        }
    }

    @Test public void aTargetThatCannotBeOpenedIsNotReportedAsWritten() throws Exception {
        File directory = Files.createTempDirectory("keyboard-store-dir").toFile();
        File nested = new File(directory, "missing/parent/file.bin");
        try {
            KeyboardMediaFiles.store(new ByteArrayInputStream(new byte[] { 1 }), nested, 8);
            fail("an unopenable target must refuse the copy");
        } catch (IOException refused) {
            assertFalse(nested.exists());
        } finally {
            assertTrue(directory.delete());
        }
    }
}
