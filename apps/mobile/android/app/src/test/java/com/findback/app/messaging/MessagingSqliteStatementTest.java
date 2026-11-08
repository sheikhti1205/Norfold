package com.findback.app.messaging;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;

import android.database.sqlite.SQLiteDatabase;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import com.getcapacitor.JSArray;
import org.json.JSONObject;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.junit.Test;

/** Runs the actual native validator; no Android database/runtime claim. */
public class MessagingSqliteStatementTest {
    @Test public void dataEpochRefusesOutstandingAccountLeaseBeforeTouchingFiles() throws Exception {
        Field ownersField = FindbackMessagingSqlitePlugin.class.getDeclaredField("accountOwners");
        ownersField.setAccessible(true);
        @SuppressWarnings("unchecked") Map<String, Object> owners = (Map<String, Object>) ownersField.get(null);
        String account = "00000000-0000-4000-8000-0000000000e8";
        Object owner = new Object();
        owners.put(account, owner);
        try {
            // Null context is intentional:no platform/file operation may be
            // reached while any old/recreated plugin still owns a database.
            assertThrows(IllegalStateException.class, () -> FindbackMessagingSqlitePlugin.resetForDataEpoch(null));
            assertEquals(owner, owners.get(account));
        } finally { owners.remove(account, owner); }
    }
    private static final String TEST_DOCUMENT = "test-document-a0001";
    private static final class RecordedCall extends PluginCall {
        String rejectedCode;
        String rejectedMessage;
        JSObject resolved;
        final CountDownLatch rejected = new CountDownLatch(1);
        final CountDownLatch settled = new CountDownLatch(1);
        RecordedCall(String account) { this(account, TEST_DOCUMENT); }
        RecordedCall(String account, String documentId) {
            super(null, "FindbackMessagingSqlite", "test", "open",
                    new JSObject().put("accountId", account).put("documentId", documentId));
        }
        @Override public void reject(String message, String code) {
            rejectedCode = code;
            rejectedMessage = message;
            rejected.countDown();
            settled.countDown();
        }
        @Override public void resolve(JSObject data) {
            resolved = data;
            settled.countDown();
        }
    }

    private static final class FakeConnection implements FindbackMessagingSqlitePlugin.DatabaseConnection {
        final java.util.concurrent.atomic.AtomicInteger closes = new java.util.concurrent.atomic.AtomicInteger();
        final boolean failClose;
        FakeConnection() { this(false); }
        FakeConnection(boolean failClose) { this.failClose = failClose; }
        @Override public SQLiteDatabase database() { return null; }
        @Override public void verify() { }
        @Override public void close() {
            closes.incrementAndGet();
            if (failClose) throw new IllegalStateException("connection cannot close");
        }
    }

    @Test public void staleDocumentReclaimsTheUnreachableLeaseBeforeOpeningAgain() throws Exception {
        String account = "00000000-0000-4000-8000-0000000000d1";
        FakeConnection firstConnection = new FakeConnection();
        FakeConnection secondConnection = new FakeConnection();
        FindbackMessagingSqlitePlugin plugin = new FindbackMessagingSqlitePlugin() {
            int opened, handles;
            @Override DatabaseConnection openDatabase(String ignored) {
                opened++;
                return opened == 1 ? firstConnection : secondConnection;
            }
            @Override String newHandle() { return "test-handle-" + (++handles); }
        };
        try {
            RecordedCall first = new RecordedCall(account, "document-one-a0001");
            plugin.open(first);
            org.junit.Assert.assertTrue(first.settled.await(2, TimeUnit.SECONDS));
            assertEquals(first.rejectedMessage, null, first.rejectedCode);
            assertNotNull(first.resolved);
            assertEquals(0, firstConnection.closes.get());

            // A WebView document reload lost the only handle token. The next
            // document must close that lease before it opens its own database.
            RecordedCall second = new RecordedCall(account, "document-two-b0002");
            plugin.open(second);
            org.junit.Assert.assertTrue(second.settled.await(2, TimeUnit.SECONDS));
            assertNotNull(second.resolved);
            assertEquals(1, firstConnection.closes.get());
            assertEquals(0, secondConnection.closes.get());
        } finally {
            plugin.handleOnDestroy();
        }
    }

