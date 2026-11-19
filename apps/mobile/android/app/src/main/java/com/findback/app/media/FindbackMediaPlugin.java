package com.findback.app.media;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.view.inputmethod.InputConnectionCompat;
import androidx.core.view.inputmethod.InputContentInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONArray;

/** Native permissionless photo picker/document picker and delegated camera capture. */
@CapacitorPlugin(name = "FindbackMedia")
public final class FindbackMediaPlugin extends Plugin {
    private static final MediaRequestState.Registry REGISTRY = new MediaRequestState.Registry();
    /** Equal to the canonical request-id shape used by the JS admission owner. */
    private static final Pattern REQUEST_ID = Pattern.compile("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}");
    /** Enough of a header to reach the still/animation chunk without decoding. */
    private static final int SNIFF_PREFIX_BYTES = 256 * 1024;
    private final MediaRequestState requests = new MediaRequestState(REGISTRY);
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /**
     * Keyboard insertions keep their own queue: a 20 MB copy must never delay
     * the picker's preparation, and one queue per plugin preserves the order in
     * which the IME committed items.
     */
    private final ExecutorService keyboardWorker = Executors.newSingleThreadExecutor();
    private final KeyboardMediaIntake.Receiver keyboardReceiver = this::receiveKeyboardMedia;

