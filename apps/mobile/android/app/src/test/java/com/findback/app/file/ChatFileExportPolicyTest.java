package com.findback.app.file;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * JVM rules for the native chat-file export bridge. Everything here is pure
 * Java: no Android framework, no network, no device. The Android side
 * (MediaStore publish, FileProvider handoff, legacy Os.open) is source-only
 * in this test run and stays UNVERIFIED until an authorized device/CI run.
 */
public class ChatFileExportPolicyTest {

    private static final String ORIGIN = "abcdefghijklmnop.supabase.co";
    private static final String UPLOADER = "11111111-1111-4111-8111-111111111111";
    private static final String CONVERSATION = "22222222-2222-4222-8222-222222222222";
    private static final String FILE_ID = "33333333-3333-4333-8333-333333333333";
    private static final String TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3MDAwMDAwMDB9.c2lnbmF0dXJl";

    private static String signedUrl(String nameSegment) {
        return "https://" + ORIGIN + "/storage/v1/object/sign/findback-chat-files/files/"
            + UPLOADER + "/" + CONVERSATION + "/" + FILE_ID + "-" + nameSegment
            + "?token=" + TOKEN;
    }

    private static String withToken(String token) {
        return "https://" + ORIGIN + "/storage/v1/object/sign/findback-chat-files/files/"
            + UPLOADER + "/" + CONVERSATION + "/" + FILE_ID + "-Report.pdf?token=" + token;
    }

    // --- compiled origin ---------------------------------------------------

