import { useEffect, useRef, useState } from "react";
import { FileText, Film, ImagePlus, Plus, X } from "lucide-react";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { ComposerShell } from "./ComposerShell";
import { CommentReportPicker } from "./CommentReportPicker";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { insertEmoji } from "./EmojiPicker";
import { KlipyPicker } from "./KlipyPicker";
import { UserAvatar } from "./UserAvatar";
import { MentionAutocomplete, type MentionCandidate } from "./MentionAutocomplete";
import {
  COMMENT_ATTACH_ACCEPT,
  COMMENT_ATTACH_MAX,
  COMMENT_REPORTS_ENABLED,
  createCommentAttachment,
  createKlipyAttachment,
  importCommentPhotoFromNativeUri,
  isNativeCommentPhotoIntakeAvailable,
  removeCommentAttachment,
  uploadCommentAttachment,
  validateAttachableFile,
  type CommentAttachment,
} from "../services/commentAttachments";
import { isKlipyEnabled, klipyCustomerId, trackKlipyShare, type KlipyItem, type KlipyKind } from "../services/klipy";
import {
  appendBodyMedia,
  bodyHasInlineData,
  commentMediaProvenance,
  MAX_COMMENT_BODY,
} from "../services/commentBodyMedia";
import type { CommentAttachmentDescriptor } from "../services/posts";
import { ApiError } from "../services/session";
import { friendlyError } from "../utils/friendlyErrors";
import { interactionRefusalCopy } from "../utils/interactionRefusal";

/**
 * C3 compact social comment composer: avatar + expandable input + send icon.
 *
 * - `@` mentions through the shared `MentionAutocomplete` (ranked
 *   participants > owner > server fallback, keyboard nav, caret insertion),
 *   anchored to the composer, keyboard/touch safe.
 * - Emoji through the shared `EmojiPicker` inside `EmojiPickerButton` (owner
 *   order 2026-11-12, R5), inserted at the caret. The panel is the same one
 *   the conversation and assistant composers mount.
 * - Photo attach only (packet `08` §7): new video intake is stopped at the
 *   picker's accept list and the client gate, while every stored video row
 *   keeps rendering. On Android photos come through the canonical native
 *   intake (`FindbackMedia` multi-pick + per-URI import, FBX-038); every other
 *   runtime uses the deliberate file-input path whose preview is a `blob:`
 *   object-URI and whose upload streams bytes to Storage under the caller's
 *   own folder (same RLS path as report photos) with progress / retry /
 *   remove and the shared `COMMENT_ATTACH_MAX` cap. The comment body carries
 *   only `https://` remote URLs — never base64.
 * - GIF/Sticker through the shared `KlipyPicker` on its own visible
 *   "Stickers and GIFs" control (never buried in the attachment menu) behind
 *   the `VITE_KLIPY_API_KEY` config flag: stable customer_id, high content filter,
 *   "Search KLIPY" placeholder, provider URLs/data preserved and loaded
 *   directly, share-tracking only after the comment posts, "Powered by
 *   KLIPY" attribution. The control is hidden entirely when the key is
 *   absent.
 */

/**
 * Packet `08` §21 failure copy. The consumer sentence is fixed — the raw
 * mapper message is never shown (it can carry provider/transport text). An
 * offline device or an expired session is the one case where a plain "try
 * again" would be a lie, so the sentence gains that single instruction.
 *
 * The interaction-limit guard's refusals are the other case, and they get their
 * own sentence from the shared vocabulary instead of the fixed one: the standing
 * refusal (a zero limit) must not be answered with an invitation to try again,
 * and a spent day is not a transport failure. This is R3-delta's N-4.
 */
function commentSendFailureCopy(err: unknown, hasReport: boolean): string {
  // P0002 also names a missing parent. Never ask a text-only sender to remove
  // a reference they do not have. With a staged reference retain §13.7's copy.
  if (hasReport && err instanceof ApiError && err.code === "P0002") {
    return "Report unavailable — remove the reference to post your comment.";
  }
  const refusal = interactionRefusalCopy(err);
  if (refusal) return refusal;
  switch (friendlyError(err).code) {
    case "OFFLINE":
      return "Couldn't post your comment. Check your connection and try again.";
    case "AUTH":
      return "Couldn't post your comment. Your session expired. Please sign in again.";
    default:
      return "Couldn't post your comment. Try again.";
  }
}