    @PluginMethod public void chooseImage(PluginCall call) {
        String source = call.getString("source", "photos");
        MediaRequestState.Request request = begin(call, source, MediaRequestState.Phase.PICKING);
        if (request == null) return;
        try {
            call.getData().put("mediaRequestId", request.id);
            Intent intent;
            if ("camera".equals(source)) {
                File capture = new File(directory(request.id), "capture.jpg");
                if (!capture.createNewFile()) throw new IllegalStateException("Capture already exists");
                Uri captureUri = captureUri(request.id);
                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
                intent.setClipData(ClipData.newRawUri("Photo", captureUri));
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else if ("photos".equals(source) || "files".equals(source)) {
                if ("photos".equals(source) && Build.VERSION.SDK_INT >= 33) {
                    intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                    intent.setType("image/*");
                } else {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else { throw new IllegalArgumentException("Choose Camera, Photos or Files."); }
            getActivity().runOnUiThread(() -> {
                try { startActivityForResult(call, intent, "imageChosen"); }
                catch (RuntimeException e) { finish(request); call.reject("Couldn't open the device photo picker or camera.", "MEDIA_PICKER_UNAVAILABLE"); }
            });
        } catch (Exception e) {
            finish(request);
            call.reject("Couldn't open the device photo picker or camera.", "MEDIA_PICKER_UNAVAILABLE");
        }
    }
    /**
     * FBX-001: multi-select Photos/Files. Returns the ordered granted content
     * URIs only — no derivative bytes, no original bytes — so the caller imports
     * each one through {@link #importUri} (the same canonical processor the
     * single picker uses). Per-item preparation stays independent: one bad URI
     * never discards its siblings, and selection order is preserved.
     */
    @PluginMethod public void chooseImages(PluginCall call) {
        String source = call.getString("source", "photos");
        if (!"photos".equals(source) && !"files".equals(source)) {
            call.reject("Choose Photos or Files.", "MEDIA_INVALID_SOURCE"); return;
        }
        int limit = call.getInt("limit", 5);
        if (limit < 1) limit = 1;
        MediaRequestState.Request request = begin(call, source, MediaRequestState.Phase.PICKING);
        if (request == null) return;
        try {
            call.getData().put("mediaRequestId", request.id);
            Intent intent;
            // The picker contract on some OEM ROMs reports a max of 0, and any
            // EXTRA_PICK_IMAGES_MAX — including 1 — then makes PhotoPickerActivity
            // finish itself in onCreate with "Invalid EXTRA_PICK_IMAGES_MAX value".
            // The user sees the picker flash and nothing picked. Only advertise a
            // cap the platform actually accepts, and fall back to the document
            // picker when it advertises none.
            int maxPick = MediaStore.getPickImagesMaxLimit();
            if ("photos".equals(source) && Build.VERSION.SDK_INT >= 33 && maxPick >= 2) {
                intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                intent.setType("image/*");
                // Single selection is the picker's default; only ask for a cap
                // when more than one is wanted.
                if (limit > 1) intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(limit, maxPick));
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*" });
                // A persistable grant lets the caller re-open the URI later (draft
                // recovery); photo-picker grants above are session-scoped instead.
                intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            getActivity().runOnUiThread(() -> {
                try { startActivityForResult(call, intent, "imagesChosen"); }
                catch (RuntimeException e) { finish(request); call.reject("Couldn't open the device photo picker.", "MEDIA_PICKER_UNAVAILABLE"); }
            });
        } catch (Exception e) {
            finish(request);
            call.reject("Couldn't open the device photo picker.", "MEDIA_PICKER_UNAVAILABLE");
        }
    }
    @ActivityCallback private void imagesChosen(PluginCall call, ActivityResult result) {
        MediaRequestState.Request request = requests.current();
        // Without the saved call's request id this may be a stale callback. It owns no cleanup.
        if (call == null) return;
        if (request == null || !requests.owns(call.getString("mediaRequestId", ""), MediaRequestState.Phase.PICKING)) {
            call.reject("Photo preparation was interrupted. Please choose the photos again.", "MEDIA_INTERRUPTED"); return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            finish(request);
            JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); call.resolve(cancelled); return;
        }
        List<Uri> uris = collectUris(result);
        if (uris.isEmpty()) {
            finish(request);
            call.reject("Couldn't read these photos. Choose them again.", "MEDIA_INVALID_URI"); return;
        }
        // Attempt persistence for every picker result: the document fallback needs
        // it, and a session-scoped picker grant simply refuses (caught below).
        for (Uri uri : uris) {
            try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (RuntimeException ignored) { /* Some providers refuse persistence; the session grant still applies. */ }
        }
        finish(request);
        JSONArray array = new JSONArray();
        for (Uri uri : uris) array.put(uri.toString());
        JSObject out = new JSObject(); out.put("uris", array); call.resolve(out);
    }
    /** Selection order first (ClipData), else a single data URI. Non-content URIs are dropped. */
    private static List<Uri> collectUris(ActivityResult result) {
        List<Uri> out = new ArrayList<>();
        Intent data = result.getData();
        if (data == null) return out;
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null && "content".equals(uri.getScheme())) out.add(uri);
            }
        }
        if (out.isEmpty()) {
            Uri single = data.getData();
            if (single != null && "content".equals(single.getScheme())) out.add(single);
        }
        return out;
    }
    @ActivityCallback private void imageChosen(PluginCall call, ActivityResult result) {
        MediaRequestState.Request request = requests.current();
        // Without the saved call's request id this may be a stale callback. It owns no cleanup.
        if (call == null) return;
        if (request == null || !requests.owns(call.getString("mediaRequestId", ""), MediaRequestState.Phase.PICKING)) {
            call.reject("Photo preparation was interrupted. Please choose the photo again.", "MEDIA_INTERRUPTED"); return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            finish(request);
            JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); call.resolve(cancelled); return;
        }
        Uri uri = "camera".equals(request.source) ? captureUri(request.id) : result.getData() == null ? null : result.getData().getData();
        if (uri == null || !"content".equals(uri.getScheme())) {
            finish(request); call.reject("Couldn't read this photo. Choose it again.", "MEDIA_INVALID_URI"); return;
        }
        requests.processing(request);
        prepare(call, uri, request);
    }
    @PluginMethod public void importUri(PluginCall call) {
        String raw = call.getString("uri");
        Uri uri = raw == null ? null : Uri.parse(raw);
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getAuthority() == null) { call.reject("Please choose a photo through the device picker.", "MEDIA_INVALID_URI"); return; }
        MediaRequestState.Request request = begin(call, "uri", MediaRequestState.Phase.PROCESSING);
        if (request != null) prepare(call, uri, request);
    }
    private MediaRequestState.Request begin(PluginCall call, String source, MediaRequestState.Phase phase) {
        try { return requests.begin(source, phase); }
        catch (IllegalStateException e) { call.reject("A photo is already being prepared. Please wait.", "MEDIA_BUSY"); return null; }
    }
    private void prepare(PluginCall call, Uri uri, MediaRequestState.Request request) {
        try { worker.execute(() -> {
            try {
                if (request.cancelled) return;
                JSObject derivative = new NativeImageProcessor(getContext().getContentResolver(), directory(request.id)).prepare(uri, call.getBoolean("highQuality", false));
                if (!request.cancelled) call.resolve(derivative);
            } catch (OutOfMemoryError e) {
                if (!request.cancelled) call.reject("Not enough device memory to prepare this photo. Try a smaller JPEG.", "MEDIA_MEMORY_LIMIT");
            } catch (Exception e) {
                // No URI, file paths, source bytes or internal decoder error strings escape.
                String message = e instanceof MediaPolicy.Failure ? e.getMessage() : "Couldn't prepare this photo. Try re-saving it as JPEG or PNG.";
                if (!request.cancelled) call.reject(message, "MEDIA_PREPARATION_FAILED");
            } finally { finish(request); }
        }); } catch (RuntimeException e) { finish(request); call.reject("Photo preparation was interrupted. Please choose the photo again.", "MEDIA_INTERRUPTED"); }
    }

    /**
     * Advertise, replace or withdraw the live composer's ability to receive
     * keyboard/provider images. A different owner always starts a new
     * generation, so a copy that began under the previous conversation can
     * never be published into the new one.
     */
    @PluginMethod public void setKeyboardMediaEligibility(PluginCall call) {
        boolean eligible = Boolean.TRUE.equals(call.getBoolean("eligible", false));
        JSObject out = new JSObject();
        if (!eligible) {
            revokeKeyboard();
            out.put("eligible", false);
            call.resolve(out);
            return;
        }
        String accountId = call.getString("accountId");
        String conversationId = call.getString("conversationId");
        if (accountId == null || accountId.isEmpty() || conversationId == null || conversationId.isEmpty()) {
            // A half-specified owner is never advertised: refuse instead of
            // accepting bytes that cannot be attributed to a conversation.
            revokeKeyboard();
            out.put("eligible", false);
            call.resolve(out);
            return;
        }
        KeyboardMediaState shared = KeyboardMediaState.shared();
        KeyboardMediaState.Owner previous = shared.owner();
        KeyboardMediaState.Owner owner = shared.enable(accountId, conversationId);
        if (previous != null && (!previous.accountId.equals(owner.accountId)
                || !previous.conversationId.equals(owner.conversationId))) {
            discardKeyboard();
        } else {
            sweepKeyboard();
        }
        KeyboardMediaIntake.register(keyboardReceiver);
        out.put("eligible", true);
        call.resolve(out);
    }

    /**
     * Pull one request's bytes in bounded chunks. The request id is the only
     * handle; native owns the path and re-checks the owner generation on every
     * read, so a paused, replaced or destroyed composer cannot read.
     */
    @PluginMethod public void readKeyboardMedia(PluginCall call) {
        final String requestId = call.getString("requestId");
        final Integer offset = call.getInt("offset");
        final Integer length = call.getInt("length");
        if (requestId == null || !REQUEST_ID.matcher(requestId).matches()
                || offset == null || offset < 0
                || length == null || length <= 0 || length > KeyboardMediaState.MAX_CHUNK_BYTES) {
            call.reject("That item is no longer available.", "KEYBOARD_MEDIA_UNAVAILABLE");
            return;
        }
        final int from = offset;
        final int count = length;
        try {
            keyboardWorker.execute(() -> {
                KeyboardMediaState state = KeyboardMediaState.shared();
                KeyboardMediaState.Entry entry = state.find(requestId);
                if (entry == null || !state.authorized(entry) || from + (long) count > entry.byteLength) {
                    call.reject("That item is no longer available.", "KEYBOARD_MEDIA_UNAVAILABLE");
                    return;
                }
                byte[] buffer = new byte[count];
                try (RandomAccessFile file = new RandomAccessFile(entry.file, "r")) {
                    file.seek(from);
                    file.readFully(buffer, 0, count);
                } catch (IOException unavailable) {
                    state.remove(requestId);
                    deleteQuietly(entry.file);
                    call.reject("That item is no longer available.", "KEYBOARD_MEDIA_UNAVAILABLE");
                    return;
                }
                JSObject out = new JSObject();
                out.put("base64", Base64.encodeToString(buffer, Base64.NO_WRAP));
                out.put("nextOffset", from + count);
                out.put("byteLength", entry.byteLength);
                call.resolve(out);
            });
        } catch (RuntimeException stopped) {
            call.reject("That item is no longer available.", "KEYBOARD_MEDIA_UNAVAILABLE");
        }
    }

    @PluginMethod public void releaseKeyboardMedia(PluginCall call) {
        String requestId = call.getString("requestId");
        KeyboardMediaState.Entry entry = requestId == null ? null : KeyboardMediaState.shared().remove(requestId);
        if (entry != null) deleteQuietly(entry.file);
        JSObject out = new JSObject();
        out.put("released", entry != null);
        call.resolve(out);
    }

    /** Called by the host activity before the WebView goes to the background. */
    public void onHostPaused() {
        boolean wasEligible = KeyboardMediaState.shared().eligible();
        revokeKeyboard();
        if (!wasEligible) return;
        JSObject payload = new JSObject();
        payload.put("eligible", false);
        notifyListeners("keyboardMediaEligibility", payload);
    }

    /** Withdraw the capability and reclaim every cached request immediately. */
    private void revokeKeyboard() {
        KeyboardMediaState.shared().disable();
        KeyboardMediaIntake.unregister(keyboardReceiver);
        discardKeyboard();
    }

    /**
     * Entry point for one committed IME item. Runs on the UI thread and returns
     * as soon as the copy is queued; the grant is released by the worker.
     *
     * The admission slot is reserved BEFORE the queue, so the bound covers
     * published, queued and running copies together: a burst of insertions
     * cannot build an unbounded executor queue behind an empty cache. A refused
     * slot is a visible refusal; the WebView then releases its grant once.
     */
    private boolean receiveKeyboardMedia(InputContentInfoCompat content, int flags, Bundle opts) {
        KeyboardMediaState state = KeyboardMediaState.shared();
        if (!state.eligible() || content == null) return false;
        Uri uri = content.getContentUri();
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getAuthority() == null) {
            rejectKeyboard(state.owner(), "unsupported");
            return false;
        }
        sweepKeyboard();
        KeyboardMediaState.Owner owner = state.owner();
        if (owner == null) return false;
        final KeyboardMediaState.Reservation reservation;
        try {
            reservation = state.reserve(owner);
        } catch (KeyboardMediaState.TooManyRequests busy) {
            rejectKeyboard(owner, "busy");
            return false;
        } catch (KeyboardMediaState.NotEligible gone) {
            return false;
        }
        try {
            keyboardWorker.execute(() -> copyKeyboardMedia(owner, reservation, content, flags));
        } catch (RuntimeException stopped) {
            // The task never ran: this is the only release this slot gets.
            state.release(reservation);
            return false;
        }
        return true;
    }

    /**
     * A committed item the reader asked for was refused. Only the live owner is
     * told, so a worker that finishes after a route change, blur or destroy
     * never raises an error in a screen that no longer asked for it.
     */
    private void rejectKeyboard(KeyboardMediaState.Owner owner, String reason) {
        KeyboardMediaState state = KeyboardMediaState.shared();
        if (!state.eligible() || (owner != null && !state.current(owner))) return;
        JSObject payload = new JSObject();
        payload.put("reason", reason);
        notifyListeners("keyboardMediaRejected", payload);
    }

    /**
     * Copy one committed item under the owner captured before the queue. A
     * still is prepared by the canonical native processor (bounded derivative,
     * alpha preserved); animation candidates keep their original frames and
     * are only accepted under the existing private file-lane ceiling. Both are
     * re-sniffed from the copied bytes, so the announcement describes what was
     * actually stored.
     *
     * A stale task (blur, route change, cache clear, destroy) returns before it
     * touches the provider at all. The reservation is released exactly once in
     * {@code finally}: after a successful publish, after every refusal, after a
     * stale early return, and after an ownership change — where the same
     * finally still releases the URI grant.
     */
    private void copyKeyboardMedia(KeyboardMediaState.Owner owner, KeyboardMediaState.Reservation reservation,
                                   InputContentInfoCompat content, int flags) {
        Uri uri = content.getContentUri();
        File produced = null;
        try {
            // Returning from inside the try is what keeps the grant and the
            // physical slot owned: a queued task that lost its owner must not
            // read the provider, but it must still run this finally.
            if (!KeyboardMediaState.shared().current(owner)) return;
            long knownLength = providerLength(uri);
            MediaStreams.Probe probe;
            try (InputStream input = openSource(uri)) {
                probe = MediaStreams.probe(input, knownLength);
            }
            long total = probe.total;
            if (total <= 0) { rejectKeyboard(owner, "unreadable"); return; }
            KeyboardMediaSniff.Info info = KeyboardMediaSniff.sniff(probe.prefix);
            if (info == null || !info.conclusive) {
                info = KeyboardMediaSniff.sniff(readPrefix(uri, SNIFF_PREFIX_BYTES));
            }
            if (info == null || !info.conclusive || info.width <= 0 || info.height <= 0) {
                rejectKeyboard(owner, "unsupported");
                return;
            }
            String requestId = UUID.randomUUID().toString();
            File directory = keyboardDirectory();
            if (info.animated) {
                // Animation keeps its bytes: a decode here would flatten frames.
                if (total > KeyboardMediaState.MAX_ANIMATION_BYTES) { rejectKeyboard(owner, "too-large"); return; }
                File target = new File(directory, requestId + ".bin");
                // The partial file belongs to this worker from the moment it is
                // named: a failed open, a provider read error or the size cap
                // must delete it in finally, never leave it unnamed in cache.
                produced = target;
                long length;
                try (InputStream input = openSource(uri)) {
                    length = KeyboardMediaFiles.store(input, target, KeyboardMediaState.MAX_ANIMATION_BYTES);
                }
                if (length != total) {
                    // Only a preserved animation is compared with the probe: a
                    // truncated, padded or changed source is refused rather
                    // than sent as a shorter animation. A still derivative is
                    // re-encoded, so its length is never the source's.
                    rejectKeyboard(owner, "unreadable");
                    return;
                }
                KeyboardMediaSniff.Info stored = KeyboardMediaSniff.sniff(readFilePrefix(target, SNIFF_PREFIX_BYTES));
                if (stored == null || !stored.animated || stored.kind != info.kind
                        || stored.width != info.width || stored.height != info.height || length <= 0) {
                    rejectKeyboard(owner, "unreadable");
                    return;
                }
                if (publish(owner, reservation, requestId, target, true, info.mime, info.width, info.height, length)) {
                    produced = null;
                } else {
                    rejectKeyboard(owner, "busy");
                }
            } else {
                JSObject derivative = new NativeImageProcessor(getContext().getContentResolver(), directory).prepare(uri, false);
                String encoded = derivative.getString("derivativeBase64");
                String mime = derivative.getString("mimeType");
                int width = derivative.getInt("width");
                int height = derivative.getInt("height");
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                if (bytes.length == 0) { rejectKeyboard(owner, "unreadable"); return; }
                File target = new File(directory, requestId + ".bin");
                // Same rule as the animation branch: the target is owned before
                // the write starts. The derivative is re-encoded, so its length
                // is never compared with the source.
                produced = target;
                KeyboardMediaFiles.store(new ByteArrayInputStream(bytes), target, bytes.length);
                KeyboardMediaSniff.Info stored = KeyboardMediaSniff.sniff(readFilePrefix(target, SNIFF_PREFIX_BYTES));
                if (stored == null || stored.animated || !stored.mime.equals(mime)
                        || stored.width != width || stored.height != height) {
                    rejectKeyboard(owner, "unreadable");
                    return;
                }
                if (publish(owner, reservation, requestId, target, false, mime, width, height, bytes.length)) {
                    produced = null;
                } else {
                    rejectKeyboard(owner, "busy");
                }
            }
        } catch (Exception | OutOfMemoryError refused) {
            // Nothing was published: tell the live owner the item was refused
            // instead of leaving the insert silently doing nothing.
            rejectKeyboard(owner, "unreadable");
        } finally {
            if (produced != null) deleteQuietly(produced);
            releaseKeyboardGrant(content, flags);
            KeyboardMediaState.shared().release(reservation);
        }
    }

    private boolean publish(KeyboardMediaState.Owner owner, KeyboardMediaState.Reservation reservation,
                            String requestId, File file, boolean animated,
                            String mime, int width, int height, long length) {
        KeyboardMediaState.Entry entry;
        try {
            // Transfer this worker's own slot into the entry in one step. The
            // item was already counted by reserve(), so its own slot can never
            // refuse it and the entry is never counted twice; the finally
            // release of the transferred token is then a no-op.
            entry = KeyboardMediaState.shared().add(requestId, owner, reservation, file, animated, mime,
                    width, height, length, System.currentTimeMillis());
        } catch (KeyboardMediaState.TooManyRequests | KeyboardMediaState.NotEligible
                 | IllegalArgumentException refused) {
            return false;
        }
        JSObject payload = new JSObject();
        payload.put("requestId", entry.id);
        payload.put("kind", animated ? "animation" : "still");
        payload.put("mime", entry.mime);
        payload.put("width", entry.width);
        payload.put("height", entry.height);
        payload.put("byteLength", entry.byteLength);
        notifyListeners("keyboardMedia", payload);
        return true;
    }

    private static void releaseKeyboardGrant(InputContentInfoCompat content, int flags) {
        if ((flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) == 0) return;
        try { content.releasePermission(); } catch (Exception ignored) { /* already lapsed */ }
    }

    private void sweepKeyboard() {
        for (KeyboardMediaState.Entry entry : KeyboardMediaState.shared().sweep(System.currentTimeMillis())) {
            deleteQuietly(entry.file);
        }
    }

    private void discardKeyboard() {
        for (KeyboardMediaState.Entry entry : KeyboardMediaState.shared().clear()) deleteQuietly(entry.file);
    }

    private static void deleteQuietly(File file) {
        try { if (file != null) file.delete(); } catch (RuntimeException ignored) { /* cache cleanup is best effort */ }
    }

    private InputStream openSource(Uri uri) throws IOException {
        InputStream input = getContext().getContentResolver().openInputStream(uri);
        if (input == null) throw new IOException("This item isn't available.");
        return input;
    }

    /** Provider length hint, or -1 when it has none; same rule as the photo intake. */
    private long providerLength(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) {
                    long size = cursor.getLong(index);
                    if (size >= 0) return size;
                }
            }
        } catch (RuntimeException ignored) { /* the counting probe is the backstop */ }
        return -1;
    }

    private byte[] readPrefix(Uri uri, int maximum) {
        try (InputStream input = openSource(uri)) {
            byte[] buffer = new byte[maximum];
            int at = 0;
            while (at < maximum) {
                int read = input.read(buffer, at, maximum - at);
                if (read < 0) break;
                at += read;
            }
            return at == buffer.length ? buffer : Arrays.copyOf(buffer, at);
        } catch (IOException refused) {
            return new byte[0];
        }
    }

    private static byte[] readFilePrefix(File file, int maximum) {
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[maximum];
            int at = 0;
            while (at < maximum) {
                int read = input.read(buffer, at, maximum - at);
                if (read < 0) break;
                at += read;
            }
            return at == buffer.length ? buffer : Arrays.copyOf(buffer, at);
        } catch (IOException refused) {
            return new byte[0];
        }
    }

    private File keyboardDirectory() throws IOException {
        File directory = new File(getContext().getCacheDir(), "findback-keyboard");
        if (!directory.isDirectory() && !directory.mkdir() && !directory.isDirectory()) {
            throw new IOException("Couldn't prepare temporary media storage");
        }
        return directory;
    }

    private File directory(String id) throws java.io.IOException {
        File directory = new File(getContext().getCacheDir(), "findback-media-" + id);
        if (!directory.isDirectory() && !directory.mkdir()) throw new java.io.IOException("Couldn't prepare temporary photo storage");
        return directory;
    }
    private Uri captureUri(String id) {
        File capture = new File(new File(getContext().getCacheDir(), "findback-media-" + id), "capture.jpg");
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", capture);
    }
    private void finish(MediaRequestState.Request request) { if (requests.finish(request)) cleanup(request.id); }
    private void cleanup(String id) {
        // This path is request-specific. Never sweep cache or delete another live worker's file.
        File directory = new File(getContext().getCacheDir(), "findback-media-" + id);
        try { getContext().revokeUriPermission(captureUri(id), Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        catch (RuntimeException ignored) { /* No grant may exist for Photos/Files. */ }
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) {
            if (file.getName().equals("capture.jpg") || file.getName().matches("findback-media-still-[A-Za-z0-9_-]+\\.jpg")) file.delete();
        }
        directory.delete();
    }
    @Override protected Bundle saveInstanceState() {
        Bundle state = super.saveInstanceState();
        if (state == null) state = new Bundle();
        Bundle media = saveMediaRequestState();
        if (media != null) state.putAll(media);
        return state;
    }
    /** Also called by the host: Capacitor doesn't save non-activity importUri work itself. */
    public Bundle saveMediaRequestState() {
        MediaRequestState.Snapshot saved = requests.snapshot();
        if (saved == null) return null;
        Bundle state = new Bundle();
        state.putString("mediaRequestId", saved.id);
        state.putString("mediaSource", saved.source);
        state.putString("mediaPhase", saved.phase.name());
        return state;
    }
    @Override protected void restoreState(Bundle state) { restoreMediaRequestState(state); }
    public void restoreMediaRequestState(Bundle state) {
        String phase = state.getString("mediaPhase");
        if (phase == null) return;
        try {
            String abandoned = requests.restore(new MediaRequestState.Snapshot(state.getString("mediaRequestId"), state.getString("mediaSource"), MediaRequestState.Phase.valueOf(phase)));
            if (abandoned != null) cleanup(abandoned);
        } catch (IllegalArgumentException ignored) { /* Ignore invalid saved state, never invent a busy operation. */ }
    }
    @Override protected void handleOnDestroy() {
        // Processing always finishes its own cleanup, even when its result is cancelled on restore.
        MediaRequestState.Request request = requests.current();
        if (!getActivity().isChangingConfigurations() && request != null && requests.owns(request.id, MediaRequestState.Phase.PICKING)) finish(request);
        revokeKeyboard();
        worker.shutdown();
        keyboardWorker.shutdown();
    }
}