    @Test public void sameDocumentDoubleOpenIsStillRejected() throws Exception {
        String account = "00000000-0000-4000-8000-0000000000d2";
        FindbackMessagingSqlitePlugin plugin = new FindbackMessagingSqlitePlugin() {
            int handles;
            @Override DatabaseConnection openDatabase(String ignored) { return new FakeConnection(); }
            @Override String newHandle() { return "test-handle-" + (++handles); }
        };
        try {
            RecordedCall first = new RecordedCall(account, "document-one-a0001");
            plugin.open(first);
            org.junit.Assert.assertTrue(first.settled.await(2, TimeUnit.SECONDS));
            assertEquals(first.rejectedMessage, null, first.rejectedCode);
            assertNotNull(first.resolved);

            RecordedCall duplicate = new RecordedCall(account, "document-one-a0001");
            plugin.open(duplicate);
            assertEquals("MESSAGING_STORAGE_ALREADY_OPEN", duplicate.rejectedCode);
        } finally {
            plugin.handleOnDestroy();
        }
    }

    @Test public void uncertainTeardownRejectsTheNewDocumentInsteadOfReopening() throws Exception {
        String account = "00000000-0000-4000-8000-0000000000d3";
        FindbackMessagingSqlitePlugin first = new FindbackMessagingSqlitePlugin() {
            @Override DatabaseConnection openDatabase(String ignored) { return new FakeConnection(true); }
            @Override String newHandle() { return "test-handle-first"; }
        };
        FindbackMessagingSqlitePlugin replacement = new FindbackMessagingSqlitePlugin() {
            int handles;
            @Override DatabaseConnection openDatabase(String ignored) { return new FakeConnection(); }
            @Override String newHandle() { return "test-handle-new-" + (++handles); }
        };
        try {
            RecordedCall opened = new RecordedCall(account, "document-one-a0001");
            first.open(opened);
            org.junit.Assert.assertTrue(opened.settled.await(2, TimeUnit.SECONDS));
            assertEquals(opened.rejectedMessage, null, opened.rejectedCode);
            assertNotNull(opened.resolved);
            first.handleOnDestroy();

            RecordedCall next = new RecordedCall(account, "document-two-b0002");
            replacement.open(next);
            org.junit.Assert.assertTrue(next.settled.await(2, TimeUnit.SECONDS));
            assertEquals("MESSAGING_STORAGE_STALE_CLOSE", next.rejectedCode);
            assertEquals(null, next.resolved);
        } finally {
            replacement.handleOnDestroy();
            // The lease is deliberately retained: clear it only for test isolation.
            Field owners = FindbackMessagingSqlitePlugin.class.getDeclaredField("accountOwners");
            owners.setAccessible(true);
            ((Map<?, ?>) owners.get(null)).remove(account);
        }
    }

    @Test public void unexpectedFailureBeforeConnectionDoesNotStrandAccountAcrossRecreation() throws Exception {
        String account = "00000000-0000-4000-8000-0000000000c3";
        FindbackMessagingSqlitePlugin first = new FindbackMessagingSqlitePlugin() {
            @Override DatabaseConnection openDatabase(String ignored) {
                throw new SecurityException("private directory unavailable");
            }
        };
        FindbackMessagingSqlitePlugin replacement = new FindbackMessagingSqlitePlugin() {
            @Override DatabaseConnection openDatabase(String ignored) {
                throw new SecurityException("private directory unavailable");
            }
        };
        try {
            RecordedCall failed = new RecordedCall(account);
            first.open(failed);
            org.junit.Assert.assertTrue(failed.rejected.await(2, TimeUnit.SECONDS));
            assertEquals("MESSAGING_STORAGE_FAILED", failed.rejectedCode);
            first.handleOnDestroy();
            RecordedCall retry = new RecordedCall(account);
            replacement.open(retry);
            org.junit.Assert.assertTrue(retry.rejected.await(2, TimeUnit.SECONDS));
            assertEquals("MESSAGING_STORAGE_FAILED", retry.rejectedCode);
        } finally {
            first.handleOnDestroy();
            replacement.handleOnDestroy();
        }
    }

