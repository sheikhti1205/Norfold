package com.findback.app.media;

import java.nio.charset.StandardCharsets;

/**
 * Bounded structural sniff for keyboard/provider insertions.
 *
 * The container walk decides still vs animation BEFORE any decode, so an
 * animated GIF/WebP/APNG can never be silently flattened into a JPEG still.
 * Any GIF is classified as animation so a single-frame sticker keeps its
 * original bytes and transparency. `conclusive` reports whether the prefix
 * actually reached the deciding chunk; an inconclusive result must be
 * re-sniffed from the copied bytes instead of guessed.
 *
 * Pure Java: JVM tests cover the same bytes the JS strippers consume.
 */
public final class KeyboardMediaSniff {
    public enum Kind { JPEG, PNG, PNG_ANIMATED, GIF, WEBP, WEBP_ANIMATED }

    public static final class Info {
        public final Kind kind;
        public final String mime;
        public final boolean animated;
        public final int width;
        public final int height;
        /** False when the prefix ended before the still/animation chunk. */
        public final boolean conclusive;

        Info(Kind kind, String mime, boolean animated, int width, int height, boolean conclusive) {
            this.kind = kind;
            this.mime = mime;
            this.animated = animated;
            this.width = width;
            this.height = height;
            this.conclusive = conclusive;
        }
    }

    private KeyboardMediaSniff() {}

    public static Info sniff(byte[] p) {
        if (p == null || p.length < 12) return null;
        if ((p[0] & 255) == 0xff && (p[1] & 255) == 0xd8 && (p[2] & 255) == 0xff) {
            int[] size = jpegSize(p);
            return new Info(Kind.JPEG, "image/jpeg", false, size[0], size[1], true);
        }
        if ((p[0] & 255) == 0x89 && p[1] == 'P' && p[2] == 'N' && p[3] == 'G'
                && (p[4] & 255) == 0x0d && (p[5] & 255) == 0x0a && (p[6] & 255) == 0x1a && (p[7] & 255) == 0x0a) {
            int width = (int) u32be(p, 16);
            int height = (int) u32be(p, 20);
            if (width <= 0 || height <= 0) return null;
            Png png = pngAnimation(p);
            return new Info(png.animated ? Kind.PNG_ANIMATED : Kind.PNG, "image/png",
                    png.animated, width, height, png.conclusive);
        }
        String magic = ascii(p, 0, 6);
        if ("GIF87a".equals(magic) || "GIF89a".equals(magic)) {
            int width = u16le(p, 6);
            int height = u16le(p, 8);
            if (width <= 0 || height <= 0) return null;
            // Any GIF keeps the file lane: frame count and alpha are preserved.
            return new Info(Kind.GIF, "image/gif", true, width, height, true);
        }
        if ("RIFF".equals(ascii(p, 0, 4)) && "WEBP".equals(ascii(p, 8, 4))) {
            Webp webp = walkWebp(p);
            if (webp == null || webp.width <= 0 || webp.height <= 0) return null;
            return new Info(webp.animated ? Kind.WEBP_ANIMATED : Kind.WEBP, "image/webp",
                    webp.animated, webp.width, webp.height, webp.conclusive);
        }
        return null;
    }

    private static final class Png {
        final boolean animated;
        final boolean conclusive;

        Png(boolean animated, boolean conclusive) {
            this.animated = animated;
            this.conclusive = conclusive;
        }
    }

    private static Png pngAnimation(byte[] p) {
        int offset = 8;
        for (int guard = 0; guard < 1024; guard += 1) {
            if (offset + 12 > p.length) return new Png(false, false);
            long length = u32be(p, offset);
            String type = ascii(p, offset + 4, 4);
            if (type == null || length < 0 || length > p.length) return new Png(false, false);
            if ("acTL".equals(type)) return new Png(true, true);
            if ("IDAT".equals(type) || "IEND".equals(type)) return new Png(false, true);
            long next = offset + 12L + length;
            if (next > p.length) return new Png(false, false);
            offset = (int) next;
        }
        return new Png(false, false);
    }

    private static final class Webp {
        final int width;
        final int height;
        final boolean animated;
        final boolean conclusive;

        Webp(int width, int height, boolean animated, boolean conclusive) {
            this.width = width;
            this.height = height;
            this.animated = animated;
            this.conclusive = conclusive;
        }
    }