/** Packet `08` §21 upload copy; the strip appends "Retry or remove it to send." */
function commentUploadFailureCopy(err: unknown): string {
  return friendlyError(err).code === "OFFLINE"
    ? "Couldn't upload this photo. Check your connection and try again."
    : "Couldn't upload this photo.";
}

export interface CommentComposerProps {  postId: string;
  replyToUsername?: string | null;
  currentUser?: { id?: string | null; username?: string | null; avatarUrl?: string | null } | null;
  participants: MentionCandidate[];
  owner?: MentionCandidate | null;
  disabled?: boolean;
  /**
   * Parent writes the comment (addComment + list append). May throw.
   * Body carries text + `https://` media lines (legacy readers); the
   * optional ordered descriptors feed the atomic
   * `findback_add_comment_with_attachments` RPC (FB-AUD-02). Body-only
   * callers stay valid — the second arg is optional.
   */
  onSubmit: (body: string, attachments?: CommentAttachmentDescriptor[]) => Promise<void>;
  /** Parent surfaces failures inline (actionError + announce pattern). */
  onError: (message: string) => void;
  /** Parent clears reply affordances after a successful post. */
  onSent?: () => void;
  /**
   * Increment to put the caret in the field. The report's comment action uses
   * it after opening or scrolling to the conversation, so the reader can type
   * at once instead of hunting for the box.
   */
  focusSignal?: number;
  /**
   * A printable character typed while the report surface had focus. The report
   * viewer hands the first keystroke to the comment field instead of letting it
   * start a global search (owner direction 2026-11-18).
   */
  typingSeed?: { char: string; nonce: number } | null;
}

/**
 * Map staged composer entries to ordered RPC descriptors in tile order
 * (FB-AUD-02). Only `uploaded` entries with an `https://` remote URL travel
 * — pending/failed entries never reach the RPC (send stays disabled until
 * they resolve). `blob:` previews stay local and are never sent (the RPC
 * requires https). A Klipy sticker pick (local kind `gif` with `klipyKind:
 * "stickers"`) maps to the RPC `sticker` kind.
 *
 * Lives beside the composer (not in services/posts) so screens that mock
 * the posts service keep a working composer: the service only forwards
 * descriptors opaquely, while PostDetail imports just the descriptor type.
 */
type StagedReportAttachment = {
  id: string;
  kind: "report";
  status: "uploaded";
  reportPostId: string;
  title: string;
};
type ComposerAttachment = CommentAttachment | StagedReportAttachment;

function attachmentReady(a: ComposerAttachment): boolean {
  return a.status === "uploaded" && (a.kind === "report"
    ? Boolean(a.reportPostId)
    : typeof a.remoteUrl === "string" && a.remoteUrl.startsWith("https://"));
}

export function toCommentAttachmentDescriptors(
  attachments: readonly ComposerAttachment[],
): CommentAttachmentDescriptor[] {
  return attachments
    .filter(attachmentReady)
    .map((a, index) => {
      // Deliberately construct only these keys; report references have no bytes,
      // URLs or provenance, even if an upstream object accidentally carries them.
      if (a.kind === "report") return {
        kind: "report", display_order: index + 1, report_post_id: a.reportPostId,
      };
      const descriptor: CommentAttachmentDescriptor = {
        kind: a.kind === "gif" && a.klipyKind === "stickers" ? "sticker" : a.kind,
        display_order: index + 1,
        remote_url: a.remoteUrl as string,
      };
      if (a.objectKey) descriptor.storage_key = a.objectKey;
      if (a.klipySlug) descriptor.klipy_slug = a.klipySlug;
      if (a.klipyKind) descriptor.klipy_kind = a.klipyKind;
      if (a.previewUrl.startsWith("https://")) descriptor.preview_url = a.previewUrl;
      if (a.mimeType) descriptor.mime_type = a.mimeType;
      if (a.fileName) descriptor.file_name = a.fileName;
      return descriptor;
    });
}

