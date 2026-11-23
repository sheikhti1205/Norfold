import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { motion, type PanInfo } from "framer-motion";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { Archive, ArrowLeft, BellOff, ChevronDown, ChevronUp, Film, Flag, ImageOff, Images, Info, ListFilter, LogOut, MapPin, Maximize2, PanelLeftClose, PanelLeftOpen, Pin, RefreshCw, Search, Settings2, ShieldBan, Trash2, UserRound, X } from "lucide-react";
import { Button, Dialog, DialogTrigger } from "react-aria-components";
import { Capacitor } from "@capacitor/core";
import type { PostItem } from "@norfold/shared";
import { copyStaticLocation, isUuid } from "../services/messaging/validation";
import { clearConversationDraft, readConversationDraft, writeConversationDraft } from "../services/conversationDrafts";
import { subscribeSafetyChanged } from "../services/safetySignals";
import { onRealtime } from "../services/realtime";
import { useAuth } from "../auth";
import { UserAvatar } from "../components/UserAvatar";
import { ChatIdentity } from "../components/ChatIdentity";
import { PostLink } from "../components/PostNavigation";
import { formatChatDay, timeAgo } from "../utils/dates";
import { klipyPreviewLabel, messagePreview } from "../utils/messagePreview";
import { haptic } from "../utils/haptics";
import { convertEmoticons, isEmojiOnly } from "../utils/emoji";
import { isStandalonePreviewBody } from "../utils/chatPreviewBody";
import { klipyMessageBody, klipyMessageKind, klipyMessageUrl } from "../services/klipy";
import type { KlipyItem } from "../services/klipy";
import {
  chatFileBody, chatFileCaption, chatFilePreview, parseChatFileMarker, removeChatFile, uploadChatFile, validateChatFile,
} from "../services/messaging/files";
import { ChatFile, isDocumentChatFile } from "../components/ChatFile";
import { ChatMessageText } from "../components/ChatMessageText";
import { ChatReportPreview } from "../components/ChatReportPreview";
import { isBareKlipyMediaBody, isChatFileMarkerBody, messageCopyActions } from "../utils/messageCopy";
import { SplitView, type SplitPaneState } from "../components/SplitView";
import { CHAT_PANE, type PaneBounds } from "../components/panePreference";
import { registerBackInterceptor } from "../components/backNavigation";
import { CHATS_PATH, isChatThreadPath } from "../components/BackButtonHandler";
import { modalLayerCount, useAnyModalLayerOpen } from "../hooks/modalLayers";
import { ChatDetailsLayout } from "../components/ChatDetailsLayout";
import { BlockControl } from "../components/BlockControl";
import { useHoverLabel } from "../components/HoverLabel";
import { PreferenceSwitchRow } from "../components/settings";
import { ActionMenu, type MenuAction, type MenuGroup } from "../components/ActionMenu";
import { LongPressArea } from "../components/LongPressArea";
import { AppBar } from "../components/AppBar";
import { TopUtilities } from "../components/TopUtilities";
import { MEDIUM_MAX_PX, useContentWidth, useRootFontPx, useViewportWidth } from "../components/responsive";
import { LayeredPopover } from "../components/overlayFoundation";
import { layeredPopoverMaxHeight } from "../components/popoverViewportCap";
import { PeopleSearch } from "../components/PeopleSearch";
import { PeerChatComposer } from "../components/PeerChatComposer";
import { CameraCapture } from "../components/CameraCapture";
import { ChatLocationComposer } from "../components/ChatLocationComposer";
import { AdaptiveTaskSurface, ConfirmDialog } from "../components/AdaptiveTaskSurface";
import { ReportSheet } from "../components/ReportSheet";
import { MediaViewer, type MediaViewerItem } from "../components/MediaViewer";
import { VoiceMessagePlayer, VoiceRecordingPanel } from "../components/VoiceNote";
import { useMediaUrl } from "../services/media/privateMedia";
import { announce } from "../components/LiveRegion";
import { shouldReduceMotion } from "../components/uiMotion";
import { fetchAccountIdentities, readCachedAccountIdentities } from "../services/accountLabels";
import { fetchPost } from "../services/posts";
import { useMessaging } from "../services/messaging/useMessaging";
import { BackupPrompt } from "../components/BackupPrompt";
import {
  changeMessagingRelationship, markMessagingConversationRead, readMessagingThreadState, getCachedMessagingThreadState,
  refreshMessaging, retryMessagingMedia, sendMessagingText, sendMessagingLocation, sendMessagingMedia, sendMessagingVoice, clearMessagingConversation, removeMessagingMessage,
  fetchMessagingReceiptView, observeMessagingReceipt, readMessagingMedia, downloadMessagingMedia, recoverMessagingText,
  retryMessagingMessage, setMessagingMuted, pinMessagingMessage, watchMessagingThread,
  readMessagingUnsentHold, readMessagingUnsentHoldIds, purgeMessagingUnsentHold,
} from "../services/messaging/runtime";
import type { MediaAttachment, OutboxEntry, StaticLocation, StoredHumanMessage } from "../services/messaging/history";
import type { ConversationProjection } from "../services/messaging/conversationIndex";
import { prepareMessagingPhoto, type PreparedMessagingPhoto } from "../services/messaging/preparePhoto";
import { buildMediaRuns, splitSmallMediaRuns } from "../services/messaging/mediaRuns";
import {
  classifyClipboardImage, createKeyboardMediaSession, readClipboardAnimation,
  type KeyboardMediaSession, type VerifiedKeyboardMedia,
} from "../services/messaging/keyboardMedia";
import { sha256Hex, VOICE_SENTINEL_EDGE, type MediaMetadata, type MediaMime } from "../services/messaging/media";
import {
  browserVoiceDeps, createVoiceRecorder, voiceRecordingSupported,
  type VoiceRecorderPort, type VoiceRecorderState, type VoiceRecording,
} from "../services/messaging/voiceRecorder";
import {
  browserVoicePlaybackPorts, createVoicePlayback, voiceProgressPercent,
  type VoicePlaybackPort, type VoicePlaybackSnapshot,
} from "../services/messaging/voicePlayback";
import { storedVoiceMime, VOICE_MAX_MS } from "../services/messaging/voice";
import { PhotoUnavailableError } from "../services/messaging/mediaTransport";
import { chooseNativeImage, chooseNativeImages, importNativeImageUri, importedImageToFile } from "../services/media/nativeMedia";
import { FOLLOW_PX, JUMP_PX, useTranscriptAnchor } from "../hooks/useTranscriptAnchor";
import "./Messaging.css";

/**
 * A photo that is the whole message: no caption, quote, report, location or
 * status control. It owns the bubble's padding and fill so the picture sits
 * flush with its rounded edge, while every content or control state keeps the
 * ordinary padded bubble. CSS additionally requires the picture to exist, so a
 * loading, missing or downloadable photo keeps the in-flow status row it needs.
 */
export function isMediaOnlyMessage(message: {
  unsentAt?: number;
  messageType?: string;
  server?: unknown;
  body?: string;
  replyToId?: string;
  contextReportId?: string;
  location?: unknown;
}, attachment: { state: string } | undefined, status: { actionable: boolean }): boolean {
  if (message.unsentAt !== undefined || message.messageType !== "MEDIA" || !message.server) return false;
  if (message.body || message.replyToId || message.contextReportId || message.location) return false;
  // Retry, Remove, Review, Sending and saved-failure states stay in the padded
  // bubble: a control or an honest sentence is never painted over the picture.
  if (status.actionable) return false;
  return !attachment || attachment.state === "READY" || attachment.state === "EVICTED";
}

/**
 * Read state as ticks, not words.
 *
 * One check means the server accepted the message; two means the peer's device
 * has read it. The label carries the meaning for assistive tech, because the
 * glyph alone is not content.
 */
function ReceiptTicks({ read }: { read: boolean }) {
  return <span className={read ? "fb-chat-ticks is-read" : "fb-chat-ticks"} role="img"
    aria-label={read ? "Read" : "Sent"} title={read ? "Read" : "Sent"}>
    <svg viewBox="0 0 21 12" width="19" height="11" aria-hidden="true" focusable="false">
      <path d="M1.4 6.6 4.5 9.7 11.4 2.3" />
      {read && <path d="M8.4 9.7 15.3 2.3" />}
    </svg>
  </span>;
}

/** Live report subject for a report-linked message. Only the id travels with the
 * message; readability is resolved here, so a later-hidden report reads
 * "Report unavailable" instead of showing a stale private snapshot. In a
 * message every state keeps the canonical report route as a link, so a body
 * whose only content was the URL still navigates instead of going dead. */
export function ChatReportContext({ reportId, preview = false, safetyKey = "" }: {
  reportId: string;
  preview?: boolean;
  /**
   * The caller's current relationship/concealment state for this conversation.
   * A block in this tab must revoke a loaded preview, not wait for a focus
   * event, so a changed key starts a fresh session instead of keeping a
   * snapshot that was read under the previous authority.
   */
  safetyKey?: string;
}) {
  return <ReportContextSession key={`${reportId}:${safetyKey}`} reportId={reportId} preview={preview} />;
}

function ReportContextSession({ reportId, preview }: { reportId: string; preview: boolean }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "unavailable"; post?: PostItem }>({ status: "loading" });
  useEffect(() => {
    let generation = 0, cancelled = false;
    const refresh = () => {
      const request = ++generation;
      setState({ status: "loading" });
      void fetchPost(reportId).then((post) => {
        if (cancelled || request !== generation) return;
        // fetchPost is not exclusion-only: it can return a public row the reader
        // has blocked and leave concealment to presentation. A chat preview has
        // no shield, so a blocked report is unavailable here — never a title,
        // photo or place.
        setState(post.blockedAuthor === true ? { status: "unavailable" } : { status: "ready", post });
      }).catch(() => { if (!cancelled && request === generation) setState({ status: "unavailable" }); });
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    // A block made in this tab (the quick card, a profile) must revoke what is
    // already on screen even when the peer's own projection is unrelated: the
    // subject here may be a third person's report.
    const unsubscribe = subscribeSafetyChanged(refresh);
    // The canonical feed channel already carries every report UPDATE/DELETE,
    // including moderation. Do not open one private room per history preview
    // (rooms are shared with detail); invalidate only this report's subject.
    const offPost = onRealtime("feed:changed", payload => {
      if (payload.postId === reportId) refresh();
    });
    refresh(); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true; unsubscribe(); offPost();
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reportId]);
  const firstImageUrl =
    state.status === "ready"
      ? state.post?.attachments?.find((attachment) => attachment.mimeType.startsWith("image/"))?.fileUrl
      : undefined;
  const firstImageSrc = useMediaUrl(firstImageUrl);
  const reportRoute = `/posts/${encodeURIComponent(reportId)}`;
  if (preview && state.status !== "ready") return <span className="fb-chat-row-context">{state.status === "loading" ? "Loading report…" : "Report unavailable"}</span>;
  // Loading and unavailable are still the report: the canonical route stays one
  // reachable link and no title, photo or place is invented before authority
  // resolves.
  if (state.status !== "ready") return <PostLink className="fb-chat-report-preview fb-chat-report-preview-state"
    to={reportRoute} data-chat-report={state.status}>
    <span className="fb-chat-report-preview-media" aria-hidden="true" />
    <span className="fb-chat-report-preview-copy">{state.status === "loading" ? "Loading report…" : "Report unavailable"}</span>
  </PostLink>;
  const post = state.post!;
  if (preview) return <span className="fb-chat-row-context" dir="auto">{post.type === "LOST" ? "Lost" : "Found"} report · {post.title}</span>;
  return <ChatReportPreview post={post} reportId={reportId} coverSrc={firstImageSrc} />;
}

/** One static coordinate set the sender chose to share. No live position. */
export function ChatLocation({ location }: { location: StaticLocation }) {
  const lat = location.lat.toFixed(5), lng = location.lng.toFixed(5);
  return <div className="fb-chat-location" data-chat-location>
    <MapPin size={17} aria-hidden="true" />
    <div>
      <p>Location shared</p>
      <p className="fb-chat-secondary">{lat}, {lng}{location.accuracy !== null ? ` · device estimate ${Math.max(1, Math.round(location.accuracy))} m` : ""}</p>
    </div>
    <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
      target="_blank" rel="noreferrer noopener">Open map</a>
  </div>;
}

function useLabels(accountId: string, peerIds: string[]) {
  const key = [...new Set(peerIds)].sort().join(",");
  const [labels, setLabels] = useState(() => readCachedAccountIdentities(accountId, peerIds));
  useEffect(() => {
    let cancelled = false;
    setLabels(readCachedAccountIdentities(accountId, key ? key.split(",") : []));
    if (key) void fetchAccountIdentities(accountId, key.split(",")).then((next) => {
      if (!cancelled) setLabels(next);
    }).catch(() => undefined); // Missing labels never imply a deleted account.
    return () => { cancelled = true; };
  }, [accountId, key]);
  return labels;
}

/** Own module so the visual fixture route can render it without the runtime. */
export { ChatIdentity } from "../components/ChatIdentity";

// A media task is another view of ChatPhoto, not another ready-byte cache.
function ignorePhotoReadiness() {}

/**
 * An attachment is a separate record from the message, so a message can render
 * before its media has synced. Keep a short loading window for that race, then
 * say plainly that it did not arrive — an endless "loading…" on a two-hour-old
 * voice note reads as a broken app.
 */
const ATTACHMENT_ARRIVAL_GRACE_MS = 2 * 60_000;

function missingAttachmentStale(message: StoredHumanMessage): boolean {
  if (message.messageType !== "MEDIA" && message.messageType !== "VOICE") return false;
  // With no creation time there is no honest way to call it late; keep waiting.
  return message.createdAt !== undefined && Date.now() - message.createdAt > ATTACHMENT_ARRIVAL_GRACE_MS;
}

function missingAttachmentCopy(message: StoredHumanMessage): string {
  if (message.messageType !== "MEDIA" && message.messageType !== "VOICE") return "Message unavailable";
  const stale = missingAttachmentStale(message), voice = message.messageType === "VOICE";
  if (voice) return stale ? "Voice message unavailable" : "Voice message loading…";
  return stale ? "Photo unavailable" : "Photo loading…";
}

/**
 * A reply gesture mirrors the direction the bubble already points: your own
 * bubble travels right-to-left, a received one left-to-right. The threshold is
 * the same 72 px the notification rows use, so a swipe means one thing here.
 */
export const REPLY_SWIPE_PX = 72;

export function replySwipeFor(offsetX: number, own: boolean): boolean {
  return own ? offsetX <= -REPLY_SWIPE_PX : offsetX >= REPLY_SWIPE_PX;
}

/**
 * The relationship facts the screen may *show* while a routine refresh sits
 * between authoritative sets (owner direction 2026-11-19).
 *
 * The runtime publishes `displayProjections`, the last accepted set, retained
 * only so a row, badge, label or header does not disappear for the length of a
 * focus/visibility/online pass. It is never permission: every send, read,
 * receipt, media, block/end/archive/clear gate keeps reading
 * `currentProjections` and `threadSync`.
 *
 * Order of truth:
 * - a non-null accepted set is the freshest relation this account holds, so it
 *   answers first;
 * - then the published display, which only bridges the pass that revoked it;
 * - when the field is absent (fixtures and older snapshots), the previous
 *   behaviour, `current ?? cached`;
 * - when the field is explicitly `null` (offline, error, account switch, and
 *   every relationship or preference mutation), nothing is shown from a stale
 *   set: a cached CONNECTED projection is NOT a fallback.
 */
export function presentationProjection(chat: {
  accountId: string | null;
  currentProjections?: Readonly<Record<string, ConversationProjection>> | null;
  displayProjections?: Readonly<Record<string, ConversationProjection>> | null;
}, accountId: string, conversationId: string, cached?: ConversationProjection | null): ConversationProjection | null {
  if (chat.accountId !== accountId) return null;
  const current = chat.currentProjections?.[conversationId];
  if (current) return current;
  const display = chat.displayProjections;
  if (display === undefined) return cached ?? null;
  if (display === null) return null;
  return display[conversationId] ?? null;
}

/** What a quoted message is called when the quoted row itself has no text. */
export function replyPreview(message: StoredHumanMessage): string {
  if (message.unsentAt !== undefined) return "Message unsent";
  if (message.messageType === "MEDIA") return "Photo";
  if (message.messageType === "VOICE") return "Voice message";
  if (message.messageType === "LOCATION") return "Location";
  // A Klipy message is one bare media URL; prose that merely contains one is
  // still quoted exactly, and the link is never mistaken for the message. The
  // label is the app's canonical preview copy: a new send proves its kind,
  // history that predates the marker says "Sticker/GIF" instead of a guess.
  if (isBareKlipyMediaBody(message.body)) return klipyPreviewLabel(klipyMessageKind(message.body));
  // A file message is a marker in the body; quote its name, never the payload.
  const file = chatFilePreview(message.body);
  if (file) return file;
  // A reserved marker that does not parse (malformed, truncated or a future
  // version) is still opaque: quote its family name rather than its payload.
  if (isChatFileMarkerBody(message.body)) return "File";
  return message.body;
}

/** A grouped album never paints more than the four cells it was designed for. */
const MEDIA_RUN_VISIBLE_LIMIT = 4;

/**
 * What one album of media rows calls itself. The label names only what the run
 * actually holds, so a mixed selection never reads as "3 photos" when one of
 * them is a video.
 */
export function mediaRunLabel(messages: readonly StoredHumanMessage[]): string {
  let photos = 0, videos = 0;
  for (const message of messages) {
    if (message.messageType === "MEDIA") photos += 1;
    else videos += 1;
  }
  const photoCopy = `${photos} photo${photos === 1 ? "" : "s"}`;
  const videoCopy = `${videos} video${videos === 1 ? "" : "s"}`;
  if (photos > 0 && videos > 0) return `${photoCopy} and ${videoCopy}`;
  return photos > 0 ? photoCopy : videoCopy;
}

function RetrySync({ accountId, labelled = false }: { accountId: string; labelled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const { hoverLabel } = useHoverLabel();
  return <>
    <button className={labelled ? "fb-chat-info-row" : "fb-chat-icon"} type="button" aria-label={labelled ? undefined : "Sync messages"} disabled={busy}
      {...(labelled ? {} : hoverLabel("Sync messages"))}
      onClick={() => {
        setBusy(true); setError(false);
        void refreshMessaging(accountId).catch(() => setError(true)).finally(() => setBusy(false));
      }}><RefreshCw size={19} aria-hidden="true" className={busy ? "fb-chat-refreshing" : ""} />{labelled && <span>Sync messages</span>}</button>
    {error && <span role="status" className="fb-chat-secondary">Could not sync.</span>}
  </>;
}

/**
 * The width/height the shared photo bounds divide by. CSS cannot divide two
 * lengths inside a custom property, so the numeric ratio travels alongside the
 * intrinsic `aspectRatio`; a zero, negative or non-finite pair falls back to a
 * square instead of leaking `NaN` into `calc()`.
 */
function chatPhotoRatio(attachment: { width: number; height: number }): number {
  const ratio = attachment.width / attachment.height;
  // A stored shape is the only geometry a loading cell may reserve. A row with
  // no usable dimensions keeps the classic 4:3 photo box instead of collapsing
  // to its status text and reflowing the moment the bitmap paints.
  return attachment.width > 0 && attachment.height > 0 && Number.isFinite(ratio) ? ratio : 4 / 3;
}

function ChatPhoto({ accountId, conversationId, attachment, onOpen, onReady, overflowCount }: {
  accountId: string; conversationId: string; attachment: MediaAttachment;
  onOpen: (id: string, bytes: ArrayBuffer, mime: string) => void;
  onReady: (id: string, content: { bytes: ArrayBuffer; mime: string } | null) => void;
  /** Members an album holds beyond its four cells; only the last cell carries it. */
  overflowCount?: number;
}) {
  const [content, setContent] = useState<{ url: string; bytes: ArrayBuffer } | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "failed" | "unavailable">("loading");
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  // Reading and verifying the stored bytes is the expensive part, not painting
  // the bitmap. A long thread must not read every photo on open, so the read
  // starts when the cell approaches the viewport. Without an observer (jsdom),
  // read immediately.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near) return;
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: "600px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  const canDownload = attachment.expiresAt !== null && attachment.expiresAt !== undefined
    && attachment.expiresAt > Date.now()
    && (attachment.direction === "IN" || ["READY", "EVICTED", "AWAITING_ACK"].includes(attachment.state));
  useEffect(() => {
    if (!near) return;
    let cancelled = false, url: string | null = null;
    setContent(null); setLoaded(false);
    onReady(attachment.id, null);
    if (attachment.state === "EVICTED") { setState(attachment.expiresAt !== null && attachment.expiresAt <= Date.now() ? "unavailable" : "missing"); return; }
    setState("loading");
    void readMessagingMedia(accountId, attachment.id).then((bytes) => {
      if (cancelled) return;
      if (!bytes) { setState("missing"); return; }
      const copy = bytes.slice(0);
      url = URL.createObjectURL(new Blob([copy], { type: attachment.mime }));
      setContent({ url, bytes: copy });
      onReady(attachment.id, { bytes: copy, mime: attachment.mime });
    }).catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; onReady(attachment.id, null); if (url) URL.revokeObjectURL(url); };
  }, [near, accountId, attachment.id, attachment.mime, attachment.state, attachment.expiresAt, version, onReady]);
  async function download() {
    setState("loading");
    try { await downloadMessagingMedia(accountId, conversationId, attachment.id); setVersion((v) => v + 1); }
    catch (error) { setState(error instanceof PhotoUnavailableError ? "unavailable" : "failed"); }
  }
  const ratio = chatPhotoRatio(attachment);
  // The base control carries one label; the counted album cell names the real
  // hidden total.
  const openLabel = overflowCount && overflowCount > 0 ? `View photo, ${overflowCount} more` : "View photo";
  return <div ref={host} className="fb-chat-photo" data-loading={content && !loaded ? "true" : undefined}
    style={{ aspectRatio: String(ratio), "--fb-chat-photo-ratio": ratio } as CSSProperties}>
    {content ? <>
      <button type="button" aria-label={openLabel}
        onClick={() => onOpen(attachment.messageId, content.bytes, attachment.mime)}>
        <img src={content.url} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => { onReady(attachment.id, null); setContent(null); setState("failed"); }}
          data-receipt-message={loaded && attachment.state === "READY" ? attachment.messageId : undefined} />
      </button>
    </> : <div role="status">{state === "loading" ? "Photo loading…" : state === "failed" ? "Could not load photo." : "Photo unavailable"}
      {canDownload && (state === "missing" || state === "failed") && <button type="button" onClick={() => void download()}>Download again</button>}
    </div>}
  </div>;
}