    @Test public void duplicatePendingOpenIsRejectedBeforeTheNativeLaneAndAcrossPluginInstances() throws Exception {
        FindbackMessagingSqlitePlugin first = new FindbackMessagingSqlitePlugin();
        FindbackMessagingSqlitePlugin second = new FindbackMessagingSqlitePlugin();
        Field field = FindbackMessagingSqlitePlugin.class.getDeclaredField("lane");
        field.setAccessible(true);
        ExecutorService lane = (ExecutorService) field.get(first);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        lane.execute(() -> {
            entered.countDown();
            try { release.await(); } catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
        });
        try {
            org.junit.Assert.assertTrue(entered.await(2, TimeUnit.SECONDS));
            String account = "00000000-0000-4000-8000-0000000000c1";
            first.open(new RecordedCall(account));
            RecordedCall duplicate = new RecordedCall(account);
            first.open(duplicate);
            assertEquals("MESSAGING_STORAGE_ALREADY_OPEN", duplicate.rejectedCode);
            RecordedCall recreated = new RecordedCall(account);
            second.open(recreated);
            assertEquals("MESSAGING_STORAGE_ALREADY_OPEN", recreated.rejectedCode);
        } finally {
            first.handleOnDestroy();
            second.handleOnDestroy();
            release.countDown();
            org.junit.Assert.assertTrue(lane.awaitTermination(2, TimeUnit.SECONDS));
            org.junit.Assert.assertTrue(((ExecutorService) field.get(second)).awaitTermination(2, TimeUnit.SECONDS));
            Field owners = FindbackMessagingSqlitePlugin.class.getDeclaredField("accountOwners");
            owners.setAccessible(true);
            org.junit.Assert.assertFalse(((Map<?, ?>) owners.get(null))
                    .containsKey("00000000-0000-4000-8000-0000000000c1"));
        }
    }

    @Test public void destroyedPluginDoesNotReserveAnAccount() throws Exception {
        FindbackMessagingSqlitePlugin plugin = new FindbackMessagingSqlitePlugin();
        plugin.handleOnDestroy();
        String account = "00000000-0000-4000-8000-0000000000c2";
        RecordedCall call = new RecordedCall(account);
        plugin.open(call);
        assertEquals("MESSAGING_STORAGE_CLOSED", call.rejectedCode);
        Field owners = FindbackMessagingSqlitePlugin.class.getDeclaredField("accountOwners");
        owners.setAccessible(true);
        org.junit.Assert.assertFalse(((Map<?, ?>) owners.get(null)).containsKey(account));
        Field field = FindbackMessagingSqlitePlugin.class.getDeclaredField("lane");
        field.setAccessible(true);
        org.junit.Assert.assertTrue(((ExecutorService) field.get(plugin)).awaitTermination(2, TimeUnit.SECONDS));
    }

    private static String validate(String sql) throws Exception {
        try {
            return (String) MethodHandles.privateLookupIn(FindbackMessagingSqlitePlugin.class,
                    MethodHandles.lookup()).findStatic(FindbackMessagingSqlitePlugin.class,
                    "validateStatement", MethodType.methodType(String.class, String.class)).invokeExact(sql);
        } catch (Exception failure) {
            throw failure;
        } catch (Throwable failure) {
            throw new AssertionError(failure);
        }
    }

    private static void rejects(String sql) {
        Exception failure = assertThrows(Exception.class, () -> validate(sql));
        assertEquals("Messaging storage rejected an invalid request.", failure.getMessage());
    }

