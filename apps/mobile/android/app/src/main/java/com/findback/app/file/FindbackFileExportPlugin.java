package com.findback.app.file;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.provider.MediaStore;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;

import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;

import com.findback.app.BuildConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLException;

/**
 * Native chat-file export: copy one authorized private Storage object into
 * Android Downloads, or hand it to a system viewer. Bytes never cross the JS
 * bridge.
 *
 * <p>Inputs are untrusted. {@code url} must be a short-lived signed URL for
 * exactly {@code findback-chat-files/files/<uuid>/<uuid>/<uuid>-name} on the
 * compiled Supabase origin ({@code BuildConfig.CHAT_FILE_STORAGE_ORIGIN});
 * {@code name}/{@code mime}/{@code byteSize} are re-validated here. The
 * network copy is a plain GET with redirects disabled, no cookies, no bearer
 * header, a fixed 60 s wall clock and an exact byte count.
 *
 * <p>Downloads: API 29+ inserts a pending MediaStore row and publishes it only
 * after the copy is complete; API 24-28 asks for WRITE_EXTERNAL_STORAGE at the
 * moment of Save and otherwise reserves the final public file with
 * {@code Os.open(O_CREAT | O_EXCL)} so an existing file is never replaced.
 *
 * <p>View: the copy lives in this plugin's own view cache and is handed to
 * ACTION_VIEW through the existing {@code <applicationId>.fileprovider}. The
 * temp file is deliberately kept (a pager may read it lazily) and pruned only
 * from that cache. No log line ever contains a URL, token or path.
 */
@CapacitorPlugin(
    name = "FindbackFileExport",
    permissions = @Permission(
        alias = FindbackFileExportPlugin.STORAGE_ALIAS,
        strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
    )
)
public final class FindbackFileExportPlugin extends Plugin {

    static final String STORAGE_ALIAS = "storage";

    private static final int MAX_ACTIVE_OPERATIONS = 1;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final long TOTAL_TIMEOUT_MS = 60_000L;
    private static final long STORAGE_HEADROOM_BYTES = 1024L * 1024L;
    private static final int MAX_CONSECUTIVE_ZERO_READS = 32;

    private static final String CACHE_STAGING_DIR = "findback-file-export";
    private static final String CACHE_VIEW_DIR = "findback-chat-view";
    private static final String FILE_PROVIDER_SUFFIX = ".fileprovider";
    private static final long STALE_STAGING_MS = 60L * 60L * 1000L;

    private enum Kind { SAVE, VIEW }

    private static final class Op {
        final String requestId;
        final Kind kind;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile HttpsURLConnection connection;
        volatile long startedAt;

        Op(String requestId, Kind kind) {
            this.requestId = requestId;
            this.kind = kind;
        }
    }

    private static final class ParsedRequest {
        final String requestId;
        final String url;
        final long byteSize;
        final String name;
        final String mime;

        ParsedRequest(String requestId, String url, long byteSize, String name, String mime) {
            this.requestId = requestId;
            this.url = url;
            this.byteSize = byteSize;
            this.name = name;
            this.mime = mime;
        }
    }

    private static final class ExportFailure extends Exception {
        final String code;
        final String message;

        ExportFailure(String code, String message) {
            super(message);
            this.code = code;
            this.message = message;
        }

        static ExportFailure of(String code) {
            return new ExportFailure(code, ChatFileExportPolicy.messageFor(code));
        }
    }

    private final Object opsLock = new Object();
    private final ConcurrentHashMap<String, Op> active = new ConcurrentHashMap<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile ExecutorService worker;