/** A quoted photo keeps a real preview: the same stored bytes as a small thumb. */
function ChatQuotePhoto({ accountId, attachment }: { accountId: string; attachment: MediaAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    void readMessagingMedia(accountId, attachment.id).then((bytes) => {
      if (cancelled || !bytes) return;
      created = URL.createObjectURL(new Blob([bytes.slice(0)], { type: attachment.mime }));
      setUrl(created);
    }).catch(() => undefined);
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [accountId, attachment.id, attachment.mime]);
  return url ? <img className="fb-chat-quote-thumb" src={url} alt="" loading="lazy" decoding="async" />
    : <span className="fb-chat-quote-thumb" aria-hidden="true" />;
}

/**
 * One voice note in the transcript. Bytes come from the same verified store as
 * a photo; playback is delegated to the single transcript player so starting a
 * second note pauses the first. A length shown here is the stored duration, not
 * a container guess (WebM often reports `Infinity`).
 */
function ChatVoice({ accountId, conversationId, attachment, playback, snapshot, authorName, avatarUrl }: {
  accountId: string; conversationId: string; attachment: MediaAttachment;
  playback: VoicePlaybackPort; snapshot: VoicePlaybackSnapshot;
  authorName?: string | null; avatarUrl?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed" | "unavailable">("loading");
  const [version, setVersion] = useState(0);
  const [rate, setRate] = useState(1);
  const durationMs = attachment.durationMs ?? 0;
  const canDownload = attachment.expiresAt !== null && attachment.expiresAt !== undefined
    && attachment.expiresAt > Date.now()
    && (attachment.direction === "IN" || ["READY", "EVICTED", "AWAITING_ACK"].includes(attachment.state));
  useEffect(() => {
    let cancelled = false, made: string | null = null;
    setUrl(null);
    if (attachment.state === "EVICTED") {
      setState(attachment.expiresAt !== null && attachment.expiresAt <= Date.now() ? "unavailable" : "missing");
      return;
    }
    setState("loading");
    void readMessagingMedia(accountId, attachment.id).then((bytes) => {
      if (cancelled) return;
      if (!bytes) { setState("missing"); return; }
      made = URL.createObjectURL(new Blob([bytes.slice(0)], { type: attachment.mime }));
      setUrl(made);
      // The player loads metadata on demand; the stored duration is what the
      // clock shows, so no decode is required to call it ready.
      setState("ready");
    }).catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [accountId, attachment.id, attachment.mime, attachment.state, attachment.expiresAt, version]);
  async function download() {
    setState("loading");
    try { await downloadMessagingMedia(accountId, conversationId, attachment.id); setVersion((value) => value + 1); }
    catch (error) { setState(error instanceof PhotoUnavailableError ? "unavailable" : "failed"); }
  }
  const playing = snapshot.playingId === attachment.id;
  // The element keeps the note it holds while paused or ended, so the clock
  // below is this bubble's whenever it owns `currentId`. A stranger's playback
  // withholds the clock rather than painting that note's position here.
  const ownsPosition = (snapshot.currentId ?? snapshot.playingId) === attachment.id;
  const position = ownsPosition ? Math.min(snapshot.positionMs, durationMs) : undefined;
  async function toggle() {
    if (!url) return;
    if (playing) { playback.pause(); return; }
    if (!playback.load(attachment.id, url, durationMs)) return;
    playback.setRate(rate);
    await playback.play();
  }
  return <div data-receipt-message={state === "ready" && attachment.state === "READY" ? attachment.messageId : undefined}>
    <VoiceMessagePlayer playing={playing} ready={!!url} durationMs={durationMs} positionMs={position}
      avatar={<UserAvatar username={authorName} avatarUrl={avatarUrl} size={40} />}
      onToggle={() => void toggle()} rate={rate} onRate={() => {
        const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
        setRate(next); playback.setRate(next);
      }} />
    {state !== "ready" && <span className="fb-chat-voice-state" role="status">
      {state === "loading" ? "Voice loading…" : state === "failed" ? "Could not load voice." : state === "unavailable" ? "Voice unavailable" : "Voice not on this device"}
      {canDownload && (state === "missing" || state === "failed") && <button type="button" onClick={() => void download()}>Download again</button>}
    </span>}
  </div>;
}

/**
 * The composer's voice lifecycle: opening, live timer, review/preview and the
 * one honest failure sentence. The timer subscribes here so a 200 ms tick only
 * repaints this strip, never the transcript behind it.
 */
function VoiceDraft({ recorder, status, recording, notice, url, snapshot, sending, allowed,
  onStop, onResume, onDiscard, onSend, onPreview }: {
  recorder: VoiceRecorderPort; status: VoiceRecorderState["status"]; recording: VoiceRecording | null;
  notice: string | null; url: string | null; snapshot: VoicePlaybackSnapshot; sending: boolean; allowed: boolean;
  onStop: () => void; onResume: () => void; onDiscard: () => void; onSend: () => void; onPreview: () => void;
}) {
  // The capture clock, never the preview clock. It is the recorder's monotonic
  // elapsed time, and it outlives `pausing`: a container flush takes a moment,
  // and flashing the strip back to 0:00 while it lands reads as a lost take.
  // Only a take that ended or failed clears it.
  const [captureElapsed, setCaptureElapsed] = useState(0);
  useEffect(() => {
    if (status === "idle" || status === "error") { setCaptureElapsed(0); return; }
    if (recorder.state.status === "recording") {
      setCaptureElapsed(recorder.state.elapsedMs);
    }
    return recorder.subscribe((next) => {
      if (next.status === "recording") setCaptureElapsed(next.elapsedMs);
    });
  }, [recorder, status]);
  if (status === "idle") return null;
  if (status === "error") return <div className="fb-chat-voice-draft" role="status">
    <span>{notice ?? "That recording didn’t save. Try again."}</span>
    <button type="button" onClick={onDiscard}>Dismiss</button>
  </div>;
  if (status === "starting") return <div className="fb-chat-voice-draft" role="status">
    <span>Opening microphone…</span>
    <button type="button" onClick={onDiscard}>Cancel</button>
  </div>;
  if (status === "review" && recording) {
    const playing = snapshot.playingId === "voice-draft";
    // The preview clock is this take's only while the element holds it; a
    // stranger's playback withholds it and the panel keeps its own last tick.
    const ownsPosition = (snapshot.currentId ?? snapshot.playingId) === "voice-draft";
    const position = ownsPosition ? Math.min(snapshot.positionMs, recording.durationMs) : undefined;
    // The minute sweep and the ceiling always read the recorded take.
    return <>
      <VoiceRecordingPanel phase="review" playing={playing} positionMs={position}
        durationMs={recording.durationMs} elapsedMs={recording.durationMs}
        percent={voiceProgressPercent(position ?? 0, recording.durationMs)}
        captureElapsedMs={recording.durationMs} captureLimitMs={VOICE_MAX_MS}
        previewReady={!!url} canResume={recorder.canResume} sending={sending} allowed={allowed}
        onPreview={onPreview} onPause={onStop} onResume={onResume} onDiscard={onDiscard} onSend={onSend} />
      {recording.durationMs >= VOICE_MAX_MS && <p className="fb-chat-voice-limit" role="status">
        5-minute limit reached. Send this note, or discard it and record another.
      </p>}
    </>;
  }
  return <VoiceRecordingPanel phase={status === "pausing" ? "pausing" : "recording"}
    elapsedMs={captureElapsed} percent={0} playing={false}
    captureElapsedMs={captureElapsed} captureLimitMs={VOICE_MAX_MS}
    sending={sending} allowed={allowed}
    onPreview={onPreview} onPause={onStop} onResume={onResume} onDiscard={onDiscard} onSend={onSend} />;
}

/**
 * The conversation list is a column of names, previews and times, so its
 * comfortable width is a text measure, not a fixed pixel count. `CHAT_PANE`'s
 * track was authored at the 16px root; at a larger text scale the same pixels
 * hold fewer characters, and at a 200% root the 320px default wrapped a
 * five-letter name one glyph per line between the 44px avatar and the time.
 * Scaling the bounds by the root size keeps the character measure the pane was
 * designed for, and `SplitView`'s existing viability sum then falls back to the
 * single routed pane whenever the window cannot hold that measure beside a real
 * thread. At a 16px root every number is unchanged; the collapsed rail holds
 * avatars rather than text, so it keeps its pixels.
 */
export function chatPaneBounds(rootFontPx: number): PaneBounds {
  const scale = Number.isFinite(rootFontPx) && rootFontPx > 0 ? rootFontPx / 16 : 1;
  const scaled = (value: number) => (scale === 1 ? value : Math.round(value * scale));
  return {
    ...CHAT_PANE,
    defaultWidth: scaled(CHAT_PANE.defaultWidth),
    minWidth: scaled(CHAT_PANE.minWidth),
    maxWidth: scaled(CHAT_PANE.maxWidth),
  };
}

export function Connections() {
  const { user } = useAuth();
  const { conversationId } = useParams();
  const width = useViewportWidth();
  // A reader who enlarges text keeps the screen open, so the bounds have to
  // follow the live root size rather than a mount-time snapshot.
  const rootFontPx = useRootFontPx();
  const pane = useMemo(() => chatPaneBounds(rootFontPx), [rootFontPx]);
  // On a wide window the app utilities belong to the content side (top-right),
  // never inside the conversation sidebar. Phones keep them in the list page's
  // own top bar, where that page is the whole app.
  const showAppUtilities = width >= MEDIUM_MAX_PX;
  return user ? <SplitView selected={!!conversationId}
    pane={{ ...pane, label: "Resize conversation list" }}
    list={(pane) => <ConnectionsSession key={user.id} accountId={user.id} selectedId={conversationId} pane={pane} />}
    detail={conversationId ? <Outlet /> : <div className="fb-chat-empty">
      {showAppUtilities && <div className="fb-chat-empty-utilities"><TopUtilities /></div>}
      <h2>Choose a conversation</h2><p>Open a chat, or search for someone to message.</p>
    </div>} /> : null;
}

/** Replace, rather than stack a duplicate legacy screen in navigation history. */
export function LegacyChatsRedirect() {
  const { conversationId } = useParams();
  const location = useLocation();
  return <Navigate replace to={{ pathname: conversationId ? `/chats/${encodeURIComponent(conversationId)}` : "/chats", search: location.search, hash: location.hash }} />;
}

/** Collapsed conversation pane: the same people in the same order, as an avatar
 * rail. Every conversation the full list shows stays reachable here; names,
 * previews and counts leave the rail, the count survives in the link's
 * accessible name, and the expand control is the only chrome it needs. */
export function ChatRail({ rows, labels, identities, selectedId, onExpand, headingRef, toggleRef }: {
  rows: { conversationId: string; peerId: string; unreadCount: number }[];
  labels: Map<string, string>;
  identities?: ReturnType<typeof readCachedAccountIdentities>;
  selectedId?: string;
  onExpand: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  toggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { hoverLabel } = useHoverLabel();
  return <section className="fb-chat-page fb-chat-rail" aria-label="Chats">
    <header className="fb-chat-header fb-chat-rail-header">
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">Chats</h1>
      <button ref={toggleRef} type="button" className="fb-chat-icon" aria-label="Expand conversation list" onClick={onExpand} {...hoverLabel("Expand conversation list")}>
        <PanelLeftOpen size={20} aria-hidden="true" />
      </button>
    </header>
    <ul className="fb-chat-rail-list">
      {rows.map((row) => {
        const name = labels.get(row.peerId);
        const unread = row.unreadCount;
        const person = identities?.get(row.peerId);
        // The whole tile, avatar and name included, opens the chat. A profile is
        // reached from the conversation header, not from the list.
        return <li key={row.conversationId} className="fb-chat-rail-item">
          <span className="fb-chat-rail-identity" aria-hidden="true">
            <UserAvatar username={name} avatarUrl={person?.avatarUrl} size={40} shape="squircle" />
          </span>
          {unread > 0 && <span className="fb-chat-rail-unread" aria-hidden="true" />}
          <Link to={`/chats/${row.conversationId}`} className="fb-chat-rail-row"
            aria-current={selectedId === row.conversationId ? "page" : undefined}
            aria-label={`Open conversation with ${name || "member"}${unread > 0 ? `, ${unread} unread` : ""}`}
            title={name || "Member"} />
        </li>;
      })}
    </ul>
  </section>;
}

function ConnectionsSession({ accountId, selectedId, pane }: {
  accountId: string; selectedId?: string; pane?: SplitPaneState;
}) {
  const chat = useMessaging();
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const paneToggle = useRef<HTMLButtonElement>(null);
  const paneSettled = useRef(false);
  const { hoverLabel } = useHoverLabel();
  const identities = useLabels(accountId, chat.conversations.map((row) => row.peerId));
  const labels = new Map([...identities].map(([id, person]) => [id, person.displayName || person.username]));
  useEffect(() => { heading.current?.focus(); }, []);
  // Collapsing swaps the header control for the rail's expand button; keep the
  // keyboard where the user was rather than dropping focus to the document.
  useEffect(() => {
    if (!paneSettled.current) { paneSettled.current = true; return; }
    paneToggle.current?.focus({ preventScroll: true });
  }, [pane?.collapsed]);
  // One backup ticker per open Chat surface; it stops when the last one closes.
  // The badge is presentation: a routine refresh revokes authority for one pass,
  // and a request count must not flicker. Nothing here grants an action.
  const requests = chat.conversations.filter(row => {
    const shown = presentationProjection(chat, accountId, row.conversationId, row.cachedProjection);
    return !!shown && !shown.ownHidden && !shown.ownDeclined
      && shown.mode === "REQUEST" && shown.request === "INCOMING";
  }).length;
  // A row's hidden/dismissed state is a durable local privacy fact, not a
  // relationship: the accepted view answers while it exists, and an explicit
  // clear may only fall back to this account's own cached hide/dismiss flags.
  // Mode, request, mute and every gate still come from `current` alone.
  const privacy = (shown: ConversationProjection | null, row: (typeof chat.conversations)[number]) => {
    if (shown) return { hidden: shown.ownHidden, declined: shown.ownDeclined };
    const cached = chat.accountId === accountId ? row.cachedProjection : undefined;
    return { hidden: cached?.ownHidden === true, declined: cached?.ownDeclined === true };
  };
  const normalized = query.trim().replace(/^@/, "").toLowerCase();
  const rows = chat.conversations.filter((row) => {
    // Presentation only; the row's send/read gates are elsewhere and stay live.
    const shown = presentationProjection(chat, accountId, row.conversationId, row.cachedProjection);
    const { hidden, declined } = privacy(shown, row);
    const dismissed = hidden || declined;
    if (normalized && !`${labels.get(row.peerId) ?? ""} ${identities.get(row.peerId)?.username ?? ""} ${row.lastMessage?.unsentAt === undefined ? row.lastMessage?.body ?? "" : ""}`.toLowerCase().includes(normalized)) return false;
    if (filter === "Archived") return dismissed;
    // A name search is also how a hidden chat is found again: show it with its
    // known state ("Archived" / "Hidden request", or "Hidden conversation" when
    // only the local flag survives) so it can be opened and moved back to the
    // inbox. Browsing All stays the clean inbox.
    if (dismissed && !normalized) return false;
    if (filter === "Requests") return !!shown && shown.mode === "REQUEST" && shown.request === "INCOMING";
    if (filter === "Unread") return row.unreadCount > 0;
    return true;
  });
  // A collapsed pane is a rail of the same people, not a second list: names and
  // previews leave, each avatar stays a labelled link and the unread marker
  // survives as a dot with the count in the link's name.
  if (pane?.wide && pane.collapsed) return <ChatRail rows={rows} labels={labels} identities={identities} selectedId={selectedId}
    onExpand={pane.toggle} headingRef={heading} toggleRef={paneToggle} />;
  const sidebar = pane?.wide === true;
  return <section className="fb-chat-page" aria-label="Chats">
    <AppBar title="Chats" autoFocus utilities={!sidebar && !selectedId} actions={sidebar ? (
      <button ref={paneToggle} type="button" className="fb-chat-icon" aria-label="Collapse conversation list" onClick={pane.toggle} {...hoverLabel("Collapse conversation list")}>
        <PanelLeftClose size={20} aria-hidden="true" />
      </button>
    ) : <>
      <RetrySync accountId={accountId} />
      <ActionMenu label="Filter chats" icon={<ListFilter size={20} aria-hidden="true" />} items={["All", "Unread", "Archived"].map(value => ({ id: value, label: value, onAction: () => setFilter(value) }))} />
    </>} />
    <label className="fb-chat-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search people or chats" placeholder="Search people or chats" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <BackupPrompt sequences={chat.conversations.reduce((total, row) => total + row.lastSequence, 0)} />
    <div className="fb-chat-filters" role="group" aria-label="Show conversations">
      {["All", "Requests"].map((value) => <button key={value} type="button" aria-label={value === "Requests" ? `Requests, ${requests}` : "All"}
        aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}{value === "Requests" && requests > 0 && <span className="fb-chat-count" aria-hidden="true">{requests}</span>}</button>)}
      {sidebar && <span className="fb-chat-filter-tools"><ActionMenu label="Filter chats" icon={<ListFilter size={20} aria-hidden="true" />} items={["All", "Unread", "Archived"].map(value => ({ id: value, label: value, onAction: () => setFilter(value) }))} /></span>}
      {["Unread", "Archived"].includes(filter) && <span className="fb-chat-active-filter">{filter}</span>}
    </div>
    <div className="fb-chat-list">
      <p className="fb-chat-sync" role="status">{chat.status === "opening" && !chat.localReady ? "Opening your chats…"
        : chat.error ?? (chat.status === "offline" ? "You’re offline. Saved chats are still available." : "")}</p>
      {rows.length === 0 && chat.status !== "opening" && <div className="fb-chat-empty">
        <h2>{filter === "All" ? "Your conversations start here" : `No ${filter.toLowerCase()} conversations`}</h2>
        <p>{chat.status === "error" ? "Your chat history could not open. Use Sync messages to try again."
          : "Open someone’s profile to send a message. New people can reply after accepting your request."}</p>
      </div>}
      <ul>
        {rows.map((row) => {
          const name = labels.get(row.peerId);
          // Authority for the report card's concealment; presentation for the
          // row's relationship label. They are never the same variable.
          const view = chat.currentProjections?.[row.conversationId] ?? row.cachedProjection;
          const shown = presentationProjection(chat, accountId, row.conversationId, row.cachedProjection);
          const flags = privacy(shown, row);
          const state = shown?.ownBlocked ? "Blocked by you" : shown?.ownHidden ? (shown.mode === "CONNECTED" ? "Archived" : "Hidden request")
            : shown?.ownDeclined ? "Dismissed" : shown?.mode === "CONNECTED" ? "Friends"
              : shown?.request === "INCOMING" ? "Message request" : shown?.request === "OUTGOING" ? "Request sent"
              : flags.hidden ? "Hidden conversation" : flags.declined ? "Dismissed" : "Conversation";
          const person = identities.get(row.peerId);
          // One hit target: the name and avatar open the conversation, exactly
          // like the rest of the row. The profile lives in the conversation
          // header, where tapping the person is unambiguous.
          return <li key={row.conversationId}>
            <div className="fb-chat-row">
              <UserAvatar className="fb-chat-row-avatar" shape="squircle"
                username={name} avatarUrl={person?.avatarUrl} size={44} />
              <div className="fb-chat-row-copy">
                <span className="fb-chat-row-identity" aria-hidden="true">
                  <strong>{name || person?.username || "Member"}</strong>
                </span>
                <span className="fb-chat-preview">{row.lastMessage ? messagePreview(row.lastMessage) : state}</span>
                {row.lastMessage?.contextReportId && row.lastMessage.unsentAt === undefined && <ChatReportContext reportId={row.lastMessage.contextReportId} safetyKey={view?.ownBlocked ? "blocked" : "clear"} preview />}
              </div>
              <span className="fb-chat-row-meta">
                {row.updatedAt > 0 && <time dateTime={new Date(row.updatedAt).toISOString()}
                  title="Chat updated on this device">{timeAgo(new Date(row.updatedAt).toISOString())}</time>}
                {row.unreadCount > 0 && <span className="fb-chat-unread" aria-label={`${row.unreadCount} unread messages`}>{row.unreadCount}</span>}
              </span>
              <Link to={`/chats/${row.conversationId}`} className="fb-chat-row-open"
                aria-current={selectedId === row.conversationId ? "page" : undefined}
                aria-label={`Open conversation with ${name || "member"}`} />
            </div>
          </li>;
        })}
       </ul>
       {normalized && <><h2 className="fb-chat-people-heading">People</h2><PeopleSearch query={query} /></>}
    </div>
  </section>;
}

/** The most photos one send may stage. Matches the native picker cap so a
 *  selection more than one screen of thumbnails can still be reviewed here. */
const MAX_STAGED_PHOTOS = 10;

/**
 * One picked file, classified by what the platform actually named it. A video
 * keeps the private file lane and is never decoded as a still; a browser that
 * could not name the format at all keeps the canonical photo lane, which sniffs
 * and refuses what it cannot read. Everything else is refused here, before any
 * preparation, so a document never becomes a broken "photo".
 */
function stagedKindOf(file: File): "photo" | "video" | null {
  const type = file.type.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/") || type === "") return "photo";
  return null;
}

/**
 * Layers that own the next Escape/Back even when focus sits outside them: the
 * canonical modal stack covers dialogs and sheets, and this selector covers the
 * ones that are not registered there (the phone navigation drawer and the
 * composer pickers). A plain `role="dialog"` is deliberately absent: the
 * navigation setup popover stays mounted and must never trap Escape.
 */
const OPEN_LAYER_SELECTOR = "[aria-modal='true'], [role='menu'], [role='listbox'], .fb-picker-layer";

interface StagedChatPhoto {
  key: string;
  /** `photo` uses the canonical still media lane; `animation` keeps its bytes
   *  for the existing private file lane so frames/alpha are not flattened;
   *  `video` travels that same file lane and gets no invented poster. */
  kind?: "photo" | "animation" | "video";
  source?: File;
  prepared?: PreparedMessagingPhoto;
  /** File bytes for the private file lane (an animation or a video). */
  file?: File;
  animated?: boolean;
  /** The picked file's own name, shown where a video has no preview frame. */
  name?: string;
  width?: number;
  height?: number;
  /** Object URL of the prepared bytes; only present once preparation succeeded. */
  url?: string;
  error?: boolean;
  preparing: boolean;
}

export function MessagingThread() {
  const { user } = useAuth();
  const { conversationId = "" } = useParams();
  return user ? <ThreadSession key={`${user.id}:${conversationId}`} accountId={user.id} conversationId={conversationId} /> : null;
}

/** `route` is the full chat screen; `dock` is the compact floating window. */
export type ThreadSurface = "route" | "dock";

/** Compact ceiling for the dock's conversation-info popover: 24rem / 384px at
   the default root, never half the window. React Aria writes this value inline
   on the open overlay from the layered-popover maxHeight prop; a stylesheet
   max-height cannot outrank it, so the cap rides this prop. */
const INFO_POPOVER_MAX_HEIGHT_PX = 384;

export function ThreadSession({
  accountId,
  conversationId,
  surface = "route",
  active = true,
  onToggleCompact,
  onClose,
  onExpand,
  onUnsentWorkChange,
}: {
  accountId: string;
  conversationId: string;
  /** "route" keeps every current behaviour, including route-owned Escape/Back. */
  surface?: ThreadSurface;
  /** Dock only. false while minimized, occluded or behind a chat route. */
  active?: boolean;
  /** Dock only: the header toggle. The host collapses when open and restores
   *  when minimized; the component stays mounted either way. */
  onToggleCompact?: () => void;
  /** Dock only: called only after the unsent-work guard is satisfied. */
  onClose?: () => void;
  /** Dock only: called only after the unsent-work guard is satisfied. */
  onExpand?: () => void;
  /** Dock only: the host mirrors this to guard its own picker/close paths. */
  onUnsentWorkChange?: (hasUnsent: boolean) => void;
}) {
  const dock = surface === "dock";
  const { user } = useAuth();
  // The panel is a narrow window on a wide display, so the utilities and the
  // third pane are decided by the thread's own box, never by the viewport.
  const pageRef = useRef<HTMLElement>(null);
  // The once-registered Escape/Back owners read the live activity without
  // re-registering over a child layer that already owns the press.
  const activeRef = useRef(active);
  activeRef.current = active;
  // On the wide split the app utilities live at the top-right of the thread,
  // not in the conversation sidebar. On a phone the list page owns them.
  const viewportWidth = useViewportWidth();
  // The measurement is the thread's own box. Before it lands, assume the wide
  // layout only for the full-screen route: a narrow window must never paint
  // the wide extras first just because the display behind it is wide.
  const wideApp = useContentWidth(pageRef, dock ? 0 : viewportWidth) >= MEDIUM_MAX_PX;
  const chat = useMessaging();
  const { hoverLabel } = useHoverLabel();
  // The dock's conversation-info popover: anchored a few pixels from its own
  // trigger instead of opening the modal sheet.
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : Math.round(window.innerHeight),
  );
  const infoMaxHeight = layeredPopoverMaxHeight(viewportHeight, INFO_POPOVER_MAX_HEIGHT_PX);

  // A hidden or minimized dock never leaves its portalled pop-up behind:
  // the surface closes with the window and the draft stays where it was.
  useEffect(() => {
    if (active) return;
    setInfoOpen(false);
  }, [active]);

  useEffect(() => {
    const onResize = () => setViewportHeight(Math.round(window.innerHeight));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [cached] = useState(() => getCachedMessagingThreadState(accountId, conversationId));
  const [renderedRevision, setRenderedRevision] = useState(-1);
  const [threadReadFailed, setThreadReadFailed] = useState(false);
  const [threadReadRetry, setThreadReadRetry] = useState(0);
  const runtimeOpen = chat.accountId === accountId && (chat.localReady || chat.status === "ready" || chat.status === "offline");
  // One active lease, not one mounted component: a minimized or occluded
  // window releases the thread to the route screen instead of starving it.
  useEffect(() => {
    if (!runtimeOpen || !active) return;
    return watchMessagingThread(accountId, conversationId);
  }, [runtimeOpen, active, accountId, conversationId]);
  const threadSync = chat.threadSync?.conversationId === conversationId ? chat.threadSync : null;
  const threadReconciled = !!threadSync && (threadSync.mode === "ready" || threadSync.mode === "soft")
    && (threadSync.appliedRevision === undefined || renderedRevision >= threadSync.appliedRevision);
  // Owner feedback 2026-11-06: a failed refresh must never stop the reader.
  // `threadLive` gates server authority (mark-read, receipts, media upload);
  // the screen itself stays readable and writable from durable local state.
  const threadLive = threadReconciled && !threadReadFailed;
  // A ready-state failure is one of the runtime's fixed, consumer-safe sentences
  // (sync, send or media). The thread that is reading must see it and can retry;
  // a background media pass never relabels an already saved bubble as failed.
  const runtimeNotice = chat.status === "ready" ? chat.error : null;
  // Kept for the server-side effects below, which must not act on authority the
  // client does not currently hold.
  const threadBlocked = !threadLive;
  const row = chat.conversations.find((entry) => entry.conversationId === conversationId);
  const current = chat.currentProjections?.[conversationId];
  const view = current ?? row?.cachedProjection;
  // Presentation only: the label, mute state and management-row presence may
  // survive a routine pass, while `current`, `threadLive` and `threadBlocked`
  // remain the sole authority for every send, read, receipt and media gate.
  const presentationView = presentationProjection(chat, accountId, conversationId, row?.cachedProjection);
  const photoAllowed = view?.mode === "CONNECTED" && !view.ownBlocked && chat.accountId === accountId;
  const labels = useLabels(accountId, row ? [row.peerId] : []);
  const person = row ? labels.get(row.peerId) : undefined;
  const name = person?.displayName || person?.username;
  // Long-press is the phone's way into the message actions; the corner chevron
  // is a pointer/keyboard affordance and is hidden from coarse pointers.
  const [storedMessages, setMessages] = useState<StoredHumanMessage[]>(cached?.messages ?? []);
  const [localEchoes, setLocalEchoes] = useState<Array<{ message: StoredHumanMessage; failed: boolean }>>([]);
  const messages = useMemo(() => {
    const ids = new Set(storedMessages.map(message => message.id));
    return [...storedMessages, ...localEchoes.filter(entry => !ids.has(entry.message.id)).map(entry => entry.message)];
  }, [storedMessages, localEchoes]);
  const [outbox, setOutbox] = useState<OutboxEntry[]>(cached?.outbox ?? []);
  const [media, setMedia] = useState<MediaAttachment[]>(cached?.media ?? []);
  const [loaded, setLoaded] = useState(!!cached);
  // Composer text lives outside this component, so closing the window (which
  // unmounts the session) or leaving the route does not throw away what the
  // reader typed. Only a durable send clears it below; unmount, minimize, close,
  // a conversation switch and a failed send all leave it untouched.
  const [draft, setDraft] = useState(() => readConversationDraft(accountId, conversationId));
  const draftRevision = useRef(0);
  // One composer clear: the revision fence, the field and the stored draft move
  // together, so a remount never shows words the field already dropped.
  const clearDraft = () => {
    draftRevision.current++;
    setDraft("");
    clearConversationDraft(accountId, conversationId);
  };
  const textAttempts = useRef(new Map<number, string>());
  const textInFlight = useRef(new Set<number>());
  // One synchronous admission owner for this composer. React state is too late
  // for two activations in the same turn (Enter plus a click, a repeated key, a
  // picker item fired twice), so text, photos, files and stickers share this
  // latch. It is one admission at a time: the field stays editable and newer
  // typing is preserved, but a second durable admission waits until this one's
  // committed callback, rejection or finally releases it. The value is a
  // per-send token, so an earlier send whose refresh is still settling can never
  // release a later send's admission.
  const admissionLatch = useRef<symbol | null>(null);
  // A report-linked entry carries the subject once; the first send consumes it so
  // a later ordinary message is never silently tagged with the same report.
  const route = useLocation();
  const navigate = useNavigate();
  const routeRef = useRef(route); routeRef.current = route;
  // An ambient page query is never a chat intent for the floating window: the
  // dock starts an ordinary conversation and never adopts or rewrites the page
  // underneath (report links stay a route-only entry).
  const queryReport = dock ? null : new URLSearchParams(route.search).get("report");
  const validReport = isUuid(queryReport) ? queryReport : null;
  const [reportContext, setReportContext] = useState(validReport);
  useEffect(() => { setReportContext(validReport); }, [validReport]);
  // The full-screen conversation-info route links back here with an explicit
  // search/media request; consume it once so closing the sheet does not reopen.
  useEffect(() => {
    if (dock) return;
    const params = new URLSearchParams(route.search);
    const requested = params.get("search") === "1" ? "search"
      : params.get("media") === "1" ? "media"
      : params.get("location") === "1" ? "location" : null;
    if (!requested) return;
    setSheet(requested);
    params.delete("search"); params.delete("media"); params.delete("location");
    navigate({ pathname: route.pathname, search: params.toString() ? `?${params}` : "", hash: route.hash },
      { replace: true, state: route.state });
  }, [route, navigate, dock]);
  function clearReportContext(expected: string | null) {
    const latest = routeRef.current, params = new URLSearchParams(latest.search);
    if (expected !== params.get("report")) return;
    params.delete("report"); setReportContext(null);
    navigate({ pathname: latest.pathname, search: params.toString() ? `?${params}` : "", hash: latest.hash },
      { replace: true, state: latest.state });
  }
  const locationAllowed = !threadBlocked && chat.accountId === accountId && chat.status === "ready"
    && current?.mode === "CONNECTED" && !current.ownBlocked;
  const locationAuthority = useRef("");
  locationAuthority.current = JSON.stringify([chat.accountId, chat.status, row?.peerId,
    current?.mode, current?.ownBlocked, current?.revision]);
  // Late preparation results are checked against the authority that existed
  // when they started, not against whatever the view says now.
  const photoAuthority = useRef(photoAllowed);
  photoAuthority.current = photoAllowed;
  // Photos are staged, not selected one at a time: the owner asked for a real
  // bulk pick with a review surface, so each pick appends an item and every
  // item is reviewed, removed and sent on its own terms.
  const [photos, setPhotos] = useState<StagedChatPhoto[]>([]);
  // The tray is also read from async keyboard/paste completions. A ref keeps
  // the cap and ordering check against the list the reader actually sees.
  const photosRef = useRef<StagedChatPhoto[]>([]);
  photosRef.current = photos;
  // Captured before every await and compared again at tray mutation and send.
  const conversationOwner = useRef({ accountId, conversationId });
  conversationOwner.current = { accountId, conversationId };
  // Per-file admission ids and the caption that first travelled with them
  // survive an uncertain send, so a retry of the same staged animation or video
  // is never a second message and never picks up text typed after the failure.
  const fileAdmissions = useRef(new Map<string, { messageId: string; createdAt: number; caption: string }>());
  const [composerFocused, setComposerFocused] = useState(false);
  // A press on the composer is an earlier signal than its focus event, so the
  // native flag can be set while the IME is still opening. It only widens WHEN
  // arrival is advertised; commit still requires the live owner below.
  const [composerIntent, setComposerIntent] = useState(false);
  const keyboardSession = useRef<KeyboardMediaSession | null>(null);
  const [photoSending, setPhotoSending] = useState(false);
  // A reply to an incoming request accepts it first. While that one round trip
  // runs, the composer is read-only so a draft typed during the wait cannot be
  // half-sent by the reply that is already in flight.
  const [requestAccepting, setRequestAccepting] = useState(false);
  const requestAcceptingRef = useRef(false);
  const [filesSending, setFilesSending] = useState(false);
  const [draftViewer, setDraftViewer] = useState<{ key: string } | null>(null);
  // Voice is a real capability: one recorder and one transcript player per
  // conversation. Nothing opens the microphone until the user taps Voice.
  const [voice] = useState(() => ({
    recorder: createVoiceRecorder(browserVoiceDeps()),
    player: createVoicePlayback(browserVoicePlaybackPorts()),
  }));
  const [voiceStatus, setVoiceStatus] = useState<VoiceRecorderState["status"]>("idle");
  const [voiceRecording, setVoiceRecording] = useState<VoiceRecording | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [playbackSnapshot, setPlaybackSnapshot] = useState<VoicePlaybackSnapshot>({
    playingId: null, positionMs: 0, durationMs: 0 });
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  // A voice send crosses two different boundaries. Finalizing the container and
  // hashing the bytes are preparation: nothing has left this screen, so leaving
  // still discards the note. From the service call onward the durable outbox
  // owns it, and leaving neither discards nor cancels it.
  const [voiceSendPhase, setVoiceSendPhase] = useState<"idle" | "preparing" | "sending">("idle");
  const voiceSending = voiceSendPhase !== "idle";
  // Set by an explicit discard, so a finalize or hash already in flight cannot
  // reach the service after the reader threw the note away.
  const voiceSendDiscarded = useRef(false);
  const voiceSupported = voiceRecordingSupported();
  const voiceAllowed = photoAllowed && voiceSupported;
  // A leave gesture never drops work the reader has not sent. Typed text is not
  // that work any more: it lives in the session draft store and comes back on
  // the next mount (see `conversationDrafts`), so only staged photos and a
  // recording that has not reached the service ask for an explicit choice. A
  // clean conversation still leaves at once. Escape and Android Back share this
  // one path, and a layer that is already open keeps its own press.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // What the leave question is guarding: the route screen navigates, the dock
  // closes, or the dock opens the full route. One dialog, one canonical guard.
  const [leaveIntent, setLeaveIntent] = useState<"route" | "close" | "expand">("route");
  const voiceActive = voiceStatus === "starting" || voiceStatus === "recording"
    || voiceStatus === "pausing" || voiceStatus === "review";
  // Past admission the note is in the outbox, so leaving does not recall it and
  // "will be discarded" would be a false promise. Preparation is still work
  // this screen can lose. Typed text is kept in the session draft store, so the
  // question never names it: only the staged attachments and the active note
  // below die with the window.
  const voiceAtRisk = voiceActive && voiceSendPhase !== "sending";
  const hasUnsentWork = photos.length > 0 || voiceAtRisk;
  const stagedVideos = photos.some((item) => item.kind === "video");
  const stagedAttachments = stagedVideos || photos.some((item) => item.kind === "animation");
  // Only a prepared still or animation has a frame to review; a video has no
  // poster, so the shared viewer counts and pages through the frames that
  // actually exist instead of inventing one.
  const reviewablePhotos = photos.filter((item) => !!item.url && (!!item.prepared || !!item.file));
  const unsentParts = [
    photos.length > 0 ? (stagedAttachments ? "attachments" : "photos") : null,
    voiceAtRisk ? "recording" : null,
  ].filter((part): part is string => part !== null);
  const unsentCopy = unsentParts.length === 1 ? `Your unsent ${unsentParts[0]} will be discarded.`
    : unsentParts.length > 1
      ? `Your unsent ${unsentParts.slice(0, -1).join(", ")} and ${unsentParts[unsentParts.length - 1]} will be discarded.`
      : null;
  // The boundary can move while the question is open: once the note is admitted
  // there is nothing left to discard, so the question goes away rather than
  // standing there with an empty promise.
  useEffect(() => {
    if (confirmLeave && !hasUnsentWork) setConfirmLeave(false);
  }, [confirmLeave, hasUnsentWork]);
  // Refs keep the one registered gesture owner current without re-registering
  // it over a child layer that already owns the press.
  const unsentWork = useRef(hasUnsentWork);
  unsentWork.current = hasUnsentWork;
  // The host mirrors this boolean to refuse its own picker/close paths; the
  // work itself never leaves this component.
  useEffect(() => { onUnsentWorkChange?.(hasUnsentWork); }, [hasUnsentWork, onUnsentWorkChange]);
  const leaveThread = useRef<(intent?: "route" | "close" | "expand") => void>(() => undefined);
  leaveThread.current = (intent = "route") => {
    // Explicit consent releases the microphone here; no gesture does it alone.
    // A note the service already holds is not discarded: it is in the outbox
    // and leaving must not pretend to cancel it.
    if (voiceAtRisk) discardVoice();
    setConfirmLeave(false);
    if (!dock) { navigate(CHATS_PATH, { replace: true }); return; }
    // A clean dock close never writes history or moves the page underneath.
    if (intent === "expand") onExpand?.(); else onClose?.();
  };
  const requestLeave = useRef<(intent?: "route" | "close" | "expand") => void>(() => undefined);
  requestLeave.current = (intent = "route") => {
    if (unsentWork.current) { setLeaveIntent(intent); setConfirmLeave(true); return; }
    leaveThread.current(intent);
  };
  // Set while a press is handed to an open layer's own Escape handling, so the
  // same key cannot also leave the conversation.
  const delegatedPress = useRef(false);
  const closeOpenLayer = () => {
    delegatedPress.current = true;
    try {
      // Dispatched inside the document so the layer's own capture/bubble
      // listener (document, window or a picker trigger) is the one that runs.
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    } finally { delegatedPress.current = false; }
  };
  const closeLayer = useRef(closeOpenLayer);
  closeLayer.current = closeOpenLayer;
  // Escape leaves a conversation for the canonical chat list once every open
  // layer has had the press. A composing field, a repeated key or a modifier is
  // never a leave gesture. The route screen owns the gesture only on its own
  // route (a legacy/redirect mount is not a chat screen); the dock owns it
  // whenever it is the active surface, whatever page it floats over.
  useEffect(() => {
    const leaveOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing
        || event.keyCode === 229 || event.repeat || event.ctrlKey || event.altKey
        || event.metaKey || event.shiftKey) return;
      if (dock ? !activeRef.current : !isChatThreadPath(routeRef.current.pathname)) return;
      if (delegatedPress.current) return;
      // A layer owns this press even when focus sits outside it: the canonical
      // modal stack, or an open dialog/menu/picker (the phone navigation drawer
      // is one). Leaving underneath it would be the same key acting twice.
      if (modalLayerCount() > 0 || document.querySelector(OPEN_LAYER_SELECTOR)) return;
      event.preventDefault();
      requestLeave.current("close");
    };
    window.addEventListener("keydown", leaveOnEscape);
    return () => window.removeEventListener("keydown", leaveOnEscape);
  }, [dock]);
  // Android Back asks the same question, but only after every open layer has
  // had its own press: layers register when they open, so the topmost wins. A
  // layer with no Back handler of its own is closed through its Escape path.
  useEffect(() => registerBackInterceptor(() => {
    if (dock ? !activeRef.current : !isChatThreadPath(routeRef.current.pathname)) return false;
    if (modalLayerCount() > 0 || document.querySelector(OPEN_LAYER_SELECTOR)) {
      closeLayer.current();
      return true;
    }
    requestLeave.current("close");
    return true;
  }), [dock]);
  const [viewer, setViewer] = useState<{ id: string; items: MediaViewerItem[] } | null>(null);
  const readyPhotos = useRef(new Map<string, { bytes: ArrayBuffer; mime: string }>());
  const rememberPhoto = useCallback((id: string, content: { bytes: ArrayBuffer; mime: string } | null) => {
    if (content) readyPhotos.current.set(id, content); else readyPhotos.current.delete(id);
  }, []);
  const viewerUrls = useRef(new Set<string>());
  // The viewer's newest open wins: a slower earlier read must not replace the
  // photo the reader just tapped, and an unmounted thread must not allocate.
  const viewerGeneration = useRef(0);
  const stagedUrls = useRef(new Set<string>());
  // Per-photo admission: ids belong to the durable draft owner and must survive
  // an uncertain admission, so a retry of one photo is the same photo.
  const photoAdmissions = useRef(new Map<string, { metadata: MediaMetadata; caption: string; createdAt: number }>());
  // True between opening the native picker and its result: render state must
  // not cancel a selection the platform is still holding.
  const picking = useRef(false);
  const admission = useRef<{ metadata: MediaMetadata; caption: string; messageType?: "MEDIA" | "VOICE" } | null>(null);
  // A failed photo/voice admission keeps its ids for an identical retry, but the
  // composer must let that retry be sent without letting the attachment change.
  const [admissionFailed, setAdmissionFailed] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"actions" | "search" | "media" | "location" | "end" | "delete" | "unsend" | "clear" | "review" | null>(null);
  const [showJump, setShowJump] = useState(false);
  useLayoutEffect(() => { if (!locationAllowed) setSheet(previous => previous === "location" ? null : previous); }, [locationAllowed]);
  const [messageQuery, setMessageQuery] = useState("");
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  // Two alternating keyframes restart the same transient ring when the same
  // quote is tapped twice; the state clears when the ring has finished.
  const [flash, setFlash] = useState<{ id: string; nonce: number } | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  // The message a new send answers. It stays until that send is admitted, so a
  // failed send keeps the context instead of silently dropping the quote.
  const [replyTo, setReplyTo] = useState<{ id: string; label: string; preview: string } | null>(null);
  const [reportTarget, setReportTarget] = useState<"account" | "message" | null>(null);
  // The hidden copy of an unsent message. Ids enable the report action; the body
  // is fetched only when the report sheet is actually opened.
  const [heldMessageIds, setHeldMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [reportHold, setReportHold] = useState<{ messageId: string; body: string } | null>(null);
  // A hidden window must not leave its own sheets, viewers or confirms
  // portalled above a page it no longer owns. Only presentation state is
  // cleared: the draft, staged media and an open recording stay exactly where
  // they were, and nothing is sent.
  useEffect(() => {
    if (active) return;
    setSheet(null);
    setInfoOpen(false);
    setViewer(null);
    setDraftViewer(null);
    setCameraOpen(false);
    setConfirmLeave(false);
    setReportTarget(null);
    setReportHold(null);
    setSelectedMessageId(null);
  }, [active]);
  // A row menu is the one transient this component cannot unmount: its open
  // state lives inside each LongPressArea, and its panel is a body portal that
  // would float over whatever page the reader moved to. Hiding the window
  // closes it through the same canonical layer bridge every layer answers, one
  // press per layer so an open submenu unwinds first. `selectedMessageId` is
  // set only when this thread opened a menu, so another surface's stays alone.
  const menuOpen = useRef(false);
  menuOpen.current = selectedMessageId !== null;
  useEffect(() => {
    if (active || !menuOpen.current) return;
    let frame = 0;
    let presses = 0;
    const closeTopMenu = () => {
      if (!document.querySelector(".fb-action-menu")) return;
      closeLayer.current();
      if (++presses < 3) frame = window.requestAnimationFrame(closeTopMenu);
    };
    closeTopMenu();
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, [active]);
  const [docVisible, setDocVisible] = useState(() => document.visibilityState === "visible");
  // "Showing" folds the document and this surface together, so a minimized,
  // occluded or behind-a-route window never reads, inserts or observes. Live
  // receipts additionally pause under any modal layer the reader is in.
  const visible = docVisible && active;
  const modalLayerOpen = useAnyModalLayerOpen();
  const receiptsActive = visible && !modalLayerOpen;
  // Live contexts authorize NEW observations only. Historical Read facts are
  // durable and never disappear just because consent/context/connection changes.
  const receiptAuthority = current ? JSON.stringify([accountId, conversationId, current.peerId,
    current.epoch, current.mode, current.requestEpoch, current.ownBlocked]) : null;
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const confirmedReads = useRef(new Set<string>());
  const confirmedObservations = useRef(new Set<string>());
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  // One owner for follow intent and the visible message: message commits,
  // media reflow, resize and visibility resume all restore this point. The id
  // list keeps its identity across unrelated renders so typing a draft never
  // rebuilds the anchor key.
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const transcript = useTranscriptAnchor({
    container: scroll,
    conversationKey: `${accountId}:${conversationId}`,
    messageIds,
    enabled: loaded,
    onDistance: (distance) => setShowJump(distance > JUMP_PX),
  });
  const lastMarked = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      viewerGeneration.current++;
      for (const url of viewerUrls.current) URL.revokeObjectURL(url);
      viewerUrls.current.clear();
      for (const url of stagedUrls.current) URL.revokeObjectURL(url);
      stagedUrls.current.clear();
    };
  }, []);
  // A late result may only touch the thread it was submitted to. The session is
  // keyed by account and conversation, so another thread normally remounts;
  // this fence keeps a reused instance from writing the previous thread's
  // draft, notice, reply or report context into the new one.
  const ownsThread = (owner: { accountId: string; conversationId: string }) =>
    alive.current && conversationOwner.current.accountId === owner.accountId
    && conversationOwner.current.conversationId === owner.conversationId;
  useLayoutEffect(() => {
    if (photoAllowed) return;
    // A native picker that is still open must survive the projection refresh
    // that runs when the app returns to the foreground: cancelling here made a
    // perfectly good selection vanish with no strip and no error. A staged
    // photo that never finished preparing is disclosed instead of sent.
    setPhotos((list) => {
      let changed = false;
      const next = list.map((item) => {
        if (item.prepared || item.error || !item.preparing) return item;
        changed = true;
        return { ...item, preparing: false, error: true };
      });
      return changed ? next : list;
    });
  }, [photoAllowed]);
  // The recorder's 200 ms tick must not repaint the transcript: the parent
  // keeps only lifecycle facts, and the timestamping strip subscribes itself.
  useEffect(() => voice.recorder.subscribe((next) => {
    setVoiceStatus(next.status);
    if (next.status === "review") { setVoiceRecording(next.recording); setVoiceNotice(null); }
    else if (next.status === "error") { setVoiceRecording(null); setVoiceNotice(next.message); }
    else if (next.status === "idle") { setVoiceRecording(null); setVoiceNotice(null); }
  }), [voice]);
  useEffect(() => voice.player.subscribe(setPlaybackSnapshot), [voice]);
  useEffect(() => {
    if (voiceStatus !== "review" || !voiceRecording) { setVoiceUrl(null); return; }
    const url = URL.createObjectURL(voiceRecording.blob);
    setVoiceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voiceStatus, voiceRecording]);
  // Leaving the app, closing the tab or unmounting never leaves a hot mic.
  useEffect(() => {
    const release = () => {
      if (document.visibilityState !== "hidden") return;
      // Leaving the tab closes the microphone AND tells the view, so a return
      // does not show a recording that no longer exists.
      voice.recorder.discard();
    };
    document.addEventListener("visibilitychange", release);
    window.addEventListener("pagehide", release);
    return () => {
      document.removeEventListener("visibilitychange", release);
      window.removeEventListener("pagehide", release);
      voice.recorder.teardown();
      voice.player.teardown();
    };
  }, [voice]);
  useLayoutEffect(() => {
    if (voiceAllowed) return;
    // discard() emits idle; teardown() is silent, which left a "Recording"
    // strip on screen for a recorder that no longer existed.
    voice.recorder.discard(); voice.player.pause();
  }, [voiceAllowed, voice]);
  const viewerItems = photoAllowed ? viewer?.items.filter((item) => messages.some((message) => message.id === item.id && message.unsentAt === undefined)
    && media.some((attachment) => attachment.messageId === item.id)) ?? [] : [];
  const activeViewer = viewer && viewerItems.some((item) => item.id === viewer.id) ? viewer : null;
  // The staged tray reuses the same inspection surface as the feed: swipe,
  // thumbnails, zoom and counter, over the photos about to be sent.
  const draftViewerItems: MediaViewerItem[] = photos.flatMap((item) => item.url
    ? [{ id: item.key, src: item.url, width: item.width ?? item.prepared?.width ?? null,
        height: item.height ?? item.prepared?.height ?? null,
        alt: item.kind === "animation" ? "Attachment to send" : "Photo to send" }]
    : []);
  const draftViewerIndex = draftViewer ? draftViewerItems.findIndex((item) => item.id === draftViewer.key) : -1;
  useLayoutEffect(() => {
    if (draftViewer && draftViewerIndex < 0) setDraftViewer(null);
  }, [draftViewer, draftViewerIndex]);
  useLayoutEffect(() => {
    if (viewer) {
      const retained = new Set(activeViewer ? viewerItems.map((item) => item.src) : []);
      for (const url of viewerUrls.current) if (!retained.has(url)) { URL.revokeObjectURL(url); viewerUrls.current.delete(url); }
      if (!activeViewer) setViewer(null);
    }
  }, [viewer, activeViewer, viewerItems]);
  function startReply(message: StoredHumanMessage) {
    if (message.unsentAt !== undefined) return;
    setReplyTo({ id: message.id, label: message.authorId === accountId ? "You" : name || "Member",
      preview: replyPreview(message) });
    haptic("commit");
    composer.current?.focus();
  }
  async function openPhoto(id: string, bytes: ArrayBuffer, mime: string) {
    if (!photoAllowed) return;
    const generation = ++viewerGeneration.current;
    setDraftViewer(null);
    // The viewer pages through every live photo in the conversation. Photos outside the lazy-read
    // margin are read here, on the explicit open, so the counter names the
    // real sequence instead of only the cells that happened to be on screen.
    const scope = messages.filter((message) => message.unsentAt === undefined && message.messageType === "MEDIA")
      .map((message) => message.id);
    const resolved = await Promise.all(scope.map(async (messageId) => {
      const message = messages.find((entry) => entry.id === messageId);
      if (!message || message.unsentAt !== undefined) return null;
      const attachment = media.find((entry) => entry.messageId === messageId);
      if (!attachment) return null;
      let available = readyPhotos.current.get(attachment.id);
      if (!available && messageId === id) available = { bytes, mime };
      if (!available && attachment.state !== "EVICTED") {
        const stored = await readMessagingMedia(accountId, attachment.id).catch(() => null);
        if (stored) {
          const copy = stored.slice(0);
          available = { bytes: copy, mime: attachment.mime };
          readyPhotos.current.set(attachment.id, available);
        }
      }
      return available ? { messageId, available, attachment } : null;
    }));
    // A newer tap or an unmounted thread invalidates this run before it can
    // allocate URLs or replace the viewer the reader is now looking at.
    if (generation !== viewerGeneration.current || !alive.current) return;
    const items: MediaViewerItem[] = resolved.flatMap((entry) => {
      if (!entry) return [];
      const src = URL.createObjectURL(new Blob([entry.available.bytes.slice(0)], { type: entry.available.mime }));
      viewerUrls.current.add(src);
      return [{ id: entry.messageId, src, width: entry.attachment.width, height: entry.attachment.height, alt: "Conversation photo" }];
    });
    setViewer({ id, items });
  }
  function closePhoto() {
    setViewer(null);
    for (const url of viewerUrls.current) URL.revokeObjectURL(url);
    viewerUrls.current.clear();
  }
  /** Reserve a review slot before importing, so a bulk pick keeps its order
   *  even when one photo imports faster than the next. */
  function reserveStaged(count: number): StagedChatPhoto[] {
    const slots = Array.from({ length: count }, () => ({
      key: `staged-${crypto.randomUUID()}`, preparing: true,
    }));
    setPhotos((list) => [...list, ...slots]);
    return slots;
  }
  function releaseStagedUrl(item: StagedChatPhoto) {
    if (!item.url) return;
    URL.revokeObjectURL(item.url);
    stagedUrls.current.delete(item.url);
  }
  function removeStaged(key: string) {
    if (photoSending) return;
    setPhotos((list) => {
      const item = list.find((entry) => entry.key === key);
      if (item) releaseStagedUrl(item);
      photoAdmissions.current.delete(key);
      fileAdmissions.current.delete(key);
      return list.filter((entry) => entry.key !== key);
    });
    setAdmissionFailed(false);
    setError(null);
  }
  async function prepareStaged(slot: StagedChatPhoto, source: File) {
    try {
      const prepared = await prepareMessagingPhoto(source);
      if (!alive.current) return;
      // Preparation that completes after the connection no longer allows
      // photos must not resurrect a draft it already disclosed as failed.
      if (!photoAuthority.current) {
        setPhotos((list) => list.map((item) => item.key === slot.key ? { ...item, source, preparing: false, error: true } : item));
        return;
      }
      const url = URL.createObjectURL(new Blob([prepared.bytes.slice(0)], { type: prepared.mime }));
      stagedUrls.current.add(url);
      setPhotos((list) => list.map((item) => item.key === slot.key ? { ...item, source, prepared, url, preparing: false, error: false } : item));
    } catch {
      // One unreadable photo fails alone and keeps its place in the tray.
      if (alive.current) setPhotos((list) => list.map((item) => item.key === slot.key ? { ...item, source, preparing: false, error: true } : item));
    }
  }
  async function retryStaged(item: StagedChatPhoto) {
    if (!item.source) { removeStaged(item.key); return; }
    photoAdmissions.current.delete(item.key);
    fileAdmissions.current.delete(item.key);
    setPhotos((list) => list.map((entry) => entry.key === item.key ? { ...entry, preparing: true, error: false } : entry));
    await prepareStaged(item, item.source);
  }
  /**
   * One admission path for keyboard/provider arrivals and pasted animations.
   * The bytes are verified and sanitized before they reach the tray; nothing
   * is uploaded or sent here, and a completion from a previous owner is
   * discarded instead of staged.
   */
  async function stageKeyboardMedia(media: VerifiedKeyboardMedia): Promise<void> {
    const owner = { ...conversationOwner.current };
    if (!alive.current || !photoAuthority.current) return;
    if (photosRef.current.length >= MAX_STAGED_PHOTOS) {
      setError(`You can send up to ${MAX_STAGED_PHOTOS} attachments at once.`);
      return;
    }
    const key = `staged-${crypto.randomUUID()}`;
    const mime = media.mime;
    try {
      if (media.kind === "still") {
        // Stills go to the canonical photo lane; every GIF is an animation.
        if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return;
        const bytes = media.bytes.slice();
        const buffer = bytes.buffer as ArrayBuffer;
        const sha256 = await sha256Hex(buffer);
        if (!alive.current || !photoAuthority.current
          || conversationOwner.current.accountId !== owner.accountId
          || conversationOwner.current.conversationId !== owner.conversationId) return;
        const prepared: PreparedMessagingPhoto = {
          bytes: buffer, sha256, mime, byteSize: buffer.byteLength,
          width: media.width, height: media.height,
        };
        const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
        stagedUrls.current.add(url);
        setPhotos((list) => {
          if (list.length >= MAX_STAGED_PHOTOS) { URL.revokeObjectURL(url); stagedUrls.current.delete(url); return list; }
          return [...list, { key, kind: "photo", prepared, url, preparing: false, width: media.width, height: media.height }];
        });
        return;
      }
      const extension = mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "gif";
      const copy = media.bytes.slice();
      const buffer = copy.buffer as ArrayBuffer;
      const file = new File([buffer], `norfold-sticker.${extension}`, { type: mime });
      const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
      stagedUrls.current.add(url);
      setPhotos((list) => {
        if (list.length >= MAX_STAGED_PHOTOS) { URL.revokeObjectURL(url); stagedUrls.current.delete(url); return list; }
        return [...list, { key, kind: "animation", file, url, animated: true, width: media.width, height: media.height, preparing: false }];
      });
    } catch {
      if (alive.current) setError("That image couldn't be added. Try another one.");
    }
  }
  /** Image-only DOM paste: the same gates and owners as a keyboard arrival. */
  async function stagePastedImages(files: File[]): Promise<void> {
    if (!runtimeOpen || !row) return;
    if (!photoAllowed) { setError("Photos are available when you're friends."); return; }
    if (photoSending || filesSending || admissionFailed || requestAccepting || voiceSending) {
      setError("Wait for the current send to finish before adding an image.");
      return;
    }
    const owner = { ...conversationOwner.current };
    const room = Math.max(0, MAX_STAGED_PHOTOS - photosRef.current.length);
    const accepted = files.slice(0, room);
    if (accepted.length === 0) { setError(`You can send up to ${MAX_STAGED_PHOTOS} attachments at once.`); return; }
    for (const file of accepted) {
      try {
        const kind = await classifyClipboardImage(file);
        if (!alive.current || conversationOwner.current.accountId !== owner.accountId
          || conversationOwner.current.conversationId !== owner.conversationId) return;
        if (kind === null) { setError("That image format can't be added here."); continue; }
        if (kind === "animation") {
          const media = await readClipboardAnimation(file);
          // The read is the last async step before staging: a route change
          // during it must discard the paste instead of filing it elsewhere.
          if (!alive.current || conversationOwner.current.accountId !== owner.accountId
            || conversationOwner.current.conversationId !== owner.conversationId) return;
          await stageKeyboardMedia(media);
        } else {
          const [slot] = reserveStaged(1);
          if (slot) await prepareStaged(slot, file);
        }
      } catch {
        if (alive.current) setError("That image couldn't be added. Try another one.");
      }
    }
    if (accepted.length < files.length) {
      setError(`Only ${MAX_STAGED_PHOTOS} attachments can be reviewed at once. The first ${accepted.length} were added.`);
    }
  }
  async function choosePhoto(source: "photos" | "camera") {
    if (Capacitor.getPlatform() !== "android") {
      // A camera capture is a real camera on the web too. The old `capture`
      // file input was a gallery dialog on desktop, which is exactly what the
      // owner rejected; the shared camera surface opens the device instead.
      if (source === "camera") setCameraOpen(true);
      else photoInput.current?.click();
      return;
    }
    picking.current = true;
    try {
      if (source === "camera") {
        // The canonical native capture path, never the gallery relabelled.
        const imported = await chooseNativeImage({ source: "camera" });
        if (!imported) return;
        const [slot] = reserveStaged(1);
        if (!slot) return;
        await prepareStaged(slot, importedImageToFile(imported));
        return;
      }
      // null is a real cancel; an empty array is a picker that returned no
      // grant, which must be visible rather than silently doing nothing.
      const uris = await chooseNativeImages({ source: "photos", limit: MAX_STAGED_PHOTOS });
      if (!uris) return;
      if (uris.length === 0) { setError("That photo could not be read. Try a different one."); return; }
      const room = Math.max(0, MAX_STAGED_PHOTOS - photos.length);
      const accepted = uris.slice(0, room);
      if (accepted.length === 0) { setError(`You can send up to ${MAX_STAGED_PHOTOS} photos at once.`); return; }
      const slots = reserveStaged(accepted.length);
      // Import one at a time: the canonical intake already bounds and strips
      // each derivative, and a serial pass keeps the tray in picker order.
      for (const [index, uri] of accepted.entries()) {
        const slot = slots[index];
        if (!slot) continue;
        try {
          const imported = await importNativeImageUri(uri);
          if (alive.current) await prepareStaged(slot, importedImageToFile(imported));
        } catch {
          if (alive.current) setPhotos((list) => list.map((item) => item.key === slot.key ? { ...item, preparing: false, error: true } : item));
        }
      }
      if (accepted.length < uris.length) setError(`Only ${MAX_STAGED_PHOTOS} photos can be reviewed at once. The first ${accepted.length} were added.`);
    } catch { setError("Could not open that photo. Please try again."); }
    finally { picking.current = false; }
  }
  /**
   * A video joins the same review tray but keeps its own bytes: the private
   * file lane carries it unchanged, and no poster frame is invented for it.
   * The slot names the file instead of pretending to be a photo.
   */
  function stageVideo(slot: StagedChatPhoto, file: File) {
    setPhotos((list) => list.map((entry) => entry.key === slot.key
      ? { ...entry, kind: "video", file, name: file.name, preparing: false, error: false }
      : entry));
  }
  /**
   * Web/browser pick: one selection may mix photos and videos. A still goes
   * through the canonical codec and its retry identity; a video skips decoding
   * and is staged with the same admission rules the tray already applies.
   */
  async function stageLocalFiles(files: File[]) {
    // A picker or camera can resolve after the conversation changed, or while
    // another send owns the composer. Without the same canonical gates the
    // paste path uses, a request or blocked thread would still accept items
    // that Send can never take, leaving an unsendable tray.
    if (!runtimeOpen || !row) return;
    if (!photoAllowed) { setError("Photos and videos are available when you're friends."); return; }
    if (photoSending || filesSending || admissionFailed || requestAccepting || voiceSending) {
      setError("Wait for the current send to finish before adding an attachment.");
      return;
    }
    const owner = { ...conversationOwner.current };
    const usable = files.filter((file) => stagedKindOf(file) !== null);
    if (usable.length < files.length) setError("Only photos and videos can be added here.");
    const room = Math.max(0, MAX_STAGED_PHOTOS - photos.length);
    // A clip travels the file lane, so it must pass that lane's gate before it
    // takes a review slot: a slot holding a file that can never be sent would
    // fail on Send with no way back except removing it by hand.
    const accepted: File[] = [];
    let refusal: string | null = null;
    for (const file of usable.slice(0, room)) {
      const problem = stagedKindOf(file) === "video" ? validateChatFile(file) : null;
      if (problem) { refusal ??= problem; continue; }
      accepted.push(file);
    }
    if (refusal) setError(refusal);
    if (accepted.length === 0) {
      if (usable.length > 0 && !refusal) setError(`You can send up to ${MAX_STAGED_PHOTOS} attachments at once.`);
      return;
    }
    const slots = reserveStaged(accepted.length);
    for (const [index, file] of accepted.entries()) {
      const slot = slots[index];
      if (!slot) continue;
      // A still preparation yields, so the rest of the selection must be
      // checked against the owner that started it before staging anything.
      if (!alive.current || conversationOwner.current.accountId !== owner.accountId
        || conversationOwner.current.conversationId !== owner.conversationId) return;
      if (stagedKindOf(file) === "video") stageVideo(slot, file);
      else await prepareStaged(slot, file);
    }
    if (!refusal && accepted.length < usable.length) setError(`Only ${MAX_STAGED_PHOTOS} attachments can be reviewed at once. The first ${accepted.length} were added.`);
  }
  useEffect(() => {
    const update = () => setDocVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  // Keyboard/provider insertion is advertised only while this composer is the
  // live, writable target of a connected conversation. `composerIntent` is the
  // press-before-focus prearm: it widens admission earlier in the same
  // interaction, never the send authority. The same session owns pasted
  // animations, so both arrivals share one admission path.
  const keyboardMediaEligible = photoAllowed && runtimeOpen && visible
    && (composerFocused || composerIntent)
    && !voiceActive && !requestAccepting && !photoSending && !filesSending && !voiceSending && !admissionFailed;
  // Layout order matters: the session must exist before the advertisement
  // effect below, or an already-focused composer would never advertise on its
  // first frame (the sync would find no session and nothing changes until the
  // reader blurs and refocuses).
  useLayoutEffect(() => {
    const session = createKeyboardMediaSession({
      onMedia: (media) => stageKeyboardMedia(media),
      onRejected: (message) => { if (alive.current) setError(message); },
    });
    keyboardSession.current = session;
    return () => { session.destroy(); keyboardSession.current = null; };
  }, []);
  useLayoutEffect(() => {
    keyboardSession.current?.sync(keyboardMediaEligible ? { accountId, conversationId } : null);
  }, [keyboardMediaEligible, accountId, conversationId]);
  useEffect(() => {
    if (chat.accountId !== accountId || (chat.status === "opening" && !chat.localReady) || chat.status === "closed") return;
    let cancelled = false;
    void readMessagingThreadState(accountId, conversationId).then((state) => {
      if (cancelled) return;
      setMessages(state.messages); setOutbox(state.outbox); setMedia(state.media); setLoaded(true);
      const ids = new Set(state.messages.map(message => message.id));
      setLocalEchoes(previous => previous.filter(entry => !ids.has(entry.message.id)));
      setRenderedRevision(chat.revision); setThreadReadFailed(false);
    }).catch(() => { if (!cancelled) setThreadReadFailed(true); });
    void readMessagingUnsentHoldIds(accountId, conversationId).then((ids) => {
      if (!cancelled) setHeldMessageIds(new Set(ids));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [accountId, conversationId, chat.accountId, chat.status, chat.localReady, chat.revision, threadReadRetry]);
  /**
   * The messages a person report may carry: accepted, sent by this peer, not
   * unsent, and newest first. A local pending row has no server position and a
   * body-less TEXT row has no evidence left, so neither is offered.
   */
  const personEvidence = useMemo(() => {
    const peerId = row?.peerId;
    if (!peerId) return [];
    return messages
      .filter((message) => message.authorId === peerId && message.server !== undefined && message.unsentAt === undefined)
      .slice()
      .reverse()
      .map((message) => {
        const messageType = message.messageType === "MEDIA" || message.messageType === "VOICE"
          || message.messageType === "LOCATION" ? message.messageType : "TEXT" as const;
        return { id: message.id, messageType, body: message.body,
          ...(message.createdAt !== undefined ? { createdAt: message.createdAt } : {}) };
      })
      .filter((message) => message.messageType !== "TEXT" || message.body.trim() !== "");
  }, [messages, row?.peerId]);
  // Do not draw a dead chip for a message this device cannot see.
  const pinnedIds = view?.pinnedMessageIds ?? [];
  const pinnedRows = pinnedIds.flatMap((id) => {
    const message = messages.find(entry => entry.id === id);
    return message && message.unsentAt === undefined ? [{ id, message }] : [];
  });
  useEffect(() => {
    if (sheet || !jumpTo) return;
    const targetId = jumpTo;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(scroll.current?.querySelectorAll<HTMLElement>("[data-chat-message]") ?? [])
        .find(element => element.dataset.chatMessage === targetId);
      // An album paints at most four cells, so a reply, pin or search hit on a
      // hidden fifth member has no row to land on. The album still lists every
      // member id, so the jump lands on the album itself instead of a row that
      // was never rendered.
      const album = target ? null : Array.from(scroll.current?.querySelectorAll<HTMLElement>("[data-chat-run-members]") ?? [])
        .find(element => (element.dataset.chatRunMembers ?? "").split(" ").includes(targetId));
      const destination = target ?? album;
      // A long smooth travel spends the whole ring before the original is even
      // on screen. Snap when the target is more than a viewport away and keep
      // the travel only for the short, legible case.
      const box = destination?.getBoundingClientRect();
      const viewport = scroll.current?.getBoundingClientRect();
      const travel = box && viewport && !shouldReduceMotion()
        ? Math.abs((box.top + box.bottom) / 2 - (viewport.top + viewport.bottom) / 2) : Infinity;
      const snap = shouldReduceMotion() || travel > (viewport?.height ?? 0);
      destination?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: snap ? "auto" : "smooth" });
      destination?.focus({ preventScroll: true });
      // A ring, not a second screen: the original is already here, it only has
      // to be findable after a long scroll. Only a real row rings; the album is
      // the honest fallback and must not flash a member it does not paint.
      if (target) setFlash(previous => ({ id: targetId, nonce: (previous?.nonce ?? 0) + 1 }));
      setJumpTo(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [sheet, jumpTo]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const highest = messages.reduce((maximum, message) => Math.max(maximum, message.server?.sequence ?? 0), 0);
  useEffect(() => {
    const area = scroll.current;
    if (!area || !loaded || threadBlocked) return;
    const checkRead = () => {
      const distance = area.scrollHeight - area.scrollTop - area.clientHeight;
      // Follow comes from the transcript hook, so a reader who scrolled up
      // is never marked read just because new content arrived. `receiptsActive`
      // also refuses a hidden/minimized window, whose zero measured distance
      // would otherwise read as "at the bottom" on a visibilitychange.
      if (!receiptsActive || !transcript.following.current
        || distance >= FOLLOW_PX || highest <= lastMarked.current) return;
      lastMarked.current = highest;
      void markMessagingConversationRead(accountId, conversationId, highest).catch(() => { lastMarked.current = 0; });
    };
    checkRead();
    area.addEventListener("scroll", checkRead, { passive: true });
    document.addEventListener("visibilitychange", checkRead);
    return () => {
      area.removeEventListener("scroll", checkRead);
      document.removeEventListener("visibilitychange", checkRead);
    };
  }, [accountId, conversationId, highest, loaded, threadBlocked, receiptsActive]);

  // This is live, disposable receipt authority, never the stored unread cursor.
  // A fetched context precedes a fresh geometric observation of an inbound bubble.
  useLayoutEffect(() => {
    const area = scroll.current;
    const projections = chat.currentProjections;
    if (threadBlocked || !area || !loaded || !receiptsActive || sheet !== null || reportTarget || viewer || chat.accountId !== accountId || chat.status !== "ready"
      || !projections || !receiptAuthority || current?.mode !== "CONNECTED" || current.ownBlocked) return;
    const controller = new AbortController();
    let context: string | null = null;
    let lastObserved: string | null = null;
    let requestedKey: string | null = null;
    let wantedIds: string[] = [];
    let version = 0;
    let running = false;
    let frame = 0;
    const lookup = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        while (!controller.signal.aborted) {
          const ticket = version;
          const ids = wantedIds;
          const batches = ids.length ? Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, (i + 1) * 100)) : [[]];
          let batchContext: string | null | undefined;
          const readIds = new Set<string>();
          let mismatched = false;
          for (const batch of batches) {
            const result = await fetchMessagingReceiptView(accountId, conversationId, batch, controller.signal);
            if (controller.signal.aborted || ticket !== version || document.visibilityState !== "visible") break;
            if (batchContext === undefined) {
              batchContext = result.context;
              if (context !== batchContext) { context = null; lastObserved = null; }
            }
            else if (batchContext !== result.context) { mismatched = true; break; }
            for (const id of result.readIds) readIds.add(id);
          }
          if (controller.signal.aborted || document.visibilityState !== "visible") return;
          if (ticket !== version) continue;
          if (mismatched || batchContext === undefined) {
            context = null;
            lastObserved = null;
            requestedKey = null;
            return;
          }
          if (context !== batchContext) lastObserved = null;
          context = batchContext;
          for (const id of readIds) confirmedReads.current.add(id);
          if (readIds.size) setReadIds(new Set(confirmedReads.current));
          checkVisible();
          if (ticket !== version) continue;
          return;
        }
      } catch {
        // A failed lookup is not evidence that the peer unread a message. It
        // cannot authorize observation, but does not erase same-context knowledge.
        if (!controller.signal.aborted) { context = null; lastObserved = null; requestedKey = null; }
      } finally { running = false; }
    };
    const checkVisible = () => {
      if (controller.signal.aborted || document.visibilityState !== "visible") return;
      const container = area.getBoundingClientRect();
      const candidates = messages.filter((message) => message.server && message.unsentAt === undefined && message.messageType);
      const visibleOwn: string[] = [];
      const bubbles = new Map(Array.from(area.querySelectorAll<HTMLElement>("[data-receipt-message]"),
        (element) => [element.dataset.receiptMessage, element] as const));
      let boundary: StoredHumanMessage | undefined;
      for (const message of candidates) {
        const ownUnread = message.authorId === accountId
          && !message.readByPeer && !confirmedReads.current.has(message.id);
        const unobservedInbound = message.authorId !== accountId
          && !message.receiptObserved && !confirmedObservations.current.has(message.id)
          && (!boundary || message.server!.sequence > boundary.server!.sequence);
        // Only a message that can change the answer earns a layout read. The
        // old order measured every bubble on every scroll frame, which is the
        // gesture the owner described as laggy.
        if (!ownUnread && !unobservedInbound) continue;
        const bubble = bubbles.get(message.id);
        if (!bubble) continue;
        const bounds = bubble.getBoundingClientRect();
        if (bounds.bottom <= Math.max(container.top, 0) || bounds.top >= Math.min(container.bottom, window.innerHeight)
          || bounds.right <= Math.max(container.left, 0) || bounds.left >= Math.min(container.right, window.innerWidth)) continue;
        if (ownUnread) visibleOwn.push(message.id);
        else boundary = message;
      }
      if (!visibleOwn.length && !boundary) return;
      const key = JSON.stringify(visibleOwn);
      if (key !== requestedKey) {
        requestedKey = key;
        wantedIds = visibleOwn;
        version += 1;
        void lookup();
      }
      if (!context || !boundary || lastObserved === boundary.id) return;
      const id = boundary.id;
      lastObserved = id;
      void observeMessagingReceipt(accountId, conversationId, context, id, controller.signal)
        .then((accepted) => {
          if (accepted) {
            for (const message of messages) {
              if (message.recipientId === accountId && message.server && message.server.sequence <= boundary!.server!.sequence) {
                confirmedObservations.current.add(message.id);
              }
            }
          } else if (lastObserved === id) lastObserved = null;
        })
        .catch(() => { if (lastObserved === id) lastObserved = null; });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; checkVisible(); });
    };
    area.addEventListener("scroll", schedule, { passive: true });
    // A loaded READY photo becomes eligible without waiting for another scroll.
    // Capture non-bubbling image loads; the next frame sees React's loaded DOM.
    area.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      controller.abort();
      if (frame) window.cancelAnimationFrame(frame);
      area.removeEventListener("scroll", schedule);
      area.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [accountId, conversationId, chat.accountId, chat.status, chat.currentProjections, current, receiptAuthority, loaded, messages, receiptsActive, sheet, reportTarget, viewer, threadBlocked]);

  async function setMuted(muted: boolean) {
    if (busy || chat.status !== "ready" || typeof current?.ownMuted !== "boolean") return;
    setBusy(true); setError(null);
    try {
      await setMessagingMuted(accountId, conversationId, muted);
    } catch { if (alive.current) setError("Your notifications change could not be saved. Sync and try again."); }
    finally { if (alive.current) setBusy(false); }
  }
  /** Pins are conversation-wide; the server owns the three-item limit. */
  async function setPinned(message: StoredHumanMessage, pinned: boolean) {
    if (busy || current?.mode !== "CONNECTED") return;
    setBusy(true); setError(null);
    try {
      await pinMessagingMessage(accountId, conversationId, message.id, pinned);
      if (alive.current) announce(pinned ? "Message pinned." : "Message unpinned.");
    } catch {
      if (alive.current) setError(pinned
        ? "This message could not be pinned. Sync and try again."
        : "This message could not be unpinned. Sync and try again.");
    } finally { if (alive.current) setBusy(false); }
  }
  async function relationship(action: "accept" | "end" | "hide" | "unhide" | "decline") {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await changeMessagingRelationship(accountId, conversationId, action);
      if (alive.current) { setSheet(null); announce("Conversation refreshed."); }
    } catch { if (alive.current) setError("That change could not be saved. Try again."); }
    finally { if (alive.current) setBusy(false); }
  }
  /** One explicit, user-initiated static share. Never tracked, never automatic,
   * and never available before the connection exists. */
  async function shareLocation(location: StaticLocation) {
    if (!row || !locationAllowed || !alive.current) throw new Error("Conversation unavailable");
    await sendMessagingLocation(accountId, conversationId, row.peerId, copyStaticLocation(location));
    if (alive.current) transcript.followLatest();
  }
  /** A discarded note is gone: a later note must not reuse its attachment id. */
  function discardVoice() {
    if (admission.current?.messageType === "VOICE") admission.current = null;
    // A finalize or hash still in flight must not reach the service after the
    // reader threw the note away.
    voiceSendDiscarded.current = true;
    voice.recorder.discard();
  }
  function toggleVoiceCapture() {
    if (!voiceAllowed || voiceSending) return;
    if (voiceStatus === "recording") { voice.recorder.pause(); return; }
    if (voiceStatus === "starting" || voiceStatus === "pausing" || voiceStatus === "review") return;
    if (admission.current?.messageType === "VOICE") admission.current = null;
    void voice.recorder.start();
  }
  function resumeVoice() {
    if (!voiceAllowed || voiceSending || admissionFailed) return;
    voice.player.pause();
    voice.recorder.resume();
  }
  async function previewVoice() {
    if (voiceStatus !== "review" || !voiceRecording || !voiceUrl) return;
    if (playbackSnapshot.playingId === "voice-draft") { voice.player.pause(); return; }
    if (!voice.player.load("voice-draft", voiceUrl, voiceRecording.durationMs)) return;
    await voice.player.play();
  }
  /**
   * The recording is consumed only after the durable outbox admits it: a failed
   * send leaves the preview and its exact attachment identity in place, so the
   * retry is the same note rather than a re-recorded one.
   */
  async function sendVoice() {
    // Send works during the take as well as from review (owner direction
    // 2026-11-18): one press stops what has been recorded so far and sends it.
    if (!row || !voiceAllowed || voiceSending) return;
    if (voiceStatus !== "review" && voiceStatus !== "recording" && voiceStatus !== "pausing") return;
    voiceSendDiscarded.current = false;
    setVoiceSendPhase("preparing"); setError(null);
    try {
      const recording = await voice.recorder.stopAndFinalize();
      if (!recording || !alive.current || voiceSendDiscarded.current) return;
      const mime = storedVoiceMime(recording.mime);
      if (mime !== "audio/webm" && mime !== "audio/mp4") throw new Error("Unsupported voice container");
      const bytes = await recording.blob.arrayBuffer();
      const attempt = admission.current?.messageType === "VOICE" ? admission.current : {
        messageType: "VOICE" as const,
        caption: "",
        metadata: {
          id: crypto.randomUUID(), messageId: crypto.randomUUID(), direction: "OUT" as const,
          sha256: await sha256Hex(bytes), mime: mime as MediaMime, byteSize: bytes.byteLength,
          width: VOICE_SENTINEL_EDGE, height: VOICE_SENTINEL_EDGE, durationMs: recording.durationMs,
          expiresAt: null,
        },
      };
      admission.current = attempt;
      // Preparation ends here. A discard, or an unmounted thread, during the
      // finalize, the container read or the hash must not become a service
      // call, so the boundary is checked immediately before the one call that
      // hands the note to the durable outbox.
      if (!alive.current || voiceSendDiscarded.current) return;
      setVoiceSendPhase("sending");
      await sendMessagingVoice(accountId, conversationId, row.peerId, attempt.metadata, bytes, replyTo?.id);
      if (!alive.current) return;
      transcript.followLatest();
      admission.current = null;
      setAdmissionFailed(false);
      setReplyTo(null);
      voice.player.pause();
      voice.recorder.take();
      announce("Voice message sent.");
    } catch {
      // The ids stay for an identical retry, but the composer must not stay
      // locked: that is the same rule the photo path already follows.
      if (alive.current) { setAdmissionFailed(true); setError("That voice message could not be saved. Try sending it again."); }
    } finally { if (alive.current) setVoiceSendPhase("idle"); }
  }
  /**
   * Normal conversation is not a form submission: the durable outbox admits the
   * message, the draft clears, and the next message can start immediately. Only
   * authority/destructive actions take `busy`.
   */
  async function admitText(message: StoredHumanMessage, onAdmitted?: () => void, createdAt?: number) {
    // Once the durable boundary reported, nothing later may relabel the row as
    // an admission failure: the outbox owns it and retrying would duplicate it.
    let admitted = false;
    const settle = onAdmitted === undefined ? undefined : () => { admitted = true; onAdmitted(); };
    setLocalEchoes(previous => {
      const entry = { message, failed: false };
      return previous.some(item => item.message.id === message.id)
        ? previous.map(item => item.message.id === message.id ? entry : item)
        : [...previous, entry];
    });
    transcript.followLatest();
    try {
      // Ordinary sends keep the runtime's own commit instant and the exact
      // argument list; only a split link needs to place itself after a batch.
      if (createdAt === undefined) {
        return await sendMessagingText(accountId, conversationId, message.recipientId, message.body,
          message.contextReportId, message.replyToId, message.id, settle);
      }
      return await sendMessagingText(accountId, conversationId, message.recipientId, message.body,
        message.contextReportId, message.replyToId, message.id, settle, createdAt);
    } catch (error) {
      if (admitted) return message.id;
      if (alive.current) setLocalEchoes(previous => previous.map(item =>
        item.message.id === message.id ? { ...item, failed: true } : item));
      throw error;
    }
  }

  /**
   * A reply is also how the recipient accepts a message request. Accept through
   * the canonical relationship action, wait for its refresh, and only then let
   * the message leave. A failed accept leaves the draft in place and says why.
   */
  async function acceptIncomingRequestForReply(): Promise<boolean> {
    if (view?.mode !== "REQUEST" || view.request !== "INCOMING") return true;
    // A second Enter while the first accept is still in flight must not send a
    // second accept: the server would reject the already-connected second one
    // and paint an error over a message that actually went out.
    if (requestAcceptingRef.current) return false;
    const owner = { ...conversationOwner.current };
    requestAcceptingRef.current = true;
    setRequestAccepting(true);
    setSendStatus("Accepting this request…");
    try {
      await changeMessagingRelationship(accountId, conversationId, "accept");
      return true;
    } catch {
      if (ownsThread(owner)) setError("That request could not be accepted. Try again.");
      return false;
    } finally {
      requestAcceptingRef.current = false;
      if (alive.current) { setRequestAccepting(false); setSendStatus(null); }
    }
  }

  async function send() {
    if (!runtimeOpen || !row || photoSending || requestAccepting || filesSending) return;
    // The composer admits one send at a time. Typing stays editable, and the
    // next admission begins as soon as this one is durable (its callback) or
    // settles; never in parallel with an uncommitted one.
    if (admissionLatch.current) return;
    // Every staged item must be ready. Stills travel the photo lane; animations
    // keep their frames through the existing private file lane.
    const ready = photos.filter((item) => !!item.prepared || !!item.file);
    if (photos.length > 0 && ready.length !== photos.length) return;
    if (photos.length > 0 && (view?.mode !== "CONNECTED" || view.ownBlocked)) return;
    if (photos.length === 0 && !draft.trim()) return;
    // Taken before the first await: accepting an incoming request is a round
    // trip, and a second activation during it must not admit the reply twice.
    const latch = Symbol("send");
    admissionLatch.current = latch;
    const releaseAdmission = () => { if (admissionLatch.current === latch) admissionLatch.current = null; };
    // Captured before the first await, together with the body and revision it
    // carries. The accept round trip yields, and whatever the field holds when
    // it returns must never become the message this activation submitted: that
    // would stamp the old draft with a newer revision and clear the new words.
    const owner = { ...conversationOwner.current };
    const submittedReport = reportContext;
    const replyTargetId = replyTo?.id;
    const body = convertEmoticons(draft);
    const sendingRevision = draftRevision.current;
    const stillOwner = () => ownsThread(owner);
    // Only the invocation that added the revision may release it.
    let ownedTextRevision: number | null = null;
    setError(null); setSendStatus(null);
    try {
      // Only an incoming request needs the accept round trip. Every other send
      // must stay synchronous up to admission, or a queued draft would lose its
      // place to the next keystroke while this turn yields.
      if (view?.mode === "REQUEST" && view.request === "INCOMING"
        && !(await acceptIncomingRequestForReply())) return;
      if (ready.length === 0 && textInFlight.current.has(sendingRevision)) return;
      if (ready.length === 0) { textInFlight.current.add(sendingRevision); ownedTextRevision = sendingRevision; }
      if (ready.length === 0) {
        const messageId = textAttempts.current.get(sendingRevision) ?? crypto.randomUUID();
        textAttempts.current.set(sendingRevision, messageId);
        // The durable outbox commit, not the view read, ends this send's
        // ownership of the submitted text. Clearing on that boundary means a
        // slow or failed refresh cannot leave a sent draft looking unsent.
        const result = await admitText({ id: messageId, conversationId, authorId: accountId, recipientId: row.peerId,
          body, messageType: "TEXT", createdAt: Date.now(),
          ...(submittedReport ? { contextReportId: submittedReport } : {}), ...(replyTargetId ? { replyToId: replyTargetId } : {}) }, () => {
          if (!stillOwner()) return;
          // Only clear what this draft owned: typing that arrived while it was
          // in flight is newer intent and must survive.
          if (draftRevision.current === sendingRevision) clearDraft();
          if (submittedReport) clearReportContext(submittedReport);
          setReplyTo(previous => previous?.id === replyTargetId ? null : previous);
          // The message is durable and its draft is settled: the next deliberate
          // send may begin while this view refresh finishes.
          releaseAdmission();
        });
        textAttempts.current.delete(sendingRevision);
        if (stillOwner()) {
          transcript.followLatest();
          // Also settle here when the caller returned without an admission
          // callback: the resolved result still proves the row committed.
          if (draftRevision.current === sendingRevision) clearDraft();
          if (submittedReport) clearReportContext(submittedReport);
          setReplyTo(previous => previous?.id === replyTargetId ? null : previous);
          setAdmissionFailed(false);
          if (typeof result !== "string" && result.viewStale) setSendStatus("Message saved to send. The view may be out of date.");
        }
      } else {
        setPhotoSending(true);
        // Each item is its own message, so a failed one leaves the rest of the
        // stack intact. The caption rides the first message that actually
        // leaves, whichever lane carries it. A retry keeps the instant (and,
        // for an animation, the message id) of the admission that already left.
        const prior = [...photoAdmissions.current.values(), ...fileAdmissions.current.values()];
        const batchCreatedAt = prior.length > 0
          ? Math.min(...prior.map((entry) => entry.createdAt))
          : Date.now();
        // A bare preview link is its own message, not a caption for the first
        // photo: the batch stays captionless and the link follows as text.
        const splitPreviewLink = isStandalonePreviewBody(body);
        let consumed = false;
        for (const item of photos) {
          const admissionKey = item.key;
          const caption = consumed || splitPreviewLink ? "" : body;
          // The caption this item actually carries. A retry reuses the caption
          // its first attempt stored, so text typed after the failure is not
          // silently dropped by the success that clears the field below.
          let sentCaption = "";
          if (item.prepared) {
            const { bytes, ...info } = item.prepared;
            const attempt = photoAdmissions.current.get(admissionKey) ?? { caption,
              // Keep the send instant across retries.
              createdAt: batchCreatedAt,
              metadata: { ...info, durationMs: null,
                id: crypto.randomUUID(), messageId: crypto.randomUUID(), direction: "OUT" as const, expiresAt: null } };
            photoAdmissions.current.set(admissionKey, attempt);
            sentCaption = attempt.caption;
            await sendMessagingMedia(accountId, conversationId, row.peerId, sentCaption, attempt.metadata, bytes, replyTargetId, attempt.createdAt);
            photoAdmissions.current.delete(admissionKey);
          } else if (item.file) {
            const problem = validateChatFile(item.file);
            if (problem) throw new Error(problem);
            // The file lane keeps its own message id, the batch's composition
            // instant and the caption it first carried, so a refused animation
            // or video retries the same message inside the same media run
            // instead of starting a new one at the retry time.
            const fileAdmission = fileAdmissions.current.get(admissionKey) ?? {
              messageId: crypto.randomUUID(), createdAt: batchCreatedAt, caption,
            };
            fileAdmissions.current.set(admissionKey, fileAdmission);
            sentCaption = fileAdmission.caption;
            const meta = await uploadChatFile(item.file, { userId: accountId, conversationId });
            try {
              await sendMessagingText(accountId, conversationId, row.peerId,
                chatFileBody(meta, sentCaption), undefined, replyTargetId, fileAdmission.messageId, undefined, fileAdmission.createdAt);
            } catch (error) {
              // A refusal removes the object it uploaded, so retry never leaves
              // bytes the transcript cannot name.
              await removeChatFile(meta.key);
              throw error;
            }
            fileAdmissions.current.delete(admissionKey);
          } else {
            // The readiness guard above makes this unreachable; never send a
            // half-prepared item.
            throw new Error("Attachment not ready");
          }
          // Clear only the text this message carried. A retry that sends the
          // caption from its first attempt must leave a newer edit in place for
          // the reader to send as its own message.
          if (!consumed && stillOwner()) {
            consumed = true;
            transcript.followLatest();
            // A split link leaves after the batch; only then does the draft clear.
            if (!splitPreviewLink && sentCaption === body && draftRevision.current === sendingRevision) {
              clearDraft();
            }
            setReplyTo(null);
          }
          if (stillOwner()) setPhotos((list) => {
            const removed = list.find((entry) => entry.key === admissionKey);
            if (removed) releaseStagedUrl(removed);
            return list.filter((entry) => entry.key !== admissionKey);
          });
        }
        // The batch is complete. A standalone preview body now leaves as the
        // text message it is, with a fresh instant so it sorts after the media
        // and ends the run. Only that admission clears the draft.
        if (splitPreviewLink && stillOwner()) {
          const linkRevision = sendingRevision;
          textInFlight.current.add(linkRevision);
          ownedTextRevision = linkRevision;
          const messageId = textAttempts.current.get(linkRevision) ?? crypto.randomUUID();
          textAttempts.current.set(linkRevision, messageId);
          const linkCreatedAt = Math.max(Date.now(), batchCreatedAt + 1);
          try {
            await admitText({ id: messageId, conversationId, authorId: accountId, recipientId: row.peerId,
              body, messageType: "TEXT", createdAt: linkCreatedAt }, () => {
              // Clear on the durable boundary, but keep the latch: the next send
              // may begin only once this split admission has fully settled.
              if (!stillOwner()) return;
              if (draftRevision.current === sendingRevision) clearDraft();
            }, linkCreatedAt);
            textAttempts.current.delete(linkRevision);
            if (stillOwner()) {
              transcript.followLatest();
              if (draftRevision.current === sendingRevision) clearDraft();
              setAdmissionFailed(false);
            }
          } catch {
            // The media already left; keep the draft and the stored id so the
            // same link can retry instead of re-merging into the next media.
            if (stillOwner()) {
              setError("Your attachments were sent, but the link was not. Tap Send to try again.");
            }
          }
        }
        if (stillOwner()) { transcript.followLatest(); setAdmissionFailed(false); }
      }
    } catch {
      if (stillOwner()) {
        if (photos.length > 0) {
          setAdmissionFailed(true);
          setError(stagedAttachments
            ? "Those attachments could not all be saved. The unsent ones are still here."
            : "Those photos could not all be saved. The unsent ones are still here.");
        }
        else {
          // The optimistic bubble IS the draft while this window stays open: it
          // stays in the transcript marked "Not sent" with Retry, so the field
          // must not also hold a second copy of the same words. The stored draft
          // is deliberately NOT cleared: a rejected admission may have persisted
          // nothing, and the local echo dies with this window, so the store is
          // the only place those words survive. Typing that arrived while the
          // send was in flight (a newer revision) is untouched.
          if (draftRevision.current === sendingRevision) { draftRevision.current++; setDraft(""); }
          setError("Your message was not sent. Tap Retry on it.");
        }
      }
    } finally {
      releaseAdmission();
      if (ownedTextRevision !== null) textInFlight.current.delete(ownedTextRevision);
      // Releasing a busy flag is always safe and is never a write into the new
      // thread's intent: not releasing it would leave a reused composer wedged.
      if (alive.current) setPhotoSending(false);
    }
  }
  /**
   * A Klipy sticker or GIF travels as the message body: the provider URL is
   * the media, and the transcript renders an allowlisted Klipy URL as the
   * picture rather than as text. No bytes are copied into Storage, so a
   * sticker costs no upload and keeps its animation; the chat media lane only
   * accepts still JPEG/PNG/WebP.
   */
  function sendKlipy(item: KlipyItem) {
    if (!runtimeOpen || !row || admissionLatch.current) return;
    // A sticker is a complete message: a doubled provider pick is a doubled
    // admission unless the composer refuses the second one synchronously.
    const latch = Symbol("sticker");
    admissionLatch.current = latch;
    const releaseAdmission = () => { if (admissionLatch.current === latch) admissionLatch.current = null; };
    const replyTargetId = replyTo?.id;
    setError(null); setSendStatus(null);
    void (async () => {
      try {
        if (view?.mode === "REQUEST" && view.request === "INCOMING"
          && !(await acceptIncomingRequestForReply())) return;
        await admitText({ id: crypto.randomUUID(), conversationId, authorId: accountId, recipientId: row.peerId,
          body: klipyMessageBody(item), messageType: "TEXT", createdAt: Date.now(), ...(replyTargetId ? { replyToId: replyTargetId } : {}) },
          releaseAdmission);
        if (!alive.current) return;
        transcript.followLatest();
        setReplyTo(previous => previous?.id === replyTargetId ? null : previous);
        setAdmissionFailed(false);
      } catch {
        if (alive.current) setError("Your sticker was not sent. Try again.");
      } finally {
        releaseAdmission();
      }
    })();
  }

  /**
   * A document, video, audio file or archive. Uploaded to the private file
   * bucket first, then sent as a text message carrying the marker. A failed
   * send removes the object it uploaded, so a refusal never leaves bytes the
   * transcript cannot name.
   */
  async function sendFiles(picked: File[]) {
    if (!runtimeOpen || !row || admissionLatch.current || filesSending || photoSending) return;
    if (view?.mode !== "CONNECTED" || view.ownBlocked) {
      setError("Files send once you're friends.");
      return;
    }
    // The whole picked batch keeps the composer until it settles: a text send
    // interleaved with the remaining files would race the shared caption.
    const latch = Symbol("files");
    admissionLatch.current = latch;
    const releaseAdmission = () => { if (admissionLatch.current === latch) admissionLatch.current = null; };
    const sendingRevision = draftRevision.current;
    const replyTargetId = replyTo?.id;
    // One pick is one composition: every file it carries is stamped with the
    // same instant, taken before the first upload yields.
    const batchCreatedAt = Date.now();
    // A bare preview link is its own message, not a caption for the file.
    const body = convertEmoticons(draft);
    const splitPreviewLink = isStandalonePreviewBody(body);
    let caption = splitPreviewLink ? "" : draft.trim();
    let leaving = false;
    let ownedLinkRevision: number | null = null;
    setError(null); setSendStatus(null); setFilesSending(true);
    try {
      for (const file of picked) {
        const problem = validateChatFile(file);
        if (problem) { setError(problem); continue; }
        // A deliberate pick is a new message, and its identity is fixed before
        // the upload so a retry inside this pass can never duplicate it.
        const messageId = crypto.randomUUID();
        const meta = await uploadChatFile(file, { userId: accountId, conversationId });
        try {
          await sendMessagingText(accountId, conversationId, row.peerId, chatFileBody(meta, caption),
            undefined, replyTargetId, messageId, undefined, batchCreatedAt);
        } catch (error) {
          await removeChatFile(meta.key);
          throw error;
        }
        leaving = true;
        caption = "";
      }
      if (leaving && alive.current) {
        if (splitPreviewLink) {
          // The files left without the link caption; send that link now as its
          // own message, after the batch and with a stable retry identity.
          const linkRevision = sendingRevision;
          textInFlight.current.add(linkRevision);
          ownedLinkRevision = linkRevision;
          const messageId = textAttempts.current.get(linkRevision) ?? crypto.randomUUID();
          textAttempts.current.set(linkRevision, messageId);
          const linkCreatedAt = Math.max(Date.now(), batchCreatedAt + 1);
          try {
            await admitText({ id: messageId, conversationId, authorId: accountId, recipientId: row.peerId,
              body, messageType: "TEXT", createdAt: linkCreatedAt }, () => {
              // Clear on the durable boundary; the latch stays held until the
              // split admission settles, so files and text cannot interleave.
              if (!alive.current) return;
              if (draftRevision.current === sendingRevision) clearDraft();
            }, linkCreatedAt);
            textAttempts.current.delete(linkRevision);
            if (alive.current) {
              transcript.followLatest();
              if (draftRevision.current === sendingRevision) clearDraft();
              setAdmissionFailed(false);
            }
          } catch {
            if (alive.current) {
              setError("Your attachments were sent, but the link was not. Tap Send to try again.");
            }
          }
        } else {
          transcript.followLatest();
          if (draftRevision.current === sendingRevision) clearDraft();
          setAdmissionFailed(false);
        }
        setReplyTo(previous => previous?.id === replyTargetId ? null : previous);
      }
    } catch {
      if (alive.current) setError("That file was not sent. Try again.");
    } finally {
      if (ownedLinkRevision !== null) textInFlight.current.delete(ownedLinkRevision);
      releaseAdmission();
      if (alive.current) setFilesSending(false);
    }
  }

  /**
   * Open the report sheet for one message. An unsent message has no body in the
   * transcript, so its hidden retained copy is read here — the single place the
   * body is allowed to leave the hold.
   */
  async function openMessageReport(message: StoredHumanMessage): Promise<void> {
    if (message.unsentAt === undefined) { setReportHold(null); setReportTarget("message"); return; }
    try {
      const hold = await readMessagingUnsentHold(accountId, message.id);
      if (!alive.current) return;
      if (!hold) { setError("That message can no longer be reported."); return; }
      setReportHold({ messageId: message.id, body: hold.body });
      setReportTarget("message");
    } catch {
      if (alive.current) setError("That message could not be opened for reporting.");
    }
  }
  /** One honest clipboard boundary for every copy action: a missing, throwing
   *  or refusing clipboard reports failure and never announces a copy that did
   *  not happen. The call stays inside the user gesture. */
  function copyToClipboard(value: string, done: string, failure: string) {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") { setError(failure); return; }
    try {
      void clipboard.writeText(value).then(() => announce(done), () => setError(failure));
    } catch {
      setError(failure);
    }
  }
  /**
   * The actions that annotate one message. This is the same `ActionMenu` the
   * feed and the report card use, so keyboard, collision placement, dismissal
   * and styling are the app's existing ones rather than a second implementation.
   */
  function messageActions(message: StoredHumanMessage, own: boolean): Array<MenuAction | MenuGroup> {
    const items: Array<MenuAction | MenuGroup> = [];
    // The pointer gesture is a swipe; the menu is the keyboard and desktop path
    // to the same reply, so the capability is never gesture-only.
    if (message.unsentAt === undefined) {
      items.push({ id: "reply", label: "Reply", onAction: () => startReply(message) });
    }
    // Copy follows what the message actually shows (R19-1): visible prose, each
    // safe link, and the report context's canonical public URL. A bare URL is
    // never copied as "text", a serialized marker never escapes, and an unsent
    // body exposes nothing.
    for (const action of messageCopyActions(message)) {
      if (action.kind === "text") {
        items.push({ id: action.id, label: action.label,
          onAction: () => copyToClipboard(action.text, "Message copied.", "Could not copy this message.") });
      } else if (action.kind === "link") {
        items.push({ id: action.id, label: action.label,
          onAction: () => copyToClipboard(action.url, "Link copied.", "Could not copy this link.") });
      } else {
        items.push({ id: action.id, label: action.label, items: action.links.map((link) => ({
          id: link.id, label: link.url,
          onAction: () => copyToClipboard(link.url, "Link copied.", "Could not copy this link."),
        })) });
      }
    }
    // Connected conversations share one pin list (max three). An unsent message
    // is never pinnable; the server also drops its pin when it is unsent.
    if (message.unsentAt === undefined && message.server && view?.mode === "CONNECTED") {
      const pinned = (view.pinnedMessageIds ?? []).includes(message.id);
      items.push({ id: "pin", label: pinned ? "Unpin" : "Pin",
        disabled: busy || (!pinned && (view.pinnedMessageIds?.length ?? 0) >= 3),
        onAction: () => { void setPinned(message, !pinned); } });
    }
    if (own && message.unsentAt === undefined) {
      items.push({ id: "unsend", label: "Unsend", destructive: true, disabled: busy || !view,
        onAction: () => setSheet("unsend") });
    }
    items.push({ id: "delete", label: "Delete for me", destructive: true, disabled: busy || !view,
      onAction: () => setSheet("delete") });
    if (!own && (message.unsentAt === undefined || heldMessageIds.has(message.id))) {
      items.push({ id: "report", label: "Report message", destructive: true, disabled: busy || !view || !row,
        onAction: () => { void openMessageReport(message); } });
    }
    return items;
  }

  /**
   * A report link inside a message body reuses the one live context card, with
   * the current block authority, instead of a second owner of report data.
   */
  const reportPreview = (reportId: string) => <ChatReportContext reportId={reportId}
    safetyKey={view?.ownBlocked ? "blocked" : "clear"} />;

  const selectedMessage = messages.find((message) => message.id === selectedMessageId);
  const selectedNeedsReview = selectedMessage?.authorId === accountId && !selectedMessage.server
    && selectedMessage.unsentAt === undefined
    && outbox.some((entry) => entry.messageId === selectedMessageId && entry.status === "NEEDS_REVIEW");
  async function reviewMessage(action: "send" | "delete") {
    if (busy || !selectedNeedsReview || !selectedMessage) return;
    setBusy(true); setError(null);
    try {
      if (action === "send") await recoverMessagingText(accountId, conversationId, selectedMessage.id);
      else await removeMessagingMessage(accountId, conversationId, selectedMessage.id, false);
      if (alive.current) { setSheet(null); setSelectedMessageId(null); if (action === "delete") announce("Your copy was removed."); }
    } catch { if (alive.current) setError("Could not confirm this change. Sync and check your chat before trying again."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function erase(action: "delete" | "unsend" | "clear") {
    if (busy || !current) return;
    if (action !== "clear" && !selectedMessage?.server) return;
    if (action === "unsend" && (selectedMessage?.authorId !== accountId || selectedMessage.unsentAt !== undefined)) return;
    setBusy(true); setError(null);
    try {
      if (action === "clear") await clearMessagingConversation(accountId, conversationId, highest);
      else if (selectedMessage) await removeMessagingMessage(accountId, conversationId, selectedMessage.id, action === "unsend");
      if (alive.current) { setSheet(null); setSelectedMessageId(null); announce(action === "unsend" ? "Message unsent." : "Your chat was updated."); }
    } catch {
      if (alive.current) setError("Could not confirm this change. Sync and check your chat before trying again.");
    } finally { if (alive.current) setBusy(false); }
  }
  // Owner direction 2026-11-18: replying to a request is the recipient's
  // decision, so the composer is available while it is incoming. The send path
  // accepts first; declining or hiding it still keeps it closed.
  const incomingOpen = view?.mode === "REQUEST" && view.request === "INCOMING"
    && !view.ownDeclined && !view.ownHidden;
  const canCompose = !!row && !view?.ownBlocked
    && (view?.mode === "CONNECTED" || incomingOpen || (view?.mode === "REQUEST" && view.request !== "INCOMING"));
  const searchTerm = messageQuery.trim().toLowerCase();
  const searchMatches = searchTerm ? messages.filter(message => message.unsentAt === undefined && message.body.toLowerCase().includes(searchTerm)) : [];
  const gallery = photoAllowed ? messages.filter(message => message.messageType === "MEDIA" && message.unsentAt === undefined)
    .flatMap(message => { const attachment = media.find(item => item.messageId === message.id); return attachment ? [attachment] : []; }) : [];
  const confirming = sheet === "end" || sheet === "delete" || sheet === "unsend" || sheet === "clear";
  // One ordered partition of the transcript: a lone message is its own row, and
  // consecutive photos/videos inside the rolling window form one bound media
  // run. The window is the only grouping key the stored rows carry; it is not
  // proof of a real picker batch, so two quick separate sends can share a run.
  const mediaRuns = useMemo(() => buildMediaRuns(messages, media), [messages, media]);
  // Display rule (owner direction 2026-11-20): a run below the album size stays
  // separate - each item is its own message row with its own bubble, time,
  // receipt, swipe and menu - and only four or more collapse into the album.
  const renderRuns = useMemo(() => splitSmallMediaRuns(mediaRuns, MEDIA_RUN_VISIBLE_LIMIT), [mediaRuns]);
  const messageIndexes = useMemo(() => new Map(messages.map((message, index) => [message.id, index] as const)), [messages]);
  const confirmationTitle = sheet === "end" ? "Remove friend?" : sheet === "unsend" ? "Unsend message?" : sheet === "clear" ? "Clear chat for me?" : "Delete for me?";
  // One action list, rendered in the wide third pane and in the compact sheet.
  const conversationInfo = <div className="fb-chat-sheet">
    {person?.username && <Link className="fb-chat-info-row" to={`/u/${encodeURIComponent(person.username)}`}><UserRound size={20} aria-hidden="true" /><span>View profile</span></Link>}
    <button type="button" className="fb-chat-info-row" onClick={() => setSheet("search")}><Search size={20} aria-hidden="true" /><span>Search chat</span></button>
    <button type="button" className="fb-chat-info-row" onClick={() => setSheet("media")}><Images size={20} aria-hidden="true" /><span>Media</span></button>
    {presentationView?.mode === "CONNECTED" && !presentationView.ownBlocked && !presentationView.ownDeclined
      && <button type="button" className="fb-chat-info-row" disabled={!locationAllowed}
        onClick={() => { if (locationAllowed) setSheet("location"); }}><MapPin size={20} aria-hidden="true" /><span>Share location</span></button>}
    <hr className="fb-chat-info-divider" />
    {typeof presentationView?.ownMuted === "boolean" ? <PreferenceSwitchRow className="fb-chat-mute" title="Mute notifications" icon={BellOff}
      checked={presentationView.ownMuted} disabled={busy || chat.status !== "ready" || typeof current?.ownMuted !== "boolean"}
      onChange={muted => void setMuted(muted)} /> : <p className="fb-chat-secondary">Sync to change chat notifications.</p>}
    <RetrySync accountId={accountId} labelled />
    <Link className="fb-chat-info-row" to="/settings/privacy/messages"><Settings2 size={20} aria-hidden="true" /><span>Message settings</span></Link>
    <hr className="fb-chat-info-divider" />
    {presentationView && <button type="button" className="fb-chat-info-row" disabled={busy || !current}
      onClick={() => { if (!current) return; void relationship(current.ownHidden ? "unhide" : "hide"); }}>
      <Archive size={20} aria-hidden="true" /><span>{presentationView.ownHidden ? "Move to inbox" : presentationView.mode === "CONNECTED" ? "Archive" : "Hide request"}</span></button>}
    {presentationView?.mode === "CONNECTED" && <button type="button" className="fb-chat-info-row" disabled={busy || !current}
      onClick={() => { if (current?.mode === "CONNECTED") setSheet("end"); }}><LogOut size={20} aria-hidden="true" /><span>Remove friend</span></button>}
    <button type="button" className="fb-chat-info-row" disabled={busy || !current || highest === 0 || outbox.length > 0} onClick={() => setSheet("clear")}><Trash2 size={20} aria-hidden="true" /><span>Clear chat for me</span></button>
    {outbox.length > 0 && <p className="fb-chat-secondary">Wait for messages still sending before clearing this chat.</p>}
    <hr className="fb-chat-info-divider" />
    {row && <div className="fb-chat-info-block"><ShieldBan size={20} aria-hidden="true" /><BlockControl userId={row.peerId} name={name || "this account"} blocked={current?.ownBlocked}
      onChanged={() => { void refreshMessaging(accountId).catch(() => undefined); }} /></div>}
    {row && <button type="button" className="fb-chat-info-row" onClick={() => { setSheet(null); setReportTarget("account"); }}><Flag size={20} aria-hidden="true" /><span>Report account</span></button>}
  </div>;
  return <ChatDetailsLayout details={conversationInfo} onCompactOpen={() => setSheet("actions")}
    identity={<><UserAvatar username={name || person?.username} avatarUrl={person?.avatarUrl} size={72} shape="squircle" />
      <strong dir="auto">{name || "Conversation"}</strong><span className="fb-chat-secondary">{!presentationView ? "Saved chat" : presentationView.mode === "CONNECTED" ? "Friends" : "Message request"}</span></>}>
    {detailsToggle => <section ref={pageRef} className="fb-chat-page" aria-label="Conversation" data-surface={surface}>
    <header className="fb-chat-header">
      {!dock && <Link to={CHATS_PATH} className="fb-chat-icon" aria-label="Back to chats"
        onClick={(event) => { if (unsentWork.current) { event.preventDefault(); requestLeave.current("route"); } }}
        {...hoverLabel("Back to chats")}><ArrowLeft size={22} aria-hidden="true" /></Link>}
      <ChatIdentity peerId={row?.peerId} name={name} username={person?.username} avatarUrl={person?.avatarUrl} muted={presentationView?.ownMuted === true}
        conversationId={conversationId} variant={surface === "dock" ? "dock" : undefined}
        status={!presentationView ? "Saved chat" : presentationView.mode === "CONNECTED" ? "Friends" : "Message request"} />
      {dock && !wideApp ? (
        <DialogTrigger isOpen={infoOpen} onOpenChange={setInfoOpen}>
          <Button aria-label="Conversation options" className="fb-chat-icon" {...hoverLabel("Conversation options")}>
            <Info size={21} aria-hidden="true" />
          </Button>
          {/* Anchored a few pixels from its own trigger instead of the modal
              sheet: same conversation-info content, same roles and order,
              closed by Escape or an outside press with focus back on the
              trigger, all owned by React Aria. */}
          <LayeredPopover isNonModal placement="bottom end" offset={4} maxHeight={infoMaxHeight} className="fb-chat-info-popover">
            <Dialog aria-label="Conversation info" className="fb-chat-info-dialog">
              <div className="fb-chat-info-scroll">{conversationInfo}</div>
            </Dialog>
          </LayeredPopover>
        </DialogTrigger>
      ) : detailsToggle}
      {/* The dock reuses the canonical header and adds window controls; it never
          renders the back link, because that would navigate the page beneath. */}
      {dock && <>
        <button type="button" className="fb-chat-icon" aria-label={active ? "Collapse chat" : "Expand chat"}
          aria-expanded={active} onClick={() => onToggleCompact?.()}>
          {active ? <ChevronDown size={20} aria-hidden="true" /> : <ChevronUp size={20} aria-hidden="true" />}
        </button>
        <button type="button" className="fb-chat-icon" aria-label="Open full chat"
          onClick={() => requestLeave.current("expand")}><Maximize2 size={20} aria-hidden="true" /></button>
        <button type="button" className="fb-chat-icon" aria-label="Close chat"
          onClick={() => requestLeave.current("close")}><X size={20} aria-hidden="true" /></button>
      </>}
      {wideApp && <><RetrySync accountId={accountId} /><TopUtilities /></>}
    </header>
    {/* Pinned messages: one compact row directly under the header. Tapping a
        chip uses the same jump as a reply quote — scroll, focus and ring. */}
    {pinnedRows.length > 0 && <div className="fb-chat-pins" role="region" aria-label="Pinned messages">
      {pinnedRows.map(({ id, message }) => {
        const author = message.authorId === accountId ? "You" : name || "Member";
        const preview = replyPreview(message);
        return <button key={id} type="button" className="fb-chat-pin"
          onClick={() => { transcript.suspend(); setJumpTo(id); }}
          aria-label={`Pinned message from ${author}: ${preview}. Show message`}>
          <Pin size={14} aria-hidden="true" />
          <span className="fb-chat-pin-author">{author}</span>
          <span className="fb-chat-pin-preview" dir="auto">{preview}</span>
        </button>;
      })}
    </div>}
    {/* Owner feedback 2026-11-06: a failed refresh is a status, not a lock.
        The transcript keeps its saved messages and the composer keeps working;
        the runtime retries on its own and this stays a single quiet line. */}
    {/* Owner direction 2026-11-06: a device that is more than ten messages
        behind holds the screen — blurred, non-dismissible — while the missing
        messages are restored from the account, then releases on its own. */}
    {(threadReadFailed || threadSync?.mode === "error" || runtimeNotice) && <div className="fb-chat-statusline" role="status">
      <RefreshCw size={15} aria-hidden="true" />
      <span>{runtimeNotice ?? "Showing your saved messages. New changes will load when you reconnect."}</span>
      <button type="button" onClick={() => {
        setThreadReadRetry(value => value + 1); void refreshMessaging(accountId).catch(() => undefined);
      }}>Try again</button>
    </div>}
    {/* The latest control gets its own row between the scroller and composer. */}
    <div className="fb-chat-viewport">
    <div className="fb-chat-messages" ref={scroll}>
      <p className="fb-chat-sync" role="status">{sendStatus ?? (chat.status === "offline" ? "Messages are saved here and will send when you reconnect." : "")}</p>
      {!loaded && <p role="status" className="fb-chat-secondary">Opening messages…</p>}
      {loaded && messages.length === 0 && <p className="fb-chat-empty">{view?.request === "INCOMING" ? "A new message request."
        : "Say hello and explain why you’d like to message."}</p>}
      {view?.mode === "REQUEST" && <div className="fb-chat-request">
        <p>{view.request === "INCOMING" ? "Reply to accept this request, or accept it below. Photos and read receipts stay off until then."
          : view.request === "OUTGOING" ? "Request sent. You can add another message while you wait."
            : "Send a text message to start a request."}</p>
        {view.request === "INCOMING" && <div className="fb-chat-actions">
          <button type="button" disabled={busy || !current || view.ownBlocked} onClick={() => void relationship("accept")}>Accept</button>
          <button type="button" disabled={busy || !current} onClick={() => void relationship("decline")}>Decline</button>
        </div>}
      </div>}
      <ol className="fb-chat-transcript" aria-label="Messages">
        {renderRuns.map((run) => {
          const first = run.messages[0]!;
          const grouped = run.kind === "group";
          const firstIndex = messageIndexes.get(first.id) ?? 0;
          // One day chip per calendar day keeps a long thread readable without
          // making every bubble carry a date. A run never spans a local day, so
          // its first message is the only member that can open one.
          const day = first.createdAt ? formatChatDay(first.createdAt) : "";
          const before = firstIndex > 0 ? messages[firstIndex - 1] : undefined;
          const opensDay = !!day && day !== (before?.createdAt ? formatChatDay(before.createdAt) : "");
          // A grouped album paints at most four members. The album's own label
          // and the durable run keep the true total; the extra members stay in
          // the transcript (and the viewer) and are counted on the last cell.
          const visibleMembers = grouped ? run.messages.slice(0, MEDIA_RUN_VISIBLE_LIMIT) : run.messages;
          const overflowCount = grouped ? run.messages.length - visibleMembers.length : 0;
          // A grouped album always paints its four visible cells, so it stays a
          // plain 2x2 grid and never opens with a wide cell. An album that
          // carries anything wider than a picture stacks in one column: a caption,
          // quote or report card needs it to stay readable and attached to its
          // own item. A bare grouped clip is the exception: it renders as a
          // compact album tile, so it neither needs nor forces the full width.
          const stacked = grouped && visibleMembers.some((message) => {
            const marker = parseChatFileMarker(message.body);
            if (marker?.kind === "video") {
              const bareVideo = !message.replyToId && !message.contextReportId
                && chatFileCaption(message.body).trim() === "";
              return !bareVideo;
            }
            const caption = marker ? chatFileCaption(message.body) : message.body;
            return caption.trim() !== "" || !!message.replyToId || !!message.contextReportId;
          });
          const wideFirst = grouped && !stacked && visibleMembers.length % 2 === 1;
          const ownRun = first.authorId === accountId;
          return <Fragment key={first.id}>
            {opensDay && <li className="fb-chat-day" role="presentation"><span>{day}</span></li>}
            {/* Four or more consecutive media inside one rolling window is one
                bounded album; a lone message, or a run of one to three, is the
                ordinary line. The album stays a
                native list item with a name, so its members are never wrapped
                in a second node. The row inside keeps the same element in both
                shapes, so gaining a fourth photo never remounts the first
                picture, its player or its scroll anchor. The swipe is a
                single-message gesture: inside an album the long-press and the
                corner menu carry the same actions. */}
            <motion.li aria-label={grouped ? mediaRunLabel(run.messages) : undefined}
              data-chat-run-members={grouped ? run.messages.map((message) => message.id).join(" ") : undefined}
              tabIndex={grouped ? -1 : undefined}
              drag={!grouped && canCompose && first.unsentAt === undefined ? "x" : false}
              dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18}
              onDragEnd={(_event, info: PanInfo) => {
                if (grouped || first.unsentAt !== undefined || !canCompose) return;
                if (replySwipeFor(info.offset.x, ownRun)) startReply(first);
              }}
              className={grouped ? `fb-chat-run${stacked ? " fb-chat-run-stack" : ""}${ownRun ? " fb-chat-run-own" : ""}`
                : ownRun ? "fb-chat-line fb-chat-line-own" : "fb-chat-line"}>
            {visibleMembers.map((message, member) => {
          const own = message.authorId === accountId;
          const attachment = media.find((entry) => entry.messageId === message.id);
          const statusMembers = [message];
          const statusMessage = statusMembers[statusMembers.length - 1]!;
          const timeMessage = grouped ? run.messages[run.messages.length - 1]! : message;
          const statusPending = outbox.find((entry) => entry.messageId === statusMessage.id);
          const localFailed = !storedMessages.some(entry => entry.id === message.id)
            && localEchoes.some(entry => entry.message.id === message.id && entry.failed);
          const statusAttachment = media.find((entry) => entry.messageId === statusMessage.id);
          const reviewMember = statusMembers.find((entry) => outbox.some((entryPending) => entryPending.messageId === entry.id && entryPending.status === "NEEDS_REVIEW"));
          const failedMember = statusMembers.find((entry) => {
            const entryAttachment = media.find((item) => item.messageId === entry.id);
            const entryPending = outbox.find((entryPending) => entryPending.messageId === entry.id);
            return entryAttachment?.state === "FAILED" || (!entry.server && entryPending?.status === "FAILED");
          });
          const removableMembers = statusMembers.filter((entry) => (entry.messageType === "MEDIA" || entry.messageType === "VOICE")
            && media.some((item) => item.messageId === entry.id) && !entry.server);
          // A caption, quote, report, location, failure or control keeps the
          // padded bubble readable; only a bare delivered photo owns the surface.
          const mediaOnly = isMediaOnlyMessage(message, attachment, {
            actionable: !!localFailed || !!reviewMember || !!failedMember || removableMembers.length > 0,
          });
          const quoted = message.replyToId ? messages.find((entry) => entry.id === message.replyToId) : undefined;
          const quotedAttachment = quoted?.messageType === "MEDIA" && quoted.unsentAt === undefined
            ? media.find((entry) => entry.messageId === quoted.id) : undefined;
          // A bare emoji is the message: no bubble fill, no quote, no media.
          const emojiOnly = message.unsentAt === undefined && message.messageType === "TEXT"
            && !attachment && !message.replyToId && !message.contextReportId && !message.location
            && isEmojiOnly(message.body);
          // A Klipy GIF or sticker is the message too: no bubble fill, no
          // padding, no frame around it (owner direction 2026-11-18).
          const klipyOnly = message.unsentAt === undefined && message.messageType === "TEXT"
            && !attachment && !message.replyToId && !message.contextReportId && !message.location
            && isBareKlipyMediaBody(message.body);
          // The kind is read from the same body that was just proven to be one
          // bare provider URL. Pre-marker history answers `unknown`, so the
          // surface never calls an old sticker a GIF.
          const klipyKind = message.unsentAt === undefined && isBareKlipyMediaBody(message.body)
            ? klipyMessageKind(message.body) : null;
          const file = message.unsentAt === undefined ? parseChatFileMarker(message.body) : null;
          // A bare grouped clip is a compact album tile: it has no caption,
          // quote or report context to keep readable, so it fills a square cell
          // instead of forcing the full-width stacked player.
          const bareVideo = grouped && file?.kind === "video" && !message.replyToId
            && !message.contextReportId && chatFileCaption(message.body).trim() === "";
          const lastVisible = member === visibleMembers.length - 1;
          // The message list proves the count even before media bytes arrive.
          // Keep the badge outside the photo so it survives every loading state.
          const rowOverflow = lastVisible && overflowCount > 0;
          // A bare document file is the message itself: only the untouched file
          // row earns the compact surface. A caption, quote, report context or
          // location is real bubble content, and every media kind keeps its own
          // renderer, so all of those retain the ordinary padded bubble.
          const documentOnly = file !== null && isDocumentChatFile(file) && !message.replyToId
            && !message.contextReportId && !message.location && chatFileCaption(message.body) === "";
          const flashClass = flash?.id === message.id ? ` fb-chat-flash-${flash.nonce % 2 ? "a" : "b"}` : "";
          return <div key={message.id} data-chat-message={message.id} tabIndex={-1}
            className={`fb-chat-line-row${wideFirst && member === 0 ? " fb-chat-line-row-wide" : ""}${rowOverflow ? " fb-chat-run-more" : ""}`}>
            {/* The same contextual layer the feed and the report card use: a
                400 ms hold (or right-click / Shift+F10) opens the app's own
                menu anchored to this bubble, never a bottom sheet. */}
            <LongPressArea label={own ? "Options for your message" : "Options for received message"}
              disabled={!message.server} className="fb-chat-message-surface"
              onOpen={() => { setSelectedMessageId(message.id); haptic("commit"); }}>
            {({ open, setOpen }) => <>
            <div data-receipt-message={message.messageType === "TEXT" && message.body && message.unsentAt === undefined ? message.id : undefined}
              className={`fb-chat-message${own ? " fb-chat-message-own" : ""}${message.messageType === "VOICE" && attachment && message.unsentAt === undefined ? " fb-chat-message-voice" : ""}${emojiOnly ? " fb-chat-message-emoji" : ""}${klipyOnly ? " fb-chat-message-klipy" : ""}${mediaOnly ? " fb-chat-message-media" : ""}${bareVideo ? " fb-chat-message-video" : ""}${documentOnly ? " fb-chat-message-document" : ""}${flashClass}`}>
            <span className="sr-only">{own ? "You: " : `${name || "Member"}: `}</span>
            {message.unsentAt === undefined && message.replyToId && <button type="button" className="fb-chat-quote"
              onClick={() => { transcript.suspend(); setJumpTo(message.replyToId!); }}
              aria-label={`Quoted message from ${quoted ? (quoted.authorId === accountId ? "you" : name || "this member") : "an unavailable message"}: ${quoted ? replyPreview(quoted) : "unavailable"}. Show original`}>
              {photoAllowed && quotedAttachment && quotedAttachment.state !== "EVICTED"
                && <ChatQuotePhoto accountId={accountId} attachment={quotedAttachment} />}
              <span className="fb-chat-quote-copy">
                <span className="fb-chat-quote-author">{quoted ? (quoted.authorId === accountId ? "You" : name || "Member") : "Quoted message"}</span>
                <span className="fb-chat-quote-preview" dir="auto">{quoted ? replyPreview(quoted) : "Message unavailable"}</span>
              </span>
            </button>}
            {message.unsentAt !== undefined ? <p>Message unsent</p> : <>
            {message.messageType === "MEDIA" && !attachment && <div className="fb-chat-photo"
              style={{ aspectRatio: String(4 / 3), "--fb-chat-photo-ratio": 4 / 3 } as CSSProperties}>
              <div role="status">{missingAttachmentCopy(message)}
                {missingAttachmentStale(message) && <button type="button" onClick={() => {
                  void retryMessagingMedia(accountId).catch(() => setError("Could not check for this attachment. Try syncing again."));
                }}>Check again</button>}
              </div>
            </div>}
            {message.messageType === "MEDIA" && attachment && photoAllowed && <ChatPhoto key={attachment.id} accountId={accountId} conversationId={conversationId} attachment={attachment} onOpen={openPhoto} onReady={rememberPhoto} overflowCount={rowOverflow ? overflowCount : undefined} />}
            {message.messageType === "MEDIA" && attachment && !photoAllowed && <p>Photos are available when you're friends.</p>}
            {message.messageType === "VOICE" && attachment && photoAllowed && <ChatVoice key={attachment.id} accountId={accountId} conversationId={conversationId} attachment={attachment} playback={voice.player} snapshot={playbackSnapshot}
              authorName={own ? user?.displayName || user?.username : name} avatarUrl={own ? user?.avatarUrl : person?.avatarUrl} />}
            {message.messageType === "VOICE" && attachment && !photoAllowed && <p>Voice messages are available when you're friends.</p>}
            {message.contextReportId && <ChatReportContext reportId={message.contextReportId} safetyKey={view?.ownBlocked ? "blocked" : "clear"} />}
            {message.location && <ChatLocation location={message.location} />}
            {file ? <>
              <ChatFile meta={file} tile={bareVideo} />
              {chatFileCaption(message.body) !== "" && <ChatMessageText body={chatFileCaption(message.body)}
                contextReportId={message.contextReportId} renderReportPreview={reportPreview} />}
            </> : message.body && message.unsentAt === undefined && isBareKlipyMediaBody(message.body)
              ? <img className="fb-chat-klipy" src={klipyMessageUrl(message.body)}
                  data-media-kind={klipyKind ?? "unknown"}
                  alt={klipyKind === "gif" ? "GIF" : klipyKind === "sticker" ? "Sticker" : "Sticker or GIF"}
                  loading="lazy" referrerPolicy="no-referrer" />
              : message.body ? (isChatFileMarkerBody(message.body)
                  ? <p dir="auto" className={emojiOnly ? "fb-chat-emoji-only" : undefined}>{message.body}</p>
                  : <ChatMessageText body={message.body}
                      className={emojiOnly ? "fb-chat-emoji-only" : undefined}
                      contextReportId={message.contextReportId} renderReportPreview={reportPreview} />)
              : message.messageType === "LOCATION" ? (!message.location && <p>Location unavailable</p>)
              : !attachment && message.messageType !== "MEDIA" && <p>{missingAttachmentCopy(message)}</p>}
            {!attachment && !message.body && message.messageType !== "MEDIA" && missingAttachmentStale(message) && <button type="button" onClick={() => {
              // A message whose attachment never arrived is not stuck loading:
              // ask for one full pass before telling the reader it is gone.
              void retryMessagingMedia(accountId).catch(() => setError("Could not check for this attachment. Try syncing again."));
            }}>Check again</button>}
            <span className="fb-chat-message-status">
              {(!grouped || lastVisible) && timeMessage.createdAt ? <time className="fb-chat-time" dateTime={new Date(timeMessage.createdAt).toISOString()}>
                {new Date(timeMessage.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time> : null}
              {klipyKind && <span className="fb-chat-expressive-kind">{klipyPreviewLabel(klipyKind)}</span>}
              {own && <>{localFailed ? "Not sent"
                : reviewMember ? "Needs review"
                : failedMember ? (failedMember.messageType === "VOICE" ? "Voice saved" : failedMember.messageType === "MEDIA" ? "Photo saved" : "Message saved")
                : statusMessage.messageType === "MEDIA" && !statusAttachment ? "Photo pending"
                : statusMessage.messageType === "VOICE" && !statusAttachment ? "Voice pending"
                : statusAttachment && !["READY", "EVICTED"].includes(statusAttachment.state)
                  ? (statusAttachment.state === "FAILED" ? (statusMessage.messageType === "VOICE" ? "Voice saved" : "Photo saved") : "Sending…")
                : statusMessage.server ? <ReceiptTicks read={!!(statusMessage.readByPeer || readIds.has(statusMessage.id))} />
                : statusPending?.status === "FAILED" ? "Message saved" : "Sending…"}
              {localFailed && <button type="button" onClick={() => {
                void admitText(message).then(() => {
                  if (!alive.current) return;
                  const revision = [...textAttempts.current].find(([, id]) => id === message.id)?.[0];
                  if (revision !== undefined) {
                    textAttempts.current.delete(revision);
                    if (draftRevision.current === revision) clearDraft();
                  }
                  if (message.contextReportId) clearReportContext(message.contextReportId);
                  setReplyTo(previous => previous?.id === message.replyToId ? null : previous);
                  setError(null);
                }).catch(() => setError("Could not retry. Try again."));
              }}>Retry</button>}
              {failedMember && <button type="button" onClick={() => {
              // A refused send keeps its original boundary; re-flushing it can only
              // fail again. The message-level retry rebinds that boundary because a
              // human asked for it, then flushes. A failed upload on an already
              // accepted message has no boundary to move.
              const failedPending = outbox.find((entry) => entry.messageId === failedMember.id);
              const retry = !failedMember.server && failedPending?.status === "FAILED"
                ? retryMessagingMessage(accountId, conversationId, failedMember.id)
                : refreshMessaging(accountId);
              void retry.catch(() => setError("Could not retry. Try syncing again."));
            }}>Retry</button>}</>}
            </span>
            {own && reviewMember && <button type="button" disabled={busy} onClick={() => { setSelectedMessageId(reviewMember.id); setSheet("review"); }}>Review message</button>}
            {own && removableMembers.length > 0 && <button type="button" aria-label={message.messageType === "VOICE" ? "Remove pending voice message" : "Remove pending photo"} onClick={() => {
              void (async () => {
                try { for (const entry of removableMembers) await removeMessagingMessage(accountId, conversationId, entry.id, false); }
                catch {
                  setError("Could not confirm this change. Sync and check your chat.");
                  void refreshMessaging(accountId).catch(() => undefined);
                }
              })();
            }}>Remove</button>}
            </>}
            {message.server && <button type="button" className="fb-chat-message-options"
              aria-label={own ? "Options for your message" : "Options for received message"}
              aria-haspopup="menu" aria-expanded={open}
              onClick={() => { setOpen(true); setSelectedMessageId(message.id); haptic("commit"); }}>
              <ChevronDown size={16} aria-hidden="true" />
            </button>}
            </div>
            {message.server && <>
              {/* One menu, anchored with an invisible anchor over the whole
                  long-press surface; the visible chevron lives in the bubble's
                  own corner and opens this same controlled menu. */}
              <ActionMenu anchor label="Message actions"
                placement={own ? "bottom end" : "bottom start"}
                open={open}
                onOpenChange={(next) => {
                  setOpen(next);
                  // Opening the actions is a deliberate press on a message: the
                  // same confirmation the media and reaction gestures give, and
                  // the target for whatever the chosen action destroys.
                  if (next) { setSelectedMessageId(message.id); haptic("commit"); }
                }}
                items={messageActions(message, own)} />
            </>}
            </>}
            </LongPressArea>
            {rowOverflow && <span className="fb-chat-run-more-badge" aria-hidden="true">+{overflowCount}</span>}
          </div>;
            })}
            </motion.li>
          </Fragment>;
        })}
      </ol>
      {view?.ownBlocked && <p className="fb-chat-secondary">You’ve blocked this account. Manage blocked accounts in Privacy settings.</p>}
    </div>
    {showJump && <div className="fb-chat-jump-row"><button type="button" className="fb-chat-jump" aria-label="Jump to latest message" onClick={() => {
      const area = scroll.current;
      if (area) area.scrollTo({ top: area.scrollHeight, behavior: shouldReduceMotion() ? "auto" : "smooth" });
      transcript.followLatest();
      setShowJump(false);
    }} {...hoverLabel("Jump to latest")}><ChevronDown size={20} aria-hidden="true" /></button></div>}
    </div>
    {error && !sheet && <p className="fb-chat-error" role="alert">{error}</p>}
    {photos.length > 0 && <div className="fb-chat-photo-draft" role="group"
      aria-label={`${photos.length} ${stagedAttachments ? "attachment" : "photo"}${photos.length === 1 ? "" : "s"} to send`}>
      <ul className="fb-chat-photo-strip">
        {photos.map((item, index) => {
          const reviewIndex = reviewablePhotos.findIndex((entry) => entry.key === item.key);
          return <li key={item.key} className="fb-chat-photo-slot">
          {item.kind === "video"
            ? <span className="fb-chat-photo-open fb-chat-photo-video">
                <Film size={20} aria-hidden="true" />
                <span className="fb-chat-photo-video-name">{item.name || "Video"}</span>
              </span>
            : item.url && (item.prepared || item.file)
            ? (photoAllowed
                ? <button type="button" className="fb-chat-photo-open" aria-label={`Review photo ${reviewIndex + 1} of ${reviewablePhotos.length}`}
                    onClick={() => { setViewer(null); setDraftViewer({ key: item.key }); }}>
                    <img src={item.url} alt="" />
                  </button>
                : <span className="fb-chat-photo-open"><img src={item.url} alt="" /></span>)
            : <span className="fb-chat-photo-open fb-chat-photo-pending" role="status">
                {item.error ? <ImageOff size={20} aria-hidden="true" /> : <span className="fb-chat-photo-spinner" aria-hidden="true" />}
                <span className="sr-only">{item.error ? "Could not prepare photo" : "Preparing photo"}</span>
              </span>}
          <button type="button" className="fb-chat-photo-remove" aria-label={`Remove ${stagedAttachments ? "attachment" : "photo"} ${index + 1}`}
            disabled={photoSending || admissionFailed} onClick={() => removeStaged(item.key)}
            {...hoverLabel(stagedAttachments ? "Remove attachment" : "Remove photo")}><X size={14} aria-hidden="true" /></button>
        </li>;
        })}
      </ul>
      <div className="fb-chat-photo-options">
        <p role="status" className="fb-chat-secondary">
          {!photoAllowed ? `${stagedAttachments ? "Attachments" : "Photos"} are available when you're friends.`
            : photoSending ? `Sending ${stagedAttachments ? "attachments" : "photos"}…`
            : photos.some(item => item.preparing) ? "Preparing attachments…"
            : photos.some(item => item.error) ? "Some attachments could not be prepared. Retry or remove them."
            : `${photos.length} ${stagedAttachments ? "attachment" : "photo"}${photos.length === 1 ? "" : "s"} ready. ${reviewablePhotos.length === 0 ? "Tap Send to share."
              : stagedVideos ? "Tap a photo to review." : "Tap one to review."}`}
        </p>
        {photoAllowed && photos.some(item => item.error) && <button type="button" disabled={photoSending}
          onClick={() => { for (const item of photos) if (item.error) void retryStaged(item); }}>Retry</button>}
        <button type="button" disabled={photoSending}
          onClick={() => { for (const item of photos) removeStaged(item.key); }}>Remove all</button>
      </div>
    </div>}
    <VoiceDraft recorder={voice.recorder} status={voiceStatus} recording={voiceRecording} notice={voiceNotice}
      url={voiceUrl} snapshot={playbackSnapshot} sending={voiceSending} allowed={voiceAllowed}
      onStop={toggleVoiceCapture} onResume={resumeVoice} onDiscard={discardVoice} onSend={() => void sendVoice()}
      onPreview={() => void previewVoice()} />
    {canCompose && (voiceStatus === "idle" || voiceStatus === "error") && <>
        {view?.mode === "CONNECTED" && <>
          <input ref={photoInput} type="file" accept="image/*,video/*" multiple aria-label="Photo file input" hidden onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
            if (files.length > 0 && Capacitor.getPlatform() !== "android") void stageLocalFiles(files);
          }} />
        </>}
      <PeerChatComposer value={draft} onChange={value => { draftRevision.current++; setDraft(value); writeConversationDraft(accountId, conversationId, value); }} onSend={() => void send()} inputRef={composer}
        busy={false} locked={!runtimeOpen || requestAccepting || photoSending || voiceSending} attachmentsLocked={photoSending || admissionFailed}
        canSend={runtimeOpen && !requestAccepting && (photos.length > 0 ? photoAllowed && photos.every(item => !!item.prepared || !!item.file) : !!draft.trim())}
        photoAllowed={view?.mode === "CONNECTED"}
        onCamera={() => void choosePhoto("camera")} onPhotos={() => void choosePhoto("photos")}
        onFiles={(files, kind) => void (kind === "video" ? stageLocalFiles(files) : sendFiles(files))} fileSending={filesSending}
        onLocation={locationAllowed ? () => setSheet("location") : undefined}
        voiceAvailable={voiceAllowed} onVoice={toggleVoiceCapture}
        onPickKlipy={sendKlipy} userId={accountId}
        onPasteImages={view?.mode === "CONNECTED" ? (files) => void stagePastedImages(files) : undefined}
        onFocusChange={setComposerFocused}
        onKeyboardIntentChange={setComposerIntent}
        context={<>
          {replyTo && <div className="fb-chat-reply-chip" role="status" data-chat-reply-to={replyTo.id}>
            <span className="fb-chat-reply-copy">
              <span className="fb-chat-reply-author">{replyTo.label}</span>
              <span className="fb-chat-reply-preview" dir="auto">{replyTo.preview}</span>
            </span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)} {...hoverLabel("Cancel reply")}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>}
          {reportContext && <p className="fb-chat-context-banner" role="status">
            Your next text message will show which report you’re asking about.
            <button type="button" onClick={() => clearReportContext(reportContext)}>Don’t attach</button>
          </p>}
        </>} />
    </>}
    {sheet === "location" && locationAllowed && <ChatLocationComposer key={locationAuthority.current}
      onClose={() => setSheet(null)} onSend={shareLocation} />}
    <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)}
      onCapture={(file) => void stageLocalFiles([file])}
      onChoosePhoto={() => photoInput.current?.click()} />
    <MediaViewer items={viewerItems} index={activeViewer ? viewerItems.findIndex((item) => item.id === activeViewer.id) : null}
      onIndexChange={(index) => { if (viewer && viewerItems[index]) setViewer({ ...viewer, id: viewerItems[index].id }); }} onClose={closePhoto} />
    <MediaViewer items={draftViewerItems} index={draftViewerIndex < 0 ? null : draftViewerIndex}
      onIndexChange={(index) => { const item = draftViewerItems[index]; if (item) setDraftViewer({ key: item.id }); }}
      onClose={() => setDraftViewer(null)} />
    <ConfirmDialog open={confirming} onClose={() => setSheet(null)} title={confirmationTitle} busy={busy}
      confirmLabel={sheet === "end" ? "Remove friend" : sheet === "unsend" ? "Unsend" : sheet === "clear" ? "Clear for me" : "Delete for me"}
      cancelLabel="Cancel"
      confirmDisabled={!current || (sheet === "end" ? current.mode !== "CONNECTED" : sheet === "clear" ? highest === 0 || outbox.length > 0
        : !selectedMessage?.server || (sheet === "unsend" && (selectedMessage.authorId !== accountId || selectedMessage.unsentAt !== undefined)))}
      onConfirm={() => { if (sheet === "end") void relationship("end"); else if (sheet === "delete" || sheet === "unsend" || sheet === "clear") void erase(sheet); }}>
      <p>{sheet === "end" ? "Your messages stay here. Either of you can send a new request."
        : sheet === "unsend" ? "Replace this message with ‘Message unsent’ for everyone. Each device that received it keeps a hidden copy for up to 24 hours so it can still be reported, then deletes it."
          : sheet === "clear" ? "This clears your copy on your devices, not theirs." : "Remove this message from your devices, not the other person’s chat."}</p>
      {error && <p className="fb-chat-error" role="alert">{error}</p>}
    </ConfirmDialog>
    <ConfirmDialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave this chat?"
      confirmLabel="Leave chat" cancelLabel="Stay" onConfirm={() => leaveThread.current(leaveIntent)}>
      {unsentCopy && <p>{unsentCopy}</p>}
    </ConfirmDialog>
    <AdaptiveTaskSurface open={sheet !== null && sheet !== "location" && !confirming} onClose={() => setSheet(null)} busy={busy}
      width={sheet === "actions" || sheet === "search" ? "compact" : "standard"}
      bodyClassName={sheet === "actions" ? "fb-chat-info-scroll" : undefined}
      title={sheet === "search" ? "Search chat" : sheet === "media" ? "Conversation media" : sheet === "review" ? "Review message" : "Conversation info"}>
      {sheet === "actions" ? conversationInfo : sheet === "search" ? <div className="fb-chat-search-task">
        <label className="fb-chat-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search saved messages" placeholder="Search messages" value={messageQuery} onChange={event => setMessageQuery(event.target.value)} /></label>
        <p role="status" className="fb-chat-secondary">{!searchTerm ? "Search the messages saved on this device." : `${searchMatches.length} ${searchMatches.length === 1 ? "message" : "messages"} found${searchMatches.length > 100 ? ". Showing the first 100." : ""}`}</p>
        <ul className="fb-chat-search-results">{searchMatches.slice(0, 100).map(message => <li key={message.id}>
          <button type="button" onClick={() => { transcript.suspend(); setJumpTo(message.id); setSheet(null); }}><span className="fb-chat-secondary">{message.authorId === accountId ? "You" : name || "Member"}</span><span dir="auto">{messagePreview(message)}</span></button>
        </li>)}</ul>
      </div> : sheet === "media" ? !photoAllowed ? <p>Photos are available when you're friends.</p> : gallery.length === 0 ? <p>No photos in this conversation yet.</p> : <ul className="fb-chat-gallery" aria-label="Conversation photos">
        {gallery.map(attachment => <li key={attachment.id}><ChatPhoto accountId={accountId} conversationId={conversationId} attachment={attachment} onOpen={openPhoto} onReady={ignorePhotoReadiness} /></li>)}
      </ul> : sheet === "review" ? <div className="fb-chat-sheet">
        <p>We couldn’t confirm this older message. Send the text shown here only, or remove your copy. This won’t recall anything already delivered.</p>
        <p className="fb-chat-review-copy" dir="auto">{selectedMessage?.body || "No saved text. To send a photo, attach it again as a new message."}</p>
        <div className="fb-chat-actions">
          <button type="button" disabled={busy || !selectedNeedsReview || !selectedMessage?.body.trim() || !canCompose} onClick={() => void reviewMessage("send")}>Send text only</button>
          <button type="button" disabled={busy || !selectedNeedsReview} onClick={() => void reviewMessage("delete")}>Delete for me</button>
        </div>
      </div> : null}
      {error && <p className="fb-chat-error" role="alert">{error}</p>}
    </AdaptiveTaskSurface>
    <ReportSheet open={reportTarget !== null} target={reportTarget === "account" && row
      ? { targetType: "USER", targetId: row.peerId, conversationId, evidence: personEvidence }
      : reportTarget === "message" && selectedMessage
        ? selectedMessage.unsentAt === undefined
          ? { targetType: "MESSAGE", targetId: selectedMessage.id, accountId, body: selectedMessage.body }
          : reportHold && reportHold.messageId === selectedMessage.id
            ? { targetType: "MESSAGE", targetId: selectedMessage.id, accountId, body: reportHold.body }
            : null
        : null}
      onReported={() => {
        if (selectedMessage?.unsentAt === undefined || reportHold?.messageId !== selectedMessage.id) return;
        const messageId = reportHold.messageId;
        setHeldMessageIds((previous) => {
          const next = new Set(previous); next.delete(messageId); return next;
        });
        void purgeMessagingUnsentHold(accountId, messageId).catch(() => undefined);
      }}
      onClose={() => { setReportTarget(null); setReportHold(null); }} />
  </section>}
  </ChatDetailsLayout>;
}