    @Test
    public void acceptsABareHttpsSupabaseOrigin() {
        assertEquals(ORIGIN, ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN));
        assertEquals(ORIGIN, ChatFileExportPolicy.normalizeOrigin("  https://" + ORIGIN + "  "));
        assertEquals(ORIGIN, ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + "/"));
        assertEquals(ORIGIN, ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + ":443"));
        // DNS hostnames are case-insensitive; the compiled value is canonical.
        assertEquals(ORIGIN, ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN.toUpperCase()));
    }

    @Test
    public void refusesAnyOriginThatIsNotTheExactBareProject() {
        assertNull(ChatFileExportPolicy.normalizeOrigin(null));
        assertNull(ChatFileExportPolicy.normalizeOrigin(""));
        assertNull(ChatFileExportPolicy.normalizeOrigin("http://" + ORIGIN));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + "/storage/v1"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + "?x=1"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + "#frag"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://user:pw@" + ORIGIN));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + ":8443"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://supabase.co"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://evil.example.com"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://a_b.supabase.co"));
        assertNull(ChatFileExportPolicy.normalizeOrigin("https://" + ORIGIN + ".evil.example"));
    }

    // --- signed URL gate ---------------------------------------------------

    @Test
    public void acceptsTheOneSignedChatObjectShape() {
        assertTrue(ChatFileExportPolicy.isAllowedSignedUrl(signedUrl("Report%20final.pdf"), ORIGIN));
        // percent-encoded non-ASCII base name is legitimate and preserved
        assertTrue(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("%D1%84%D0%B0%D0%B9%D0%BB.pdf"), ORIGIN));
        // an explicit default port and a literal plus are still the same object
        String explicitPort = signedUrl("a+b.pdf").replace("https://" + ORIGIN, "https://" + ORIGIN + ":443");
        assertTrue(ChatFileExportPolicy.isAllowedSignedUrl(explicitPort, ORIGIN));
    }

    @Test
    public void acceptsARawUnicodePathWithoutASecondDecode() {
        // Storage may hand the key back unencoded; the same object shape must
        // still pass, and the single-decode rule must be unchanged.
        assertTrue(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("\u0444\u0430\u0439\u043b.pdf"), ORIGIN));
        assertTrue(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("\u05d3\u05d5\u05d7.pdf"), ORIGIN));
    }

    @Test
    public void refusesEveryOtherStorageEndpointAndHost() {
        String base = signedUrl("Report.pdf");
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(base, "otherproject.supabase.co"));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(base, null));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(null, ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(base.replace("https://", "http://"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("/sign/", "/authenticated/"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("/sign/", "/public/"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("findback-chat-files", "avatars"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("/object/sign/", "/object/sign/nested/"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("https://" + ORIGIN, "https://user:pw@" + ORIGIN), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(base + "#fragment", ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("https://" + ORIGIN, "https://" + ORIGIN + ":8443"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace(FILE_ID, "not-a-uuid"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace(UPLOADER, "short"), ORIGIN));
        // extra path segment / trailing slash
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("?token=", "/extra?token="), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(base + "/", ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.replace("/files/", "//files/"), ORIGIN));
    }

    @Test
    public void refusesSeparatorAndTraversalTricks() {
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(signedUrl(".."), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(signedUrl("%2e%2e"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("a%2Fb.pdf"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("a%2fb.pdf"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("a%5Cb.pdf"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("a%00b.pdf"), ORIGIN));
        // double-encoded separators never get a second decode
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("a%252Fb.pdf"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("%252e%252e"), ORIGIN));
        // a traversal segment in the middle of the path
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            baseWithUploader(".."), ORIGIN));
        // malformed escape
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl("a%2.pdf"), ORIGIN));
        // empty file name after the uuid prefix
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            "https://" + ORIGIN + "/storage/v1/object/sign/findback-chat-files/files/"
                + UPLOADER + "/" + CONVERSATION + "/" + FILE_ID + "-?token=" + TOKEN,
            ORIGIN));
    }

    private static String baseWithUploader(String segment) {
        return "https://" + ORIGIN + "/storage/v1/object/sign/findback-chat-files/files/"
            + segment + "/" + CONVERSATION + "/" + FILE_ID + "-Report.pdf?token=" + TOKEN;
    }

    @Test
    public void refusesAnyQueryThatIsNotOneBoundedJwtToken() {
        String base = signedUrl("Report.pdf");
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            base.substring(0, base.indexOf('?')), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(withToken(""), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(withToken("abc"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(withToken("a.b"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(withToken("a.b.c.d"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(withToken("a.%41.c"), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            withToken(TOKEN) + "&download=1", ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            withToken(TOKEN).replace("?token=", "?TOKEN="), ORIGIN));
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            withToken(TOKEN) + "&token=" + TOKEN, ORIGIN));

        StringBuilder hugeToken = new StringBuilder();
        for (int i = 0; i < 9000; i++) hugeToken.append('a');
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            withToken(hugeToken + ".b.c"), ORIGIN));
        // a token that fits but makes the whole URL larger than 16 KiB
        StringBuilder longSegment = new StringBuilder();
        for (int i = 0; i < 17000; i++) longSegment.append('a');
        assertFalse(ChatFileExportPolicy.isAllowedSignedUrl(
            signedUrl(longSegment + ".pdf"), ORIGIN));
    }

    // --- request fields ----------------------------------------------------

    @Test
    public void acceptsOnlyCanonicalUuids() {
        assertTrue(ChatFileExportPolicy.isUuid(UPLOADER));
        assertTrue(ChatFileExportPolicy.isUuid(UPLOADER.toUpperCase()));
        assertFalse(ChatFileExportPolicy.isUuid(null));
        assertFalse(ChatFileExportPolicy.isUuid(""));
        assertFalse(ChatFileExportPolicy.isUuid("not-a-uuid"));
        assertFalse(ChatFileExportPolicy.isUuid(UPLOADER.replace('-', ' ')));
        assertFalse(ChatFileExportPolicy.isUuid(UPLOADER + "0"));
        assertFalse(ChatFileExportPolicy.isUuid(UPLOADER.replace('1', 'g')));
    }

    @Test
    public void byteSizeIsBoundedToTheUploadCeiling() {
        assertTrue(ChatFileExportPolicy.isAllowedByteSize(1L));
        assertTrue(ChatFileExportPolicy.isAllowedByteSize(ChatFileExportPolicy.MAX_BYTES));
        assertFalse(ChatFileExportPolicy.isAllowedByteSize(0L));
        assertFalse(ChatFileExportPolicy.isAllowedByteSize(-1L));
        assertFalse(ChatFileExportPolicy.isAllowedByteSize(ChatFileExportPolicy.MAX_BYTES + 1L));
    }

    // --- names -------------------------------------------------------------

    @Test
    public void keepsOrdinaryNamesAndUnicode() {
        assertEquals("Report final.pdf", ChatFileExportPolicy.cleanDisplayName("Report final.pdf"));
        assertEquals("r\u00e9sum\u00e9-\u03c0.pdf",
            ChatFileExportPolicy.cleanDisplayName("r\u00e9sum\u00e9-\u03c0.pdf"));
        assertEquals("2026 Q4 (final).xlsx", ChatFileExportPolicy.cleanDisplayName("2026 Q4 (final).xlsx"));
    }

    @Test
    public void stripsSeparatorsControlsWindowsCharactersAndBidi() {
        assertEquals("a-b.pdf", ChatFileExportPolicy.cleanDisplayName("a/b.pdf"));
        assertEquals("a-b.pdf", ChatFileExportPolicy.cleanDisplayName("a\\b.pdf"));
        assertEquals("ab.txt", ChatFileExportPolicy.cleanDisplayName("a\u0000b.txt"));
        assertEquals("a-b-c-d-e-f.pdf", ChatFileExportPolicy.cleanDisplayName("a<b>c:d\"e|f.pdf"));
        assertEquals("invoice.pdf", ChatFileExportPolicy.cleanDisplayName("invoice\u202E.pdf"));
        assertEquals("safe.txt", ChatFileExportPolicy.cleanDisplayName("safe\u2066.txt"));
        assertEquals("report.pdf", ChatFileExportPolicy.cleanDisplayName("report.pdf...   "));
    }

    @Test
    public void neutralisesEmptyDotAndReservedDosNames() {
        assertEquals("file", ChatFileExportPolicy.cleanDisplayName(null));
        assertEquals("file", ChatFileExportPolicy.cleanDisplayName(""));
        assertEquals("file", ChatFileExportPolicy.cleanDisplayName("   "));
        assertEquals("file", ChatFileExportPolicy.cleanDisplayName("."));
        assertEquals("file", ChatFileExportPolicy.cleanDisplayName(".."));
        assertEquals("file", ChatFileExportPolicy.cleanDisplayName("..."));
        assertEquals("_CON.txt", ChatFileExportPolicy.cleanDisplayName("CON.txt"));
        assertEquals("_prn", ChatFileExportPolicy.cleanDisplayName("prn"));
        assertEquals("_LPT9.pdf", ChatFileExportPolicy.cleanDisplayName("LPT9.pdf"));
        assertEquals("_NUL", ChatFileExportPolicy.cleanDisplayName("NUL"));
    }

    @Test
    public void capsNamesAtOneHundredTwentyCodePoints() {
        StringBuilder longName = new StringBuilder();
        for (int i = 0; i < 130; i++) longName.append('a');
        String cleaned = ChatFileExportPolicy.cleanDisplayName(longName.toString());
        assertEquals(120, cleaned.codePointCount(0, cleaned.length()));
    }

    // --- executable neutralisation and MIME --------------------------------

    @Test
    public void executableNamesBecomeTheNeutralDownloadExtension() {
        assertNeutral("setup.exe", ChatFileExportPolicy.prepareFile("setup.exe", "application/pdf"));
        assertNeutral("page.html", ChatFileExportPolicy.prepareFile("page.html", "text/plain"));
        assertNeutral("anim.svg", ChatFileExportPolicy.prepareFile("anim.svg", "image/svg+xml"));
        assertNeutral("notes.js", ChatFileExportPolicy.prepareFile("notes.js", "text/plain"));
        assertNeutral("run.bat", ChatFileExportPolicy.prepareFile("run.bat", null));
        assertNeutral("disk.iso", ChatFileExportPolicy.prepareFile("disk.iso", null));
        assertNeutral("payload.bin", ChatFileExportPolicy.prepareFile("payload.bin", "application/pdf"));
        ChatFileExportPolicy.ExportFile bareExe =
            ChatFileExportPolicy.prepareFile(".exe", "application/pdf");
        assertEquals("file.download", bareExe.name);
        assertEquals(ChatFileExportPolicy.OCTET_STREAM, bareExe.mime);
    }

    private static void assertNeutral(String rawName, ChatFileExportPolicy.ExportFile file) {
        assertTrue(rawName + " -> " + file.name, file.name.endsWith(".download"));
        assertNotEquals(rawName, file.name);
        assertFalse(file.name.toLowerCase().endsWith(".bin"));
        assertEquals(ChatFileExportPolicy.OCTET_STREAM, file.mime);
    }

    @Test
    public void executableMimeWithoutAKnownExtensionIsNeutralised() {
        ChatFileExportPolicy.ExportFile html =
            ChatFileExportPolicy.prepareFile("mystery", "text/html");
        assertEquals("mystery.download", html.name);
        assertEquals(ChatFileExportPolicy.OCTET_STREAM, html.mime);

        ChatFileExportPolicy.ExportFile script =
            ChatFileExportPolicy.prepareFile("data", "text/javascript");
        assertEquals("data.download", script.name);
        assertEquals(ChatFileExportPolicy.OCTET_STREAM, script.mime);
    }

    @Test
    public void aKnownExtensionOverridesALyingMarker() {
        ChatFileExportPolicy.ExportFile photo =
            ChatFileExportPolicy.prepareFile("photo.png", "text/html");
        assertEquals("photo.png", photo.name);
        assertEquals("image/png", photo.mime);

        ChatFileExportPolicy.ExportFile upper =
            ChatFileExportPolicy.prepareFile("photo.JPG", "image/png");
        assertEquals("image/jpeg", upper.mime);

        ChatFileExportPolicy.ExportFile doc =
            ChatFileExportPolicy.prepareFile("report.docx", "application/octet-stream");
        assertEquals(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            doc.mime);
    }

    @Test
    public void ordinaryDocumentsArchivesAndUnknownFormatsStayViewable() {
        assertEquals("application/pdf",
            ChatFileExportPolicy.prepareFile("a.pdf", "application/pdf; charset=binary").mime);
        assertEquals("application/zip",
            ChatFileExportPolicy.prepareFile("a.zip", null).mime);
        assertEquals("application/x-7z-compressed",
            ChatFileExportPolicy.prepareFile("a.7z", "application/x-7z-compressed").mime);

        ChatFileExportPolicy.ExportFile psd =
            ChatFileExportPolicy.prepareFile("mockup.psd", "application/octet-stream");
        assertEquals("mockup.psd", psd.name);
        assertEquals(ChatFileExportPolicy.OCTET_STREAM, psd.mime);
        assertEquals("mockup.psd", ChatFileExportPolicy.prepareFile("mockup.psd", null).name);

        ChatFileExportPolicy.ExportFile unknownMime =
            ChatFileExportPolicy.prepareFile("blob", "application/x-made-up");
        assertEquals("blob", unknownMime.name);
        assertEquals(ChatFileExportPolicy.OCTET_STREAM, unknownMime.mime);
    }

    @Test
    public void normalisesMimeParametersAndRejectsGarbageShapes() {
        assertEquals("application/pdf", ChatFileExportPolicy.normalizeMime(" Application/PDF ;q=1"));
        assertEquals("text/plain", ChatFileExportPolicy.normalizeMime("text/plain;charset=utf-8"));
        assertNull(ChatFileExportPolicy.normalizeMime(null));
        assertNull(ChatFileExportPolicy.normalizeMime(""));
        assertNull(ChatFileExportPolicy.normalizeMime("not a mime"));
        assertNull(ChatFileExportPolicy.normalizeMime("text/"));
        assertNull(ChatFileExportPolicy.normalizeMime("/plain"));
    }

    // --- collision ---------------------------------------------------------

    @Test
    public void collisionSuffixesPreserveTheExtension() {
        assertEquals("report.pdf", ChatFileExportPolicy.collisionName("report.pdf", 0));
        assertEquals("report (1).pdf", ChatFileExportPolicy.collisionName("report.pdf", 1));
        assertEquals("report (2).pdf", ChatFileExportPolicy.collisionName("report.pdf", 2));
        assertEquals("README (1)", ChatFileExportPolicy.collisionName("README", 1));

        StringBuilder longBase = new StringBuilder();
        for (int i = 0; i < 130; i++) longBase.append('a');
        String candidate = ChatFileExportPolicy.collisionName(longBase + ".pdf", 7);
        assertTrue(candidate.codePointCount(0, candidate.length())
            <= ChatFileExportPolicy.MAX_NAME_CODE_POINTS);
        assertTrue(candidate.endsWith(".pdf"));
        assertTrue(candidate.contains(" (7)"));
    }

    @Test
    public void exclusiveReservationNeverOverwritesAnExistingFile() throws Exception {
        File directory = Files.createTempDirectory("chat-export-").toFile();
        try {
            File first = new File(directory, "report.pdf");
            Files.write(first.toPath(), "original-bytes".getBytes(StandardCharsets.UTF_8));

            File second = ChatFileExportPolicy.reserveExclusiveName(directory, "report.pdf", 10);
            assertEquals("report (1).pdf", second.getName());
            assertEquals("original-bytes",
                new String(Files.readAllBytes(first.toPath()), StandardCharsets.UTF_8));

            File third = ChatFileExportPolicy.reserveExclusiveName(directory, "report.pdf", 10);
            assertEquals("report (2).pdf", third.getName());
            assertEquals("original-bytes",
                new String(Files.readAllBytes(first.toPath()), StandardCharsets.UTF_8));

            Files.write(second.toPath(), new byte[] { 1 });
            assertEquals(new File(directory, "report (3).pdf"),
                ChatFileExportPolicy.reserveExclusiveName(directory, "report.pdf", 10));
            assertEquals("original-bytes",
                new String(Files.readAllBytes(first.toPath()), StandardCharsets.UTF_8));
        } finally {
            deleteTree(directory);
        }
    }

    @Test
    public void exclusiveReservationFailsClosedWhenTheNameSpaceIsExhausted() throws Exception {
        File directory = Files.createTempDirectory("chat-export-").toFile();
        try {
            Files.write(new File(directory, "a.txt").toPath(), new byte[] { 1 });
            Files.write(new File(directory, "a (1).txt").toPath(), new byte[] { 1 });
            try {
                ChatFileExportPolicy.reserveExclusiveName(directory, "a.txt", 2);
                fail("name exhaustion accepted");
            } catch (IOException expected) {
                // expected: never fall back to an existing path
            }
            assertEquals(2, directory.list().length);
        } finally {
            deleteTree(directory);
        }
    }

    // --- owned view cache --------------------------------------------------

    @Test
    public void prunesOnlyOldFilesInTheOwnViewCache() throws Exception {
        File root = Files.createTempDirectory("chat-view-").toFile();
        File activeDir = new File(root, "active-op");
        File oldDir = new File(root, "old-op");
        File youngDir = new File(root, "young-op");
        try {
            activeDir.mkdirs();
            oldDir.mkdirs();
            youngDir.mkdirs();
            File active = new File(activeDir, "a.pdf");
            File old = new File(oldDir, "b.pdf");
            File young = new File(youngDir, "c.pdf");
            Files.write(active.toPath(), new byte[] { 1, 2, 3 });
            Files.write(old.toPath(), new byte[] { 1, 2, 3 });
            Files.write(young.toPath(), new byte[] { 1, 2, 3 });

            long now = System.currentTimeMillis();
            // active op is 25 h old but must survive; the old idle copy must not
            assertTrue(active.setLastModified(now - ChatFileExportPolicy.VIEW_RETENTION_MS - 1000L));
            assertTrue(old.setLastModified(now - ChatFileExportPolicy.VIEW_RETENTION_MS - 1000L));
            assertTrue(young.setLastModified(now - 60_000L));

            Set<String> activeIds = new HashSet<>(Collections.singletonList("active-op"));
            assertTrue(ChatFileExportPolicy.planViewCache(root, now, activeIds, 0L));

            assertTrue(active.isFile());
            assertFalse(old.isFile());
            assertTrue(young.isFile());
            assertFalse(oldDir.isDirectory());
        } finally {
            deleteTree(root);
        }
    }

    @Test
    public void refusesAnIncomingViewWhenTheCacheBudgetCannotBeMet() {
        assertFalse(ChatFileExportPolicy.planViewCache(
            null, System.currentTimeMillis(), Collections.<String>emptySet(),
            ChatFileExportPolicy.VIEW_CACHE_BUDGET_BYTES + 1L));
        assertTrue(ChatFileExportPolicy.planViewCache(
            null, System.currentTimeMillis(), Collections.<String>emptySet(),
            ChatFileExportPolicy.MAX_BYTES));
    }

    // --- messages ----------------------------------------------------------

    @Test
    public void everyInterfaceCodeHasFixedCopyAndNoUnknownCodeLeaks() {
        String[] codes = {
            ChatFileExportPolicy.CODE_PERMISSION_DENIED,
            ChatFileExportPolicy.CODE_CANCELLED,
            ChatFileExportPolicy.CODE_NO_HANDLER,
            ChatFileExportPolicy.CODE_SIZE_MISMATCH,
            ChatFileExportPolicy.CODE_INSUFFICIENT_STORAGE,
            ChatFileExportPolicy.CODE_NETWORK_ERROR,
            ChatFileExportPolicy.CODE_INVALID_REQUEST,
            ChatFileExportPolicy.CODE_NOT_FOUND,
        };
        for (String code : codes) {
            String message = ChatFileExportPolicy.messageFor(code);
            assertNotNull(code, message);
            assertFalse(code, message.trim().isEmpty());
        }
        assertEquals(ChatFileExportPolicy.messageFor(ChatFileExportPolicy.CODE_INVALID_REQUEST),
            ChatFileExportPolicy.messageFor("SOMETHING_NEW"));
        // A gone object travels as its own NOT_FOUND code, so the JS service
        // maps it before it can fall back to the generic retry copy.
        assertEquals("NOT_FOUND", ChatFileExportPolicy.CODE_NOT_FOUND);
        assertEquals(ChatFileExportPolicy.MESSAGE_FILE_GONE,
            ChatFileExportPolicy.messageFor(ChatFileExportPolicy.CODE_NOT_FOUND));
        assertNotEquals(ChatFileExportPolicy.messageFor(ChatFileExportPolicy.CODE_NETWORK_ERROR),
            ChatFileExportPolicy.MESSAGE_FILE_GONE);
    }

    @Test
    public void thePluginSendsTheNotFoundCodeForHttpNotFound() throws Exception {
        File source = locatePluginSource();
        assertTrue(
            "FindbackFileExportPlugin.java missing: expected src/main/java/com/findback/app/file/"
                + " or apps/mobile/android/app/src/main/java/com/findback/app/file/ relative to the"
                + " JVM test working dir (resolved to " + source.getAbsolutePath() + ")",
            source.isFile());
        String text = new String(Files.readAllBytes(source.toPath()), StandardCharsets.UTF_8);

        int branch = text.indexOf("HttpURLConnection.HTTP_NOT_FOUND");
        assertTrue("HTTP_NOT_FOUND branch not found", branch >= 0);
        int next = text.indexOf("if (status < 200", branch);
        assertTrue("HTTP_NOT_FOUND branch has no following status check", next > branch);
        String notFound = text.substring(branch, next);
        assertTrue(notFound, notFound.contains("ChatFileExportPolicy.CODE_NOT_FOUND"));
        assertTrue(notFound, notFound.contains("ChatFileExportPolicy.MESSAGE_FILE_GONE"));
        assertFalse(notFound, notFound.contains("ChatFileExportPolicy.CODE_NETWORK_ERROR"));
    }

    // --- parity with the web refusal lists ---------------------------------

    @Test
    public void refusalListsMatchTheWebCanonicalCopy() throws Exception {
        File source = locateFilesSource();
        assertTrue(
            "files.ts missing: expected ../../src/services/messaging/files.ts,"
                + " ../src/services/messaging/files.ts or"
                + " apps/mobile/src/services/messaging/files.ts relative to the JVM test working dir"
                + " (resolved to " + source.getAbsolutePath() + ")",
            source.isFile());
        String text = new String(Files.readAllBytes(source.toPath()), StandardCharsets.UTF_8);

        Set<String> webExtensions = quotedSet(
            text, "const REFUSED_EXTENSIONS = new Set([", "]);");
        Set<String> webMimes = quotedSet(
            text, "const REFUSED_MIME = new Set([", "]);");
        Set<String> webAllowlist = quotedSet(
            text, "export const CHAT_FILE_MIME_ALLOWLIST = [", "] as const;");

        assertNotNull(webExtensions);
        assertNotNull(webMimes);
        assertNotNull(webAllowlist);
        assertEquals(new LinkedHashSet<>(webExtensions), new LinkedHashSet<>(ChatFileExportPolicy.refusedExtensions()));
        assertEquals(new LinkedHashSet<>(webMimes), new LinkedHashSet<>(ChatFileExportPolicy.refusedMimes()));
        assertEquals(new LinkedHashSet<>(webAllowlist), new LinkedHashSet<>(ChatFileExportPolicy.allowedMimes()));
    }

    private static File locateFilesSource() {
        File[] candidates = {
            new File("../../src/services/messaging/files.ts"),
            new File("../src/services/messaging/files.ts"),
            new File("apps/mobile/src/services/messaging/files.ts"),
        };
        for (File candidate : candidates) {
            if (candidate.isFile()) return candidate;
        }
        return candidates[0];
    }

    private static File locatePluginSource() {
        File[] candidates = {
            new File("src/main/java/com/findback/app/file/FindbackFileExportPlugin.java"),
            new File("apps/mobile/android/app/src/main/java/com/findback/app/file/FindbackFileExportPlugin.java"),
        };
        for (File candidate : candidates) {
            if (candidate.isFile()) return candidate;
        }
        return candidates[0];
    }

    private static Set<String> quotedSet(String source, String startMarker, String endMarker) {
        int start = source.indexOf(startMarker);
        if (start < 0) return null;
        int from = start + startMarker.length();
        int end = source.indexOf(endMarker, from);
        if (end < 0) return null;
        Matcher matcher = Pattern.compile("\"([^\"]+)\"").matcher(source.substring(from, end));
        Set<String> values = new LinkedHashSet<>();
        while (matcher.find()) values.add(matcher.group(1));
        return values;
    }

    // --- helpers -----------------------------------------------------------

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }
}