    @Override
    public void load() {
        worker = Executors.newSingleThreadExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "findback-file-export");
                thread.setDaemon(true);
                return thread;
            }
        });
        // Cache is owned by this plugin for the process lifetime: hold recent
        // viewer files for a day, then spend the 50 MiB budget on the oldest
        // eligible entries only. Pruning runs on the plugin's own worker so a
        // process start never does cache I/O on the main thread.
        try {
            worker.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        ChatFileExportPolicy.planViewCache(
                            viewRoot(),
                            System.currentTimeMillis(),
                            activeViewIds(),
                            0L
                        );
                    } catch (RuntimeException ignored) {
                        // A cache that cannot be inspected is not pruned now.
                    }
                }
            });
        } catch (RejectedExecutionException ignored) {
            // The plugin is already tearing down; nothing to prune.
        }
    }

    // --- bridge methods ----------------------------------------------------

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        ParsedRequest request = parse(call);
        if (request == null) return;
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            Op op = beginOp(request.requestId, Kind.SAVE);
            if (op == null) {
                rejectBusy(call);
                return;
            }
            PermissionState state = getPermissionState(STORAGE_ALIAS);
            if (state == PermissionState.GRANTED) {
                enqueueSave(call, op, request);
                return;
            }
            if (state == null) {
                finishOp(op);
                reject(call, ChatFileExportPolicy.CODE_PERMISSION_DENIED);
                return;
            }
            try {
                requestPermissionForAlias(STORAGE_ALIAS, call, "onStoragePermission");
            } catch (RuntimeException refused) {
                finishOp(op);
                reject(call, ChatFileExportPolicy.CODE_PERMISSION_DENIED);
            }
            return;
        }
        Op op = beginOp(request.requestId, Kind.SAVE);
        if (op == null) {
            rejectBusy(call);
            return;
        }
        enqueueSave(call, op, request);
    }

    @PermissionCallback
    private void onStoragePermission(PluginCall call) {
        if (call == null) return;
        String requestId = call.getString("requestId");
        Op op = requestId == null ? null : active.get(requestId);
        if (op == null) {
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
            return;
        }
        if (op.cancelled.get()) {
            finishOp(op);
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
            return;
        }
        if (getPermissionState(STORAGE_ALIAS) != PermissionState.GRANTED) {
            finishOp(op);
            reject(call, ChatFileExportPolicy.CODE_PERMISSION_DENIED);
            return;
        }
        ParsedRequest request = parse(call);
        if (request == null) {
            finishOp(op);
            return;
        }
        enqueueSave(call, op, request);
    }

    @PluginMethod
    public void openDocument(PluginCall call) {
        ParsedRequest request = parse(call);
        if (request == null) return;
        Op op = beginOp(request.requestId, Kind.VIEW);
        if (op == null) {
            rejectBusy(call);
            return;
        }
        ExecutorService executor = worker;
        if (executor == null) {
            finishOp(op);
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
            return;
        }
        try {
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    op.startedAt = System.currentTimeMillis();
                    try {
                        openCached(call, op, request);
                    } finally {
                        op.connection = null;
                        finishOp(op);
                    }
                }
            });
        } catch (RejectedExecutionException refused) {
            finishOp(op);
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
        }
    }

    @PluginMethod
    public void cancelExport(PluginCall call) {
        String requestId = call.getString("requestId");
        if (!ChatFileExportPolicy.isUuid(requestId)) {
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
            return;
        }
        Op op = active.get(requestId);
        boolean found = op != null;
        if (op != null) {
            op.cancelled.set(true);
            HttpsURLConnection connection = op.connection;
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (RuntimeException ignored) {
                    // The worker's own cancel checks still run.
                }
            }
        }
        JSObject out = new JSObject();
        out.put("cancelled", found);
        call.resolve(out);
    }

    @Override
    protected void handleOnDestroy() {
        for (Op op : active.values()) {
            op.cancelled.set(true);
            HttpsURLConnection connection = op.connection;
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (RuntimeException ignored) {
                    // Best effort: shutdownNow interrupts the worker.
                }
            }
        }
        synchronized (opsLock) {
            active.clear();
        }
        ExecutorService executor = worker;
        worker = null;
        if (executor != null) executor.shutdownNow();
        super.handleOnDestroy();
    }

    // --- request validation ------------------------------------------------

    private ParsedRequest parse(PluginCall call) {
        String requestId = call.getString("requestId");
        if (!ChatFileExportPolicy.isUuid(requestId)) {
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
            return null;
        }
        long byteSize = readByteSize(call);
        if (!ChatFileExportPolicy.isAllowedByteSize(byteSize)) {
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
            return null;
        }
        String originHost = ChatFileExportPolicy.normalizeOrigin(BuildConfig.CHAT_FILE_STORAGE_ORIGIN);
        String url = call.getString("url");
        if (originHost == null || !ChatFileExportPolicy.isAllowedSignedUrl(url, originHost)) {
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
            return null;
        }
        ChatFileExportPolicy.ExportFile file =
            ChatFileExportPolicy.prepareFile(call.getString("name"), call.getString("mime"));
        return new ParsedRequest(requestId, url, byteSize, file.name, file.mime);
    }

    private static long readByteSize(PluginCall call) {
        Object raw = call.getData().opt("byteSize");
        if (!(raw instanceof Number)) return -1L;
        Number number = (Number) raw;
        if (number instanceof Double || number instanceof Float) {
            double value = number.doubleValue();
            if (value != Math.rint(value) || value <= 0d || value > (double) Long.MAX_VALUE) return -1L;
            return (long) value;
        }
        return number.longValue();
    }

    private Op beginOp(String requestId, Kind kind) {
        Op op = new Op(requestId, kind);
        synchronized (opsLock) {
            if (active.size() >= MAX_ACTIVE_OPERATIONS) return null;
            if (active.containsKey(requestId)) return null;
            active.put(requestId, op);
        }
        return op;
    }

    private void finishOp(Op op) {
        synchronized (opsLock) {
            active.remove(op.requestId, op);
        }
    }

    private void enqueueSave(PluginCall call, Op op, ParsedRequest request) {
        ExecutorService executor = worker;
        if (executor == null) {
            finishOp(op);
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
            return;
        }
        try {
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    op.startedAt = System.currentTimeMillis();
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            saveToMediaStore(call, op, request);
                        } else {
                            saveToPublicDownloads(call, op, request);
                        }
                    } finally {
                        op.connection = null;
                        finishOp(op);
                    }
                }
            });
        } catch (RejectedExecutionException refused) {
            finishOp(op);
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
        }
    }

    // --- Save: API 29+ -----------------------------------------------------

    @RequiresApi(Build.VERSION_CODES.Q)
    private void saveToMediaStore(PluginCall call, Op op, ParsedRequest request) {
        ContentResolver resolver = getContext().getContentResolver();
        File staged = null;
        Uri pending = null;
        boolean published = false;
        try {
            staged = stage(op, request);
            throwIfCancelled(op);

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, request.name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, request.mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            pending = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (pending == null) throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);

            long copied;
            OutputStream output = resolver.openOutputStream(pending, "w");
            if (output == null) throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            try {
                copied = copyExact(staged, output, op, request.byteSize);
                output.flush();
            } finally {
                try {
                    output.close();
                } catch (IOException ignored) {
                    // A failed close is reported by the byte/size checks below.
                }
            }
            if (copied != request.byteSize) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
            }
            throwIfCancelled(op);

            ContentValues complete = new ContentValues();
            complete.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(pending, complete, null, null) != 1) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            published = true;

            String actual = queryDisplayName(resolver, pending);
            deleteQuietly(staged);
            staged = null;
            JSObject out = new JSObject();
            out.put("saved", true);
            out.put("name", actual == null || actual.isEmpty() ? request.name : actual);
            call.resolve(out);
        } catch (ExportFailure failure) {
            if (pending != null && !published) deleteUriQuietly(resolver, pending);
            deleteQuietly(staged);
            call.reject(failure.message, failure.code);
        } catch (IOException refused) {
            if (pending != null && !published) deleteUriQuietly(resolver, pending);
            deleteQuietly(staged);
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
        } catch (RuntimeException refused) {
            if (pending != null && !published) deleteUriQuietly(resolver, pending);
            deleteQuietly(staged);
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
        }
    }

    // --- Save: API 24-28 ---------------------------------------------------

    @SuppressWarnings("deprecation")
    private void saveToPublicDownloads(PluginCall call, Op op, ParsedRequest request) {
        File staged = null;
        File target = null;
        java.io.FileDescriptor fd = null;
        boolean complete = false;
        try {
            File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!downloads.isDirectory() && !downloads.mkdirs()) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            ensureFreeBytes(downloads, request.byteSize);
            staged = stage(op, request);
            throwIfCancelled(op);

            for (int attempt = 0; attempt < ChatFileExportPolicy.MAX_COLLISION_ATTEMPTS; attempt++) {
                String candidate = ChatFileExportPolicy.collisionName(request.name, attempt);
                if (candidate.indexOf('/') >= 0 || candidate.indexOf('\\') >= 0) {
                    throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
                }
                File file = new File(downloads, candidate);
                try {
                    fd = Os.open(
                        file.getAbsolutePath(),
                        OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL,
                        0644
                    );
                    target = file;
                    break;
                } catch (ErrnoException refused) {
                    if (refused.errno == OsConstants.EEXIST) continue;
                    throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
                }
            }
            if (target == null || fd == null) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }

            long copied = 0L;
            int zeroReads = 0;
            InputStream input = new FileInputStream(staged);
            try {
                byte[] buffer = new byte[BUFFER_SIZE];
                while (true) {
                    throwIfCancelled(op);
                    int read = input.read(buffer);
                    if (read < 0) break;
                    if (read == 0) {
                        if (++zeroReads > MAX_CONSECUTIVE_ZERO_READS) {
                            throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
                        }
                        continue;
                    }
                    zeroReads = 0;
                    copied += read;
                    if (copied > request.byteSize) {
                        throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
                    }
                    writeFully(fd, buffer, read);
                }
            } finally {
                try {
                    input.close();
                } catch (IOException ignored) {
                    // The byte count below is the authority.
                }
            }
            if (copied != request.byteSize) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
            }
            throwIfCancelled(op);
            try {
                Os.fsync(fd);
            } catch (ErrnoException refused) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            try {
                Os.close(fd);
            } catch (ErrnoException refused) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            fd = null;
            complete = true;
        } catch (ExportFailure failure) {
            deleteQuietly(staged);
            if (!complete && target != null) target.delete();
            call.reject(failure.message, failure.code);
            return;
        } catch (IOException refused) {
            deleteQuietly(staged);
            if (!complete && target != null) target.delete();
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
            return;
        } finally {
            if (fd != null) {
                try {
                    Os.close(fd);
                } catch (ErrnoException ignored) {
                    // Nothing else can be done with a descriptor that failed.
                }
            }
            deleteQuietly(staged);
            if (!complete && target != null) target.delete();
        }

        // Best effort: the bytes are already in Downloads, so a scanner that
        // refuses the request must not turn a completed save into a hang.
        try {
            MediaScannerConnection.scanFile(
                getContext(),
                new String[] { target.getAbsolutePath() },
                new String[] { request.mime },
                null
            );
        } catch (RuntimeException ignored) {
            // The system will index the file on its own schedule.
        }
        JSObject out = new JSObject();
        out.put("saved", true);
        out.put("name", target.getName());
        call.resolve(out);
    }

    // --- View --------------------------------------------------------------

    private void openCached(PluginCall call, Op op, ParsedRequest request) {
        File root = viewRoot();
        File requestDir = new File(root, request.requestId);
        try {
            throwIfCancelled(op);
            Set<String> activeViews = activeViewIds();
            if (!ChatFileExportPolicy.planViewCache(
                    root, System.currentTimeMillis(), activeViews, request.byteSize)) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INSUFFICIENT_STORAGE);
            }
            if (!requestDir.isDirectory() && !requestDir.mkdirs()) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            File target = new File(requestDir, request.name);
            download(op, request, target);
            throwIfCancelled(op);

            Uri uri;
            try {
                uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + FILE_PROVIDER_SUFFIX,
                    target
                );
            } catch (IllegalArgumentException refused) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }

            final boolean[] noHandler = new boolean[1];
            final boolean[] launchFailed = new boolean[1];
            final CountDownLatch launched = new CountDownLatch(1);
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (op.cancelled.get()) return;
                        Activity activity = getActivity();
                        if (activity == null) {
                            launchFailed[0] = true;
                            return;
                        }
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, request.mime);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.setClipData(ClipData.newRawUri("", uri));
                        activity.startActivity(intent);
                    } catch (ActivityNotFoundException refused) {
                        noHandler[0] = true;
                    } catch (RuntimeException refused) {
                        launchFailed[0] = true;
                    } finally {
                        launched.countDown();
                    }
                }
            });
            if (!launched.await(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            throwIfCancelled(op);
            if (noHandler[0]) throw ExportFailure.of(ChatFileExportPolicy.CODE_NO_HANDLER);
            if (launchFailed[0]) throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);

            JSObject out = new JSObject();
            out.put("opened", true);
            call.resolve(out);
        } catch (ExportFailure failure) {
            deleteRequestDir(root, requestDir);
            call.reject(failure.message, failure.code);
        } catch (InterruptedException refused) {
            Thread.currentThread().interrupt();
            deleteRequestDir(root, requestDir);
            reject(call, ChatFileExportPolicy.CODE_CANCELLED);
        } catch (RuntimeException refused) {
            deleteRequestDir(root, requestDir);
            reject(call, ChatFileExportPolicy.CODE_INVALID_REQUEST);
        }
    }

    // --- Network copy ------------------------------------------------------

    private File stage(Op op, ParsedRequest request) throws ExportFailure {
        throwIfCancelled(op);
        File directory = new File(getContext().getCacheDir(), CACHE_STAGING_DIR);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
        }
        purgeStaleStaging(directory, request.requestId);
        ensureFreeBytes(directory, request.byteSize);
        File staged = new File(directory, request.requestId + ".part");
        download(op, request, staged);
        return staged;
    }

    /**
     * Removes staging leftovers from a process that died mid-copy. Only this
     * plugin's own {@code .part} files are considered, never the current
     * request's, and only once they are an hour old.
     */
    private static void purgeStaleStaging(File directory, String currentRequestId) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_STAGING_MS;
        for (File file : files) {
            if (!file.isFile()) continue;
            String name = file.getName();
            if (!name.endsWith(".part")) continue;
            if (name.equals(currentRequestId + ".part")) continue;
            long modified = file.lastModified();
            if (modified > 0L && modified < cutoff) file.delete();
        }
    }

    private void download(Op op, ParsedRequest request, File destination) throws ExportFailure {
        HttpsURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        try {
            throwIfCancelled(op);
            URL parsed = new URL(request.url);
            java.net.URLConnection opened = parsed.openConnection();
            if (!(opened instanceof HttpsURLConnection)) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            connection = (HttpsURLConnection) opened;
            op.connection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestMethod("GET");
            // Identity keeps Content-Length equal to the file size, and the
            // plugin never installs a CookieHandler, sets no Authorization or
            // Cookie header, and follows no redirect.
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cache-Control", "no-store");
            connection.connect();
            throwIfCancelled(op);

            int status = connection.getResponseCode();
            if (status >= 300 && status <= 399) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
            }
            if (status == HttpURLConnection.HTTP_NOT_FOUND) {
                throw new ExportFailure(
                    ChatFileExportPolicy.CODE_NOT_FOUND,
                    ChatFileExportPolicy.MESSAGE_FILE_GONE
                );
            }
            if (status < 200 || status > 299) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
            }
            long declared = connection.getContentLengthLong();
            if (declared >= 0 && declared != request.byteSize) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
            }

            long deadline = op.startedAt + TOTAL_TIMEOUT_MS;
            input = connection.getInputStream();
            output = new FileOutputStream(destination);
            byte[] buffer = new byte[BUFFER_SIZE];
            long total = 0L;
            int zeroReads = 0;
            while (true) {
                throwIfCancelled(op);
                if (System.currentTimeMillis() > deadline) {
                    throw ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
                }
                int read = input.read(buffer);
                if (read < 0) break;
                if (read == 0) {
                    if (++zeroReads > MAX_CONSECUTIVE_ZERO_READS) {
                        throw ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
                    }
                    continue;
                }
                zeroReads = 0;
                total += read;
                if (total > request.byteSize) {
                    throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
                }
                output.write(buffer, 0, read);
            }
            output.flush();
            output.getFD().sync();
            output.close();
            output = null;
            if (total != request.byteSize) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
            }
            throwIfCancelled(op);
        } catch (ExportFailure failure) {
            throw failure;
        } catch (SSLException refused) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
        } catch (java.net.SocketTimeoutException refused) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
        } catch (java.net.MalformedURLException refused) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
        } catch (IOException refused) {
            throw op.cancelled.get()
                ? ExportFailure.of(ChatFileExportPolicy.CODE_CANCELLED)
                : ExportFailure.of(ChatFileExportPolicy.CODE_NETWORK_ERROR);
        } catch (RuntimeException refused) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
        } finally {
            if (output != null) {
                try {
                    output.close();
                } catch (IOException ignored) {
                    // Destination cleanup happens in the caller.
                }
            }
            if (input != null) {
                try {
                    input.close();
                } catch (IOException ignored) {
                    // Disconnect below closes the connection.
                }
            }
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (RuntimeException ignored) {
                    // Already finished.
                }
            }
            op.connection = null;
        }
    }

    private long copyExact(File source, OutputStream output, Op op, long expected)
        throws ExportFailure, IOException {
        InputStream input = new FileInputStream(source);
        try {
            byte[] buffer = new byte[BUFFER_SIZE];
            long total = 0L;
            int zeroReads = 0;
            while (true) {
                throwIfCancelled(op);
                int read = input.read(buffer);
                if (read < 0) break;
                if (read == 0) {
                    if (++zeroReads > MAX_CONSECUTIVE_ZERO_READS) {
                        throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
                    }
                    continue;
                }
                zeroReads = 0;
                total += read;
                if (total > expected) {
                    throw ExportFailure.of(ChatFileExportPolicy.CODE_SIZE_MISMATCH);
                }
                output.write(buffer, 0, read);
            }
            return total;
        } finally {
            try {
                input.close();
            } catch (IOException ignored) {
                // The caller verifies the copied count.
            }
        }
    }

    private static void writeFully(
        java.io.FileDescriptor fd, byte[] buffer, int length
    ) throws ExportFailure {
        int offset = 0;
        while (offset < length) {
            int written;
            try {
                written = Os.write(fd, buffer, offset, length - offset);
            } catch (java.io.InterruptedIOException interrupted) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_CANCELLED);
            } catch (ErrnoException refused) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            }
            if (written <= 0) throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
            offset += written;
        }
    }

    private static void throwIfCancelled(Op op) throws ExportFailure {
        if (op.cancelled.get() || Thread.currentThread().isInterrupted()) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_CANCELLED);
        }
    }

    // --- storage helpers ---------------------------------------------------

    private void ensureFreeBytes(File directory, long byteSize) throws ExportFailure {
        try {
            StatFs stat = new StatFs(directory.getAbsolutePath());
            if (stat.getAvailableBytes() < byteSize + STORAGE_HEADROOM_BYTES) {
                throw ExportFailure.of(ChatFileExportPolicy.CODE_INSUFFICIENT_STORAGE);
            }
        } catch (IllegalArgumentException refused) {
            throw ExportFailure.of(ChatFileExportPolicy.CODE_INVALID_REQUEST);
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private static String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(
                uri,
                new String[] { MediaStore.MediaColumns.DISPLAY_NAME },
                null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getString(index);
            }
        } catch (RuntimeException ignored) {
            // MediaStore auto-renamed the row; fall back to the sanitised name.
        }
        return null;
    }

    private File viewRoot() {
        return new File(getContext().getCacheDir(), CACHE_VIEW_DIR);
    }

    private Set<String> activeViewIds() {
        Set<String> ids = new HashSet<>();
        for (Op op : active.values()) {
            if (op.kind == Kind.VIEW) ids.add(op.requestId);
        }
        return ids;
    }

    private void deleteRequestDir(File root, File requestDir) {
        try {
            if (!requestDir.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) {
                return;
            }
            File[] files = requestDir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isFile()) file.delete();
                }
            }
            requestDir.delete();
        } catch (IOException ignored) {
            // Only this operation's own cache directory is ever considered.
        }
    }

    private static void deleteQuietly(File file) {
        if (file == null) return;
        try {
            file.delete();
        } catch (RuntimeException ignored) {
            // Best effort cleanup of bytes this operation created.
        }
    }

    private static void deleteUriQuietly(ContentResolver resolver, Uri uri) {
        try {
            resolver.delete(uri, null, null);
        } catch (RuntimeException ignored) {
            // The pending row can only be ours; a failure leaves it unpublished.
        }
    }

    private void rejectBusy(PluginCall call) {
        call.reject("Another file action is still running.", ChatFileExportPolicy.CODE_INVALID_REQUEST);
    }

    private static void reject(PluginCall call, String code) {
        call.reject(ChatFileExportPolicy.messageFor(code), code);
    }
}
