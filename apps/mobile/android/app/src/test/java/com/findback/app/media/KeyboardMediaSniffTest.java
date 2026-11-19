package com.findback.app.media;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/**
 * Container sniffing for keyboard insertions. The sniff decides the lane before
 * any decode: a GIF/WebP/APNG must stay an animation so its frames and alpha
 * are never flattened into a still, while a truncated prefix is reported as
 * inconclusive instead of guessed.
 */
public class KeyboardMediaSniffTest {
    private static final byte[] PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

    private static byte[] bytes(int... values) {
        byte[] out = new byte[values.length];
        for (int index = 0; index < values.length; index += 1) out[index] = (byte) values[index];
        return out;
    }

    private static byte[] ascii(String text) {
        return text.getBytes(StandardCharsets.US_ASCII);
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) out.write(part, 0, part.length);
        return out.toByteArray();
    }

    private static byte[] u32be(int value) {
        return bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    }

    private static byte[] u32le(int value) {
        return bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    }

    /** PNG chunk with a zero CRC: the sniff never validates checksums. */
    private static byte[] chunk(String type, byte[] data) {
        return concat(u32be(data.length), ascii(type), data, bytes(0, 0, 0, 0));
    }

    private static byte[] ihdr(int width, int height) {
        return chunk("IHDR", concat(u32be(width), u32be(height), bytes(8, 6, 0, 0, 0)));
    }

    @Test public void jpegReportsItsFrameAndStaysAStill() {
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(bytes(
                0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00,
                0xff, 0xd9));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.JPEG, info.kind);
        assertEquals("image/jpeg", info.mime);
        assertFalse(info.animated);
        assertTrue(info.conclusive);
        assertEquals(32, info.width);
        assertEquals(16, info.height);
    }

    @Test public void stillPngIsConclusiveOnceImageDataStarts() {
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(concat(
                PNG_SIGNATURE, ihdr(32, 16), chunk("IDAT", new byte[0]), chunk("IEND", new byte[0])));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.PNG, info.kind);
        assertEquals("image/png", info.mime);
        assertFalse(info.animated);
        assertTrue(info.conclusive);
        assertEquals(32, info.width);
        assertEquals(16, info.height);
    }

    @Test public void apngIsAnAnimationFromItsControlChunk() {
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(concat(
                PNG_SIGNATURE, ihdr(32, 16),
                chunk("acTL", concat(u32be(1), u32be(0))),
                chunk("IDAT", new byte[0]), chunk("IEND", new byte[0])));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.PNG_ANIMATED, info.kind);
        assertEquals("image/png", info.mime);
        assertTrue(info.animated);
        assertTrue(info.conclusive);
    }

    @Test public void everyGifKeepsTheAnimationLaneEvenWithoutFrames() {
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(concat(
                ascii("GIF89a"), bytes(0x20, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0x3b)));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.GIF, info.kind);
        assertEquals("image/gif", info.mime);
        assertTrue(info.animated);
        assertTrue(info.conclusive);
        assertEquals(32, info.width);
        assertEquals(16, info.height);
    }

    @Test public void staticWebpReadsTheVp8KeyframeSize() {
        byte[] vp8 = concat(ascii("VP8 "), u32le(10),
                bytes(0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x20, 0x00, 0x10, 0x00));
        byte[] body = concat(ascii("WEBP"), vp8);
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(concat(ascii("RIFF"), u32le(body.length), body));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.WEBP, info.kind);
        assertEquals("image/webp", info.mime);
        assertFalse(info.animated);
        assertTrue(info.conclusive);
        assertEquals(32, info.width);
        assertEquals(16, info.height);
    }

    @Test public void animatedWebpReportsAnimationFromItsAnimChunk() {
        byte[] vp8x = concat(ascii("VP8X"), u32le(10),
                bytes(0x02, 0, 0, 0, 0x1f, 0, 0, 0x0f, 0, 0));
        byte[] anim = concat(ascii("ANIM"), u32le(6), bytes(0, 0, 0, 0, 0, 0));
        byte[] body = concat(ascii("WEBP"), vp8x, anim);
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(concat(ascii("RIFF"), u32le(body.length), body));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.WEBP_ANIMATED, info.kind);
        assertEquals("image/webp", info.mime);
        assertTrue(info.animated);
        assertTrue(info.conclusive);
        assertEquals(32, info.width);
        assertEquals(16, info.height);
    }

    @Test public void truncatedPrefixIsInconclusiveInsteadOfGuessed() {
        KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(concat(PNG_SIGNATURE, ihdr(32, 16)));
        assertNotNull(info);
        assertEquals(KeyboardMediaSniff.Kind.PNG, info.kind);
        assertFalse("no IDAT/IEND/acTL was reached", info.conclusive);
    }

    @Test public void garbageAndShortInputAreRefused() {
        assertNull(KeyboardMediaSniff.sniff(new byte[8]));
        assertNull(KeyboardMediaSniff.sniff(new byte[20]));
        assertNull(KeyboardMediaSniff.sniff(null));
    }
}