export function CommentComposer({
  postId,
  replyToUsername = null,
  currentUser = null,
  participants,
  owner = null,
  disabled = false,
  onSubmit,
  onError,
  onSent,
  focusSignal = 0,
  typingSeed = null,
}: CommentComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const attachmentActionsRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const photoIntakeRef = useRef(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifTab, setGifTab] = useState<KlipyKind>("gifs");
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef(new Map<string, File>());
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const submittedRef = useRef(false);
  const gifEnabled = isKlipyEnabled();

  // Mirror staged entries for the abandon sweep below (an unmount cleanup
  // closure cannot read state at unmount time).
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // FB-AUD-04: pick → upload completes → leave page without submit must not
  // orphan the Storage object (no typed row exists yet, so no server
  // cleanup can find it). Best-effort fire-and-forget sweep on unmount,
  // reusing the same helper explicit Remove uses (`removeCommentAttachment`
  // only deletes local-upload keys and never throws). Row-referenced keys
  // after a successful submit are never swept: success sets the submitted
  // flag and clears the strip, so the sweep sees nothing to delete.
  useEffect(
    () => () => {
      if (submittedRef.current) return;
      const staged = attachmentsRef.current.filter(
        (a): a is CommentAttachment => a.kind !== "report" && a.status === "uploaded" && Boolean(a.objectKey && a.remoteUrl),
      );
      for (const entry of staged) {
        void removeCommentAttachment(entry).then(undefined, () => undefined);
      }
    },
    [],
  );

  // The report's comment action owns the intent, so the field takes the caret
  // even when the composer just mounted inside the phone's conversation sheet.
  const handledFocus = useRef(0);
  useEffect(() => {
    if (focusSignal <= 0 || focusSignal === handledFocus.current) return;
    handledFocus.current = focusSignal;
    fieldRef.current?.focus();
  }, [focusSignal]);

  // Typing anywhere on the report surface starts the comment, never a search.
  const handledTyping = useRef(0);
  useEffect(() => {
    const seed = typingSeed;
    if (!seed || seed.nonce === handledTyping.current) return;
    handledTyping.current = seed.nonce;
    const field = fieldRef.current;
    if (!field) return;
    const wasFocused = document.activeElement === field;
    field.focus();
    const start = wasFocused ? field.selectionStart ?? text.length : text.length;
    const end = wasFocused ? field.selectionEnd ?? start : text.length;
    const inserted = insertEmoji(text, start, end, seed.char);
    setText(inserted.text);
    focusAt(inserted.caret);
  }, [typingSeed, text]);

  function focusAt(caret: number) {
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // setSelectionRange is best-effort (hidden/disabled fields).
      }
    });
  }

  function handleMentionInsert(next: string, caret: number) {
    setText(next);
    focusAt(caret);
  }

  function handleEmojiPick(glyph: string) {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? start;
    const inserted = insertEmoji(text, start, end, glyph);
    setText(inserted.text);
    focusAt(inserted.caret);
  }

  function patchAttachment(id: string, patch: Partial<CommentAttachment>) {
    setAttachments((prev) => prev.map((a) => (a.kind !== "report" && a.id === id ? { ...a, ...patch } : a)));
  }

  async function startUpload(entry: CommentAttachment, file: File) {
    patchAttachment(entry.id, { status: "uploading", progress: 0, error: undefined });
    try {
      const { remoteUrl, objectKey } = await uploadCommentAttachment(entry, file, {
        postId,
        onProgress: (p) => {
          const ratio = p.total > 0 ? Math.min(1, p.loaded / p.total) : 0;
          patchAttachment(entry.id, { progress: ratio });
        },
      });
      patchAttachment(entry.id, { status: "uploaded", progress: 1, remoteUrl, objectKey });
    } catch (err) {
      patchAttachment(entry.id, {
        status: "failed",
        error: commentUploadFailureCopy(err),
      });
    }
  }

  function addFiles(fileList: FileList | File[]) {
    if (photoIntakeRef.current) return;
    const picked = [...fileList];
    if (picked.length === 0) return;
    setAttachNotice(null);
    const room = COMMENT_ATTACH_MAX - attachments.length;
    if (room <= 0) {
      setAttachNotice(`Comments hold up to ${COMMENT_ATTACH_MAX} attachments. Remove one first.`);
      return;
    }
    let denied: string | null = null;
    for (const file of picked.slice(0, room)) {
      const problem = validateAttachableFile(file);
      if (problem) {
        denied = problem;
        continue;
      }
      const entry = createCommentAttachment(file);
      filesRef.current.set(entry.id, file);
      setAttachments((prev) => [...prev, entry]);
      void startUpload(entry, file);
    }
    if (picked.length > room) {
      setAttachNotice(`Comments hold up to ${COMMENT_ATTACH_MAX} attachments. Remove one first.`);
    } else if (denied) {
      setAttachNotice(denied);
    }
  }

  function retryAttachment(entry: CommentAttachment) {
    const file = filesRef.current.get(entry.id);
    if (!file) {
      patchAttachment(entry.id, { status: "failed", error: "That file is no longer available." });
      return;
    }
    void startUpload(entry, file);
  }

  // FBX-038: photos prefer the canonical native intake on Android
  // (permissionless multi-pick, per-URI preparation so one bad item never
  // discards its siblings, cancel is a silent no-op). Every other runtime
  // uses the deliberate file-input streaming path below. The bridge
  // is dynamically imported so the composer load graph never touches the
  // plugin registry (see commentAttachments).
  async function pickNativePhotos() {
    const room = COMMENT_ATTACH_MAX - attachments.length;
    if (room <= 0) {
      setAttachNotice(`Comments hold up to ${COMMENT_ATTACH_MAX} attachments. Remove one first.`);
      return;
    }
    setAttachNotice(null);
    let uris: string[] | null;
    try {
      const { chooseNativeImages } = await import("../services/media/nativeMedia");
      uris = await chooseNativeImages({ source: "photos", limit: room });
    } catch (err) {
      // Broken bridge must not strand the user: fall back to the file input.
      setAttachNotice(friendlyError(err).message);
      fileInputRef.current?.click();
      return;
    }
    if (!uris || uris.length === 0) return;
    let failed = 0;
    for (const uri of uris.slice(0, room)) {
      try {
        const { entry, file } = await importCommentPhotoFromNativeUri(uri);
        filesRef.current.set(entry.id, file);
        setAttachments((prev) => [...prev, entry]);
        void startUpload(entry, file);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      setAttachNotice(
        failed >= uris.length
          ? "Those photos couldn't be prepared. Try them again or pick different ones."
          : "Some photos couldn't be prepared. The rest are uploading.",
      );
    }
  }

  async function handleAttachClick() {
    if (disabled || sending || photoIntakeRef.current) return;
    // Reserve the tray during native chooser/preparation, before any awaits.
    // Otherwise a report/GIF can take a slot promised to a pending photo.
    photoIntakeRef.current = true;
    setPreparingPhotos(true);
    setReportOpen(false);
    setGifOpen(false);
    try {
      if (await isNativeCommentPhotoIntakeAvailable()) {
        await pickNativePhotos();
      } else {
        fileInputRef.current?.click();
      }
    } finally {
      photoIntakeRef.current = false;
      setPreparingPhotos(false);
    }
  }

  async function removeAttachment(entry: ComposerAttachment) {
    if (disabled || sending) return;
    filesRef.current.delete(entry.id);
    setAttachments((prev) => prev.filter((a) => a.id !== entry.id));
    if (entry.kind !== "report") await removeCommentAttachment(entry);
    else fieldRef.current?.focus();
  }

  function closeReportPicker() {
    setReportOpen(false);
    attachmentActionsRef.current?.querySelector("button")?.focus();
  }

  function pickReport(report: { id: string; title: string }) {
    if (photoIntakeRef.current) return;
    setAttachments((prev) => {
      if (prev.length >= COMMENT_ATTACH_MAX || prev.some((a) => a.kind === "report" && a.reportPostId === report.id)) return prev;
      return [...prev, { id: `report-${report.id}`, kind: "report", status: "uploaded", reportPostId: report.id, title: report.title }];
    });
    closeReportPicker();
    fieldRef.current?.focus();
  }

  function pickGif(item: KlipyItem) {
    if (photoIntakeRef.current) return;
    if (attachments.length >= COMMENT_ATTACH_MAX) {
      setAttachNotice(`Comments hold up to ${COMMENT_ATTACH_MAX} attachments. Remove one first.`);
      return;
    }
    const entry = createKlipyAttachment({
      slug: item.slug,
      kind: item.kind,
      mediaUrl: item.mediaUrl,
      previewUrl: item.previewUrl,
      title: item.title,
    });
    setAttachments((prev) => [...prev, entry]);
    setGifOpen(false);
    fieldRef.current?.focus();
  }

  const uploading = attachments.some((a) => a.status === "uploading");
  const failed = attachments.filter((a): a is CommentAttachment => a.kind !== "report" && a.status === "failed");
  const readyToPost = attachments.filter(attachmentReady);
  const readyMedia = readyToPost.filter((a): a is CommentAttachment => a.kind !== "report");
  const pendingLocal = attachments.filter((a) => a.status === "ready" || a.status === "uploading");
  const bodyPreview = appendBodyMedia(
    text,
    readyMedia.map((a) => ({ kind: a.kind, remoteUrl: a.remoteUrl as string })),
  );
  const overLimit = bodyPreview.length > MAX_COMMENT_BODY;
  const sendDisabled =
    disabled ||
    sending ||
    preparingPhotos ||
    uploading ||
    pendingLocal.length > 0 ||
    failed.length > 0 ||
    overLimit ||
    attachments.length > COMMENT_ATTACH_MAX ||
    (text.trim() === "" && readyToPost.length === 0);

  async function onSend() {
    if (sendDisabled) return;
    // Free-text paste guard: attachments travel as `https://` remote URLs, so
    // a pasted `data:` URL in the text would inline base64 into the body
    // (payload bloat that never renders as gallery media). Block with copy —
    // never silently strip user content, and never allow it under the length
    // cap (no wont-fix: even small payloads break the https-only invariant).
    if (bodyHasInlineData(text)) {
      onError(
        "That text holds pasted image data. Remove it and attach the photo instead so it uploads cleanly.",
      );
      return;
    }
    const body = appendBodyMedia(
      text,
      readyMedia.map((a) => ({ kind: a.kind, remoteUrl: a.remoteUrl as string })),
    );
    const descriptors = toCommentAttachmentDescriptors(readyToPost);
    if ((body.trim() === "" && descriptors.length === 0) || body.length > MAX_COMMENT_BODY) return;
    // Snapshot Klipy picks for post-only share-tracking.
    const shares = readyMedia
      .filter((a) => a.kind === "gif" && a.klipySlug)
      .map((a) => ({ kind: a.klipyKind ?? ("gifs" as const), slug: a.klipySlug as string }));
    setSending(true);
    setReportOpen(false);
    try {
      // Ordered descriptors for the atomic RPC travel alongside the body
      // (the body keeps its https media lines for legacy readers). A
      // body-only send stays a single-arg call so existing callers observe
      // no change.
      if (descriptors.length > 0) {
        await onSubmit(body, descriptors);
      } else {
        await onSubmit(body);
      }
      // Share-tracking only on post: the comment exists server-side now.
      const customerId = klipyCustomerId(currentUser?.id);
      for (const s of shares) {
        void trackKlipyShare(s.kind, s.slug, customerId);
      }
      // Mark committed BEFORE clearing: the abandon sweep must never touch
      // keys that are now row-referenced server-side.
      submittedRef.current = true;
      for (const a of attachments) {
        if (a.kind !== "report" && a.previewUrl.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(a.previewUrl);
          } catch {
            // Best-effort.
          }
        }
      }
      filesRef.current.clear();
      setAttachments([]);
      setText("");
      setAttachNotice(null);
      onSent?.();
    } catch (err) {
      onError(commentSendFailureCopy(err, descriptors.some((a) => a.kind === "report")));
    } finally {
      setSending(false);
    }
  }

  // The adjacent reply context names the target. Keep the field guidance short
  // enough to remain readable at large text; its accessible name stays full.
  const placeholder = replyToUsername ? "Reply…" : "Write…";
  const attachmentActions: MenuAction[] = [
    { id: "photo", label: "Photo", icon: <ImagePlus size={18} aria-hidden />, onAction: () => void handleAttachClick() },
    ...(COMMENT_REPORTS_ENABLED ? [{ id: "report", label: "Report", icon: <FileText size={18} aria-hidden />,
      disabled: attachments.length >= COMMENT_ATTACH_MAX,
      onAction: () => { setReportOpen(true); setGifOpen(false); } }] : []),
  ];

  return (
    <div data-testid="comment-composer" className="fb-comment-composer">
      <span className="fb-comment-composer-avatar">
        <UserAvatar avatarUrl={currentUser?.avatarUrl} username={currentUser?.username} size={32} />
      </span>
      <div className="relative min-w-0 flex-1">
          <input
            ref={fileInputRef}
            data-testid="comment-file-input"
            type="file"
            accept={COMMENT_ATTACH_ACCEPT}
            multiple
            disabled={disabled || sending}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              addFiles(files);
            }}
            className="sr-only"
            tabIndex={-1}
          />
          {overLimit && (
            <span data-testid="comment-limit-hint" role="status" className="ml-auto text-[11px] text-error">
              {bodyPreview.length}/{MAX_COMMENT_BODY} — shorten text or remove media
            </span>
          )}
        {COMMENT_REPORTS_ENABLED && reportOpen && (
          <CommentReportPicker disabled={disabled || sending || attachments.length >= COMMENT_ATTACH_MAX}
            onPick={pickReport} onClose={closeReportPicker} />
        )}

        {preparingPhotos && <p role="status" className="mt-1 text-xs text-on-surface-variant">Preparing photos…</p>}
        {attachNotice && (
          <p data-testid="comment-attach-notice" role="status" className="mt-1 text-[11px] text-on-surface-variant">
            {attachNotice}
          </p>
        )}
        {failed.length > 0 && (
          <p data-testid="comment-attach-error" role="alert" className="mt-1 text-[11px] text-error">
            {failed[0]?.error ?? "An attachment failed."} Retry or remove it to send.
          </p>
        )}

        {/* Attachment tiling: grid in display_order (tile position =
            display_order 1..4), each tile carrying its kind/provenance chip.
            Same previews, progress, retry, and remove controls as before. */}
        <ComposerShell value={text} onChange={setText} onSend={() => void onSend()}
          inputRef={fieldRef} placeholder={placeholder}
          inputLabel={replyToUsername ? `Reply to ${replyToUsername}` : "Comment"}
          inputProps={{ "data-testid": "comment-input" } as React.TextareaHTMLAttributes<HTMLTextAreaElement>}
          disabled={disabled} busy={sending} canSend={!sendDisabled}
          sendLabel={replyToUsername ? "Send reply" : "Send comment"} sendTestId="comment-send"
          inputOverlay={<MentionAutocomplete inputRef={fieldRef} value={text} participants={participants} owner={owner} onInsert={handleMentionInsert} />}
          actions={<div ref={attachmentActionsRef} className="flex items-center">
            <ActionMenu label="Add attachment" icon={<Plus size={20} aria-hidden />}
              disabled={disabled || sending || preparingPhotos} items={attachmentActions} />
            {gifEnabled && <button type="button" aria-label="Stickers and GIFs"
              className="fb-icon-control" disabled={disabled || sending || preparingPhotos || attachments.length >= COMMENT_ATTACH_MAX}
              onClick={() => { setGifTab("gifs"); setGifOpen(true); setReportOpen(false); }}>
              <Film size={20} aria-hidden="true" />
            </button>}
            <EmojiPickerButton onPick={handleEmojiPick} disabled={disabled || sending} />
          </div>}
          attachments={attachments.length > 0 && (
          <div
            data-testid="comment-attachments"
            role="group"
            aria-label={`Attachments, ${attachments.length} of ${COMMENT_ATTACH_MAX}`}
            className="fb-comment-attachment-grid mt-1 grid gap-1.5"
          >
            {attachments.map((a, index) => {
              if (a.kind === "report") return (
                <div key={a.id} className="col-span-full flex min-w-0 items-center gap-2 border-b border-outline-variant py-1 text-on-surface">
                  <FileText size={16} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 break-words text-xs">{a.title}</span>
                  <button type="button" aria-label={`Remove report: ${a.title}`} disabled={disabled || sending}
                    onClick={() => void removeAttachment(a)}
                    className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-surface-container disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-on-surface">
                    <X size={16} aria-hidden />
                  </button>
                </div>
              );
              const source =
                a.kind === "gif" ? ("klipy" as const) : a.remoteUrl ? commentMediaProvenance(a.remoteUrl) : null;
              return (
              <figure
                key={a.id}
                data-testid={`comment-attachment-${a.id}`}
                data-status={a.status}
                className="relative w-full"
              >
                {a.kind === "video" && a.previewUrl !== "" ? (
                  <video
                    src={a.previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={a.fileName}
                    className="h-[96px] w-full rounded-m3-xs border border-outline-variant object-cover"
                  />
                ) : a.previewUrl !== "" ? (
                  <img
                    src={a.previewUrl}
                    alt={a.fileName}
                    loading="lazy"
                    className="h-[96px] w-full rounded-m3-xs border border-outline-variant object-cover"
                  />
                ) : (
                  <span
                    role="img"
                    aria-label={a.fileName}
                    className="flex h-[96px] w-full items-center justify-center rounded-m3-xs border border-outline-variant bg-surface-container-low text-xs text-on-surface-variant"
                  >
                    {a.fileName}
                  </span>
                )}
                <span
                  data-testid={`comment-attachment-order-${a.id}`}
                  aria-hidden
                  className="pointer-events-none absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                >
                  {index + 1}
                </span>
                {source && (
                  <span
                    data-testid={`comment-attachment-source-${a.id}`}
                    data-provenance={source}
                    className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  >
                    {source === "klipy" ? "KLIPY" : a.kind === "video" ? "Video" : "Photo"}
                  </span>
                )}
                {a.status === "uploading" && (
                  <span
                    data-testid={`comment-attachment-progress-${a.id}`}
                    role="progressbar"
                    aria-label={`Uploading ${a.fileName}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(a.progress * 100)}
                    className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-m3-xs bg-surface-container-high"
                  >
                    <span
                      className="block h-full bg-on-surface transition-[width]"
                      style={{ width: `${Math.max(8, Math.round(a.progress * 100))}%` }}
                    />
                  </span>
                )}
                {a.status === "failed" && (
                  <button
                    type="button"
                    data-testid={`comment-attachment-retry-${a.id}`}
                    onClick={() => retryAttachment(a)}
                    aria-label={`Retry attaching ${a.fileName}`}
                    className="absolute inset-x-0 bottom-0 flex min-h-[44px] items-center justify-center rounded-b-m3-xs border border-outline-variant bg-surface-container-high text-xs font-semibold text-error"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`comment-attachment-remove-${a.id}`}
                  disabled={disabled || sending}
                  onClick={() => void removeAttachment(a)}
                  aria-label={`Remove ${a.fileName}`}
                  className="absolute -right-2 -top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-outline-variant bg-surface text-on-surface shadow"
                >
                  <X size={16} aria-hidden />
                </button>
              </figure>
              );
            })}
          </div>
        )} />

        {gifEnabled && gifOpen && (
          <div className="fb-picker-layer">
            <KlipyPicker
              userId={currentUser?.id}
              initialTab={gifTab}
              testIdPrefix="comment-gif"
              onPick={pickGif}
              onClose={() => setGifOpen(false)}
              onDismiss={() => { setGifOpen(false); attachmentActionsRef.current?.querySelector("button")?.focus(); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