    @Test public void acceptsActualHistoryAdapterSql() throws Exception {
        JSONArray statements = new JSONArray(new String(Files.readAllBytes(
                Path.of(System.getProperty("messaging.sql.fixture"))), StandardCharsets.UTF_8));
        org.junit.Assert.assertTrue("Fixture must contain the complete adapter statement map",
                statements.length() > 100);
        List<String> rejected = new ArrayList<>();
        for (int index = 0; index < statements.length(); index++) {
            JSONObject statement = statements.getJSONObject(index);
            String sql = statement.getString("sql");
            try {
                assertEquals(sql.trim(), validate(sql));
            } catch (Exception failure) {
                // Only static statement identifiers, never SQL or parameters.
                rejected.add(statement.getString("name"));
            }
        }
        assertEquals("Actual adapter statements rejected by native transport: " + rejected,
                List.of(), rejected);
    }

    @Test public void refusesCommentPrefixedDurabilityChanges() {
        rejects("/* adapter */ pragma synchronous = off");
        rejects("-- adapter\npragma foreign_keys = off");
        rejects("/* adapter */ pragma writable_schema = on");
    }

    @Test public void refusesCommentsInsideSqlTokens() {
        rejects("pragma/**/synchronous = off");
        rejects("pragma /* boundary */ journal_mode = delete");
        rejects("select 1 /* trailing comment */");
    }

    @Test public void refusesByteOrderMarkBeforePragma() {
        rejects("\uFEFFpragma synchronous = off");
    }

    @Test public void acceptsOnlyDurablePragmas() throws Exception {
        for (String sql : new String[] {"pragma journal_mode = wal", "pragma synchronous = full",
                "pragma foreign_keys = on", "pragma busy_timeout = 5000", "pragma journal_mode",
                "pragma synchronous", "pragma foreign_keys"}) {
            assertEquals(sql, validate(sql));
        }
        rejects("pragma synchronous = off");
        rejects("pragma foreign_keys = off");
        rejects("pragma writable_schema = on");
        rejects("pragma main.synchronous = off");
        rejects("pragma \"synchronous\" = off");
    }

    @Test public void acceptsReadOnlySchemaProbesUsedByTheHistoryAdapter() throws Exception {
        for (String sql : new String[] {"pragma table_info(tombstones)",
                "pragma table_info(messages)", "pragma table_info(outbox)", "pragma foreign_key_check"}) {
            assertEquals(sql, validate(sql));
        }
        rejects("pragma table_info(other)");
        rejects("pragma table_info(messages) = off");
        rejects("pragma foreign_key_check = off");
        rejects("pragma main.table_info(messages)");
    }

    @Test public void forbidsOtherFilesAndMultipleStatements() {
        rejects("attach database ? as other");
        rejects("detach database other");
        rejects("vacuum into ?");
        rejects("select load_extension(?)");
        rejects("select 1; pragma synchronous = off");
        rejects("select 1;;");
        rejects("select 'unclosed");
    }

    @Test public void literalMessageContentIsNotSqlSyntax() throws Exception {
        String sql = "select 'don''t attach; -- or /* interpret */ message text'";
        assertEquals(sql, validate(sql));
        assertNotNull(validate("insert into messages (body) values (?)"));
    }

    private static Object[] arguments(JSArray values) throws Throwable {
        return (Object[]) MethodHandles.privateLookupIn(FindbackMessagingSqlitePlugin.class,
                MethodHandles.lookup()).findStatic(FindbackMessagingSqlitePlugin.class,
                "readArguments", MethodType.methodType(Object[].class, JSArray.class)).invokeExact(values);
    }

    @Test public void nativeArgumentsPreserveNullNumbersAndStrings() throws Throwable {
        JSArray values = new JSArray();
        values.put(JSONObject.NULL).put(0).put(-1).put(2.5).put(1_700_000_000_000L).put("");
        assertArrayEquals(new Object[] {null, 0L, -1L, 2.5, 1_700_000_000_000L, ""}, arguments(values));
    }

    @Test public void nativeArgumentsRejectUnsafeIntegerEvenWhenJsonParsesAsDouble() throws Exception {
        JSArray values = new JSArray();
        values.put(9_007_199_254_740_992.0);
        Throwable failure = assertThrows(Throwable.class, () -> arguments(values));
        assertEquals("Messaging storage rejected an invalid request.", failure.getMessage());
    }
}