    private static Webp walkWebp(byte[] p) {
        int offset = 12;
        int width = 0;
        int height = 0;
        boolean animated = false;
        boolean sawImage = false;
        for (int guard = 0; guard < 1024; guard += 1) {
            if (offset + 8 > p.length) break;
            String fourcc = ascii(p, offset, 4);
            long size = u32le(p, offset + 4);
            if (fourcc == null || size < 0) return null;
            long data = offset + 8L;
            boolean complete = data + size <= p.length;
            if ("ANIM".equals(fourcc) || "ANMF".equals(fourcc)) animated = true;
            if ("VP8 ".equals(fourcc) || "VP8L".equals(fourcc)) sawImage = true;
            if (complete) {
                int at = (int) data;
                if ("VP8X".equals(fourcc) && size >= 10) {
                    width = 1 + u24le(p, at + 4);
                    height = 1 + u24le(p, at + 7);
                } else if ("VP8 ".equals(fourcc) && size >= 10
                        && (p[at + 3] & 255) == 0x9d && (p[at + 4] & 255) == 0x01 && (p[at + 5] & 255) == 0x2a) {
                    if (width <= 0 || height <= 0) {
                        width = u16le(p, at + 6) & 0x3fff;
                        height = u16le(p, at + 8) & 0x3fff;
                    }
                } else if ("VP8L".equals(fourcc) && size >= 5 && (p[at] & 255) == 0x2f) {
                    int b1 = p[at + 1] & 255;
                    int b2 = p[at + 2] & 255;
                    int b3 = p[at + 3] & 255;
                    int b4 = p[at + 4] & 255;
                    if (width <= 0 || height <= 0) {
                        width = 1 + (((b2 & 0x3f) << 8) | b1);
                        height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
                    }
                }
            }
            if (animated || sawImage) {
                boolean conclusive = width > 0 && height > 0;
                return new Webp(width, height, animated, conclusive);
            }
            if (!complete) return new Webp(width, height, false, false);
            offset = (int) (data + size + (size & 1));
        }
        return width > 0 && height > 0 ? new Webp(width, height, false, false) : null;
    }

    private static int[] jpegSize(byte[] p) {
        int offset = 2;
        for (int guard = 0; guard < 4096 && offset + 4 <= p.length; guard += 1) {
            if ((p[offset] & 255) != 0xff) return new int[] { 0, 0 };
            int marker = p[offset + 1] & 255;
            while (marker == 0xff && offset + 2 < p.length) {
                offset += 1;
                marker = p[offset + 1] & 255;
            }
            if (marker == 0xd8 || marker == 0xd9) { offset += 2; continue; }
            if (marker == 0xda) return new int[] { 0, 0 };
            if (offset + 4 > p.length) return new int[] { 0, 0 };
            int length = u16be(p, offset + 2);
            if (length < 2) return new int[] { 0, 0 };
            boolean sof = marker >= 0xc0 && marker <= 0xcf
                    && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
            if (sof && offset + 9 <= p.length) {
                int height = u16be(p, offset + 5);
                int width = u16be(p, offset + 7);
                if (width > 0 && height > 0) return new int[] { width, height };
                return new int[] { 0, 0 };
            }
            offset += 2 + length;
        }
        return new int[] { 0, 0 };
    }

    private static String ascii(byte[] p, int offset, int length) {
        if (offset < 0 || length < 0 || offset + length > p.length) return null;
        return new String(p, offset, length, StandardCharsets.US_ASCII);
    }

    private static int u16be(byte[] p, int at) {
        if (at + 2 > p.length) return 0;
        return ((p[at] & 255) << 8) | (p[at + 1] & 255);
    }

    private static int u16le(byte[] p, int at) {
        if (at + 2 > p.length) return 0;
        return (p[at] & 255) | ((p[at + 1] & 255) << 8);
    }

    private static long u32be(byte[] p, int at) {
        if (at + 4 > p.length) return 0;
        return ((long) (p[at] & 255) << 24) | ((long) (p[at + 1] & 255) << 16)
                | ((long) (p[at + 2] & 255) << 8) | (long) (p[at + 3] & 255);
    }

    private static long u32le(byte[] p, int at) {
        if (at + 4 > p.length) return 0;
        return (long) (p[at] & 255) | ((long) (p[at + 1] & 255) << 8)
                | ((long) (p[at + 2] & 255) << 16) | ((long) (p[at + 3] & 255) << 24);
    }

    private static int u24le(byte[] p, int at) {
        if (at + 3 > p.length) return 0;
        return (p[at] & 255) | ((p[at + 1] & 255) << 8) | ((p[at + 2] & 255) << 16);
    }
}
