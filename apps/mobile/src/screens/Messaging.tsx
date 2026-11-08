import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { motion, type PanInfo } from "framer-motion";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { Archive, ArrowLeft, BellOff, ChevronDown, Ellipsis, Flag, ImageOff, Images, ListFilter, LogOut, MapPin, PanelLeftClose, PanelLeftOpen, Pin, RefreshCw, Search, Settings2, ShieldBan, Trash2, UserRound, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { PostItem } from "@norfold/shared";
import { copyStaticLocation, isUuid } from "../services/messaging/validation";
import { subscribeSafetyChanged } from "../services/safetySignals";
import { onRealtime } from "../services/realtime";
import { useAuth } from "../auth";
import { UserAvatar } from "../components/UserAvatar";
import { ChatIdentity } from "../components/ChatIdentity";
import { StatusChip } from "../components/StatusChip";
import { formatChatDay, formatEventDate, timeAgo } from "../utils/dates";
import { haptic } from "../utils/haptics";
import { convertEmoticons, isEmojiOnly } from "../utils/emoji";
import { SplitView, type SplitPaneState } from "../components/SplitView";
import { CHAT_PANE } from "../components/panePreference";
import { ChatDetailsLayout } from "../components/ChatDetailsLayout";
import { BlockControl } from "../components/BlockControl";
import { PreferenceSwitchRow } from "../components/settings";
import { ActionMenu, type MenuAction } from "../components/ActionMenu";
import { LongPressArea } from "../components/LongPressArea";
import { AppBar } from "../components/AppBar";
import { PeopleSearch } from "../components/PeopleSearch";
import { PeerChatComposer } from "../components/PeerChatComposer";
import { ChatLocationComposer } from "../components/ChatLocationComposer";
import { AdaptiveTaskSurface, ConfirmDialog } from "../components/AdaptiveTaskSurface";
import { ReportSheet } from "../components/ReportSheet";
import { MediaViewer, type MediaViewerItem } from "../components/MediaViewer";
import { normalizePeaks, resamplePeaks, VOICE_BARS, cachedVoicePeaks, rememberVoicePeaks, queueVoicePeaks } from "../services/messaging/voicePeaks";
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
import { prepareMessagingPhoto, type PreparedMessagingPhoto } from "../services/messaging/preparePhoto";
import { sha256Hex, VOICE_SENTINEL_EDGE, type MediaMetadata, type MediaMime } from "../services/messaging/media";
import {
  browserVoiceDeps, createVoiceRecorder, voiceRecordingSupported,
  type VoiceRecorderPort, type VoiceRecorderState, type VoiceRecording,
} from "../services/messaging/voiceRecorder";
import {
  browserVoicePlaybackPorts, createVoicePlayback, voiceProgressPercent,
  type VoicePlaybackPort, type VoicePlaybackSnapshot,
} from "../services/messaging/voicePlayback";
import { storedVoiceMime } from "../services/messaging/voice";
import { PhotoUnavailableError } from "../services/messaging/mediaTransport";
import { chooseNativeImage, chooseNativeImages, importNativeImageUri, importedImageToFile } from "../services/media/nativeMedia";
import "./Messaging.css";

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
 * "Report unavailable" instead of showing a stale private snapshot. */
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
  if (preview && state.status !== "ready") return <span className="fb-chat-row-context">{state.status === "loading" ? "Loading report…" : "Report unavailable"}</span>;
  if (state.status === "loading") return <p className="fb-chat-context fb-chat-secondary">Loading report…</p>;
  if (state.status === "unavailable") return <p className="fb-chat-context fb-chat-secondary" data-chat-report="unavailable">
    Report unavailable</p>;
  const post = state.post!;
  if (preview) return <span className="fb-chat-row-context" dir="auto">{post.type === "LOST" ? "Lost" : "Found"} report · {post.title}</span>;
  return <Link className="fb-chat-context fb-chat-report-card" to={`/posts/${encodeURIComponent(reportId)}`} data-chat-report={reportId}>
    {firstImageSrc && <img src={firstImageSrc} alt={post.title} loading="lazy" />}
    <span className="fb-chat-report-copy">
      <span className="fb-chat-secondary">{post.type === "LOST" ? "Lost" : "Found"} report</span>
      <strong dir="auto">{post.title}</strong>
      {post.locationLabel && <span className="fb-chat-secondary" dir="auto">{post.locationLabel}</span>}
      <span className="fb-chat-report-meta"><StatusChip post={post} />
        {post.eventDate && <time dateTime={post.eventDate}>{formatEventDate(post.eventDate)}</time>}
      </span>
    </span>
  </Link>;
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

/** What a quoted message is called when the quoted row itself has no text. */
export function replyPreview(message: StoredHumanMessage): string {
  if (message.unsentAt !== undefined) return "Message unsent";
  if (message.messageType === "MEDIA") return "Photo";
  if (message.messageType === "VOICE") return "Voice message";
  if (message.messageType === "LOCATION") return "Location";
  return message.body;
}

/**
 * Photos from one send are one bubble, not one bubble per file. The rule is
 * presentation-only — no schema column and no wire key — so both sides group
 * the same run: consecutive photos by the same author with no other message
 * between them, each written within a few seconds of the previous one. Unknown
 * (zero) timestamps never prove a batch, because a legacy file with no clock
 * would otherwise merge unrelated photos.
 */
const PHOTO_BATCH_GAP_MS = 4000;

export interface PhotoBatches {
  /** Leader id -> every message in the run, leader first. */
  batches: Map<string, StoredHumanMessage[]>;
  /** Members rendered by their leader; the transcript skips them. */
  followers: Set<string>;
  /** Follower id -> its visible leader, so a reply or pin still lands on screen. */
  leaderOf: Map<string, string>;
}

export function photoBatches(messages: StoredHumanMessage[]): PhotoBatches {
  const batches = new Map<string, StoredHumanMessage[]>();
  const followers = new Set<string>();
  const leaderOf = new Map<string, string>();
  for (let index = 0; index < messages.length; index += 1) {
    const first = messages[index]!;
    if (first.messageType !== "MEDIA" || first.unsentAt !== undefined) continue;
    const items = [first];
    while (index + items.length < messages.length) {
      const next = messages[index + items.length]!;
      const previous = items[items.length - 1]!;
      if (next.messageType !== "MEDIA" || next.unsentAt !== undefined || next.authorId !== first.authorId) break;
      // Only a bare photo joins the run. A caption, a quote, a report card or a
      // location belongs to its own bubble; merging it would hide what the
      // writer actually sent from the transcript, search and pins.
      if (next.body || next.replyToId || next.contextReportId || next.location) break;
      const from = previous.createdAt ?? 0, to = next.createdAt ?? 0;
      if (!(from > 0 && to >= from && to - from <= PHOTO_BATCH_GAP_MS)) break;
      items.push(next);
    }
    if (items.length < 2) continue;
    batches.set(first.id, items);
    for (const item of items.slice(1)) { followers.add(item.id); leaderOf.set(item.id, first.id); }
    index += items.length - 1;
  }
  return { batches, followers, leaderOf };
}

function RetrySync({ accountId, labelled = false }: { accountId: string; labelled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <>
    <button className={labelled ? "fb-chat-info-row" : "fb-chat-icon"} type="button" aria-label={labelled ? undefined : "Sync messages"} disabled={busy}
      onClick={() => {
        setBusy(true); setError(false);
        void refreshMessaging(accountId).catch(() => setError(true)).finally(() => setBusy(false));
      }}><RefreshCw size={19} aria-hidden="true" className={busy ? "fb-chat-refreshing" : ""} />{labelled && <span>Sync messages</span>}</button>
    {error && <span role="status" className="fb-chat-secondary">Could not sync.</span>}
  </>;
}

function ChatPhoto({ accountId, conversationId, attachment, onOpen, onReady, grouped = false, label = "View photo" }: {
  accountId: string; conversationId: string; attachment: MediaAttachment;
  onOpen: (id: string, bytes: ArrayBuffer, mime: string) => void;
  onReady: (id: string, content: { bytes: ArrayBuffer; mime: string } | null) => void;
  /** A grid cell defines the box; the photo fills it instead of setting its own ratio. */
  grouped?: boolean;
  label?: string;
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
  return <div ref={host} className={`fb-chat-photo${grouped ? " fb-chat-photo-grouped" : ""}`} data-loading={content && !loaded ? "true" : undefined}
    style={grouped ? undefined : { aspectRatio: `${attachment.width} / ${attachment.height}` }}>
    {content ? <button type="button" aria-label={label} onClick={() => onOpen(attachment.messageId, content.bytes, attachment.mime)}>
      <img src={content.url} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => { onReady(attachment.id, null); setContent(null); setState("failed"); }}
        data-receipt-message={loaded && attachment.state === "READY" ? attachment.messageId : undefined} />
    </button> : <div role="status">{state === "loading" ? "Photo loading…" : state === "failed" ? "Could not load photo." : "Photo unavailable"}
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
 * Photos from one send share a bubble. Two sit side by side, three put the
 * first beside a stacked pair, and four or more use a 2x2 with the remainder
 * counted on the last cell. Each cell is the canonical ChatPhoto, so loading,
 * retry, download and the shared viewer keep one implementation; the tapped
 * cell names its whole run, so the viewer counter matches the grid even when
 * the last cell hides most of the photos.
 */
function ChatPhotoGroup({ accountId, conversationId, items, media, onOpen, onReady }: {
  accountId: string; conversationId: string; items: StoredHumanMessage[];
  media: MediaAttachment[];
  onOpen: (id: string, bytes: ArrayBuffer, mime: string, group: string[]) => void;
  onReady: (id: string, content: { bytes: ArrayBuffer; mime: string } | null) => void;
}) {
  const visible = items.slice(0, 4);
  const hidden = items.length - visible.length;
  return <div className={`fb-chat-photo-grid fb-chat-photo-grid-${Math.min(items.length, 4)}`}
    role="group" aria-label={`${items.length} photos`}>
    {visible.map((message, index) => {
      const attachment = media.find((entry) => entry.messageId === message.id);
      return <div key={message.id} className="fb-chat-photo-cell">
        {attachment
          ? <ChatPhoto accountId={accountId} conversationId={conversationId} attachment={attachment}
              onOpen={(id, bytes, mime) => onOpen(id, bytes, mime, items.map((entry) => entry.id))}
              onReady={onReady} grouped label={`View photo ${index + 1} of ${items.length}`} />
          : <span className="fb-chat-photo-missing" role="status">{missingAttachmentCopy(message)}</span>}
        {hidden > 0 && index === visible.length - 1 && <span className="fb-chat-photo-more" aria-hidden="true">{`+${hidden}`}</span>}
      </div>;
    })}
  </div>;
}

/**
 * One voice note in the transcript. Bytes come from the same verified store as
 * a photo; playback is delegated to the single transcript player so starting a
 * second note pauses the first. A length shown here is the stored duration, not
 * a container guess (WebM often reports `Infinity`).
 */
/**
 * One voice note in the transcript. Bytes come from the same verified store as
 * a photo; playback is delegated to the single transcript player so starting a
 * second note pauses the first. The bars are measured from that audio, never
 * invented: see `voicePeaks.ts` for how a container becomes an envelope.
 */
/**
 * The last `VOICE_BARS` measurements of a note in progress.
 *
 * A recording fills from the left and then scrolls, the way a live level meter
 * reads. Padding the *end* with silence is what produces that: padding the
 * start would make the first seconds appear at the right edge.
 */
function livePeaks(values: readonly number[]): number[] {
  const normalized = normalizePeaks(values);
  const window = normalized.slice(-VOICE_BARS);
  return window.length < VOICE_BARS ? [...window, ...new Array(VOICE_BARS - window.length).fill(0)] : window;
}

function ChatVoice({ accountId, conversationId, attachment, playback, snapshot, authorName, avatarUrl }: {
  accountId: string; conversationId: string; attachment: MediaAttachment;
  playback: VoicePlaybackPort; snapshot: VoicePlaybackSnapshot;
  authorName?: string | null; avatarUrl?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed" | "unavailable">("loading");
  const [version, setVersion] = useState(0);
  const [rate, setRate] = useState(1);
  const [peaks, setPeaks] = useState<number[]>(() => cachedVoicePeaks(attachment.id)?.bars ?? []);
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
      // clock shows, so no decode is required to call it ready. The envelope is
      // measured separately, once per note, through the shared decode queue.
      setState("ready");
      const known = cachedVoicePeaks(attachment.id);
      if (known) setPeaks(known.bars);
      else void queueVoicePeaks(bytes).then((measured) => {
        if (cancelled || !measured) return;
        rememberVoicePeaks(attachment.id, { bars: measured, measured: true });
        setPeaks(measured);
      });
    }).catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [accountId, attachment.id, attachment.mime, attachment.state, attachment.expiresAt, version]);
  async function download() {
    setState("loading");
    try { await downloadMessagingMedia(accountId, conversationId, attachment.id); setVersion((value) => value + 1); }
    catch (error) { setState(error instanceof PhotoUnavailableError ? "unavailable" : "failed"); }
  }
  const playing = snapshot.playingId === attachment.id;
  const position = playing ? Math.min(snapshot.positionMs, durationMs) : 0;
  async function toggle() {
    if (!url) return;
    if (playing) { playback.pause(); return; }
    if (!playback.load(attachment.id, url, durationMs)) return;
    playback.setRate(rate);
    await playback.play();
  }
  return <div data-receipt-message={state === "ready" && attachment.state === "READY" ? attachment.messageId : undefined}>
    <VoiceMessagePlayer peaks={peaks} playing={playing} ready={!!url} durationMs={durationMs} positionMs={position}
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
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [decoded, setDecoded] = useState<number[]>([]);
  useEffect(() => {
    if (status !== "recording") { setElapsed(0); setLive([]); return; }
    if (recorder.state.status === "recording") {
      setElapsed(recorder.state.elapsedMs); setLive(recorder.state.peaks);
    }
    return recorder.subscribe((next) => {
      if (next.status === "recording") { setElapsed(next.elapsedMs); setLive(next.peaks); }
    });
  }, [recorder, status]);
  // A note recorded where the live meter is unavailable still gets a real
  // envelope: the finished container is decoded instead.
  useEffect(() => {
    setDecoded([]);
    if (status !== "review" || !recording || recording.peaks.length > 0) return;
    let cancelled = false;
    void recording.blob.arrayBuffer()
      .then((bytes) => queueVoicePeaks(bytes))
      .then((measured) => { if (!cancelled && measured) setDecoded(measured); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [status, recording]);
  const reviewPeaks = recording
    ? (recording.peaks.length > 0 ? resamplePeaks(recording.peaks) : decoded)
    : [];
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
    const position = playing ? Math.min(snapshot.positionMs, recording.durationMs) : 0;
    return <VoiceRecordingPanel phase="review" peaks={reviewPeaks} playing={playing}
      elapsedMs={playing ? position : recording.durationMs} percent={voiceProgressPercent(position, recording.durationMs)}
      previewReady={!!url} canResume={recorder.canResume} sending={sending} allowed={allowed}
      onPreview={onPreview} onPause={onStop} onResume={onResume} onDiscard={onDiscard} onSend={onSend} />;
  }
  return <VoiceRecordingPanel phase={status === "pausing" ? "pausing" : "recording"}
    peaks={livePeaks(live)} elapsedMs={elapsed} percent={0} playing={false}
    onPreview={onPreview} onPause={onStop} onResume={onResume} onDiscard={onDiscard} onSend={onSend} />;
}

export function Connections() {
  const { user } = useAuth();
  const { conversationId } = useParams();
  return user ? <SplitView selected={!!conversationId}
    pane={{ ...CHAT_PANE, label: "Resize conversation list" }}
    list={(pane) => <ConnectionsSession key={user.id} accountId={user.id} selectedId={conversationId} pane={pane} />}
    detail={conversationId ? <Outlet /> : <div className="fb-chat-empty"><h2>Choose a conversation</h2><p>Open a chat, or search for someone to connect with.</p></div>} /> : null;
}

/** Replace, rather than stack a duplicate legacy screen in navigation history. */
export function LegacyChatsRedirect() {
  const { conversationId } = useParams();
  const location = useLocation();
  return <Navigate replace to={{ pathname: conversationId ? `/chats/${encodeURIComponent(conversationId)}` : "/chats", search: location.search, hash: location.hash }} />;
}

/** Collapsed conversation pane: the same people as a labelled avatar rail.
 *
 * Extracted so the rail can be rendered without the messaging runtime. Names and
 * previews leave the rail; the count survives in the link's accessible name,
 * and the expand control is the only chrome it needs. */
export function ChatRail({ rows, labels, identities, selectedId, onExpand, headingRef, toggleRef }: {
  rows: { conversationId: string; peerId: string; unreadCount: number }[];
  labels: Map<string, string>;
  identities?: ReturnType<typeof readCachedAccountIdentities>;
  selectedId?: string;
  onExpand: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  toggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  return <section className="fb-chat-page fb-chat-rail" aria-label="Chats">
    <header className="fb-chat-header fb-chat-rail-header">
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">Chats</h1>
      <button ref={toggleRef} type="button" className="fb-chat-icon" aria-label="Expand conversation list" onClick={onExpand}>
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
  const requests = chat.conversations.filter(row => {
    const view = chat.currentProjections?.[row.conversationId] ?? row.cachedProjection;
    return !view?.ownHidden && !view?.ownDeclined && view?.mode === "REQUEST" && view.request === "INCOMING";
  }).length;
  const normalized = query.trim().replace(/^@/, "").toLowerCase();
  const rows = chat.conversations.filter((row) => {
    const view = chat.currentProjections?.[row.conversationId] ?? row.cachedProjection;
    const dismissed = view?.ownHidden || view?.ownDeclined;
    if (normalized && !`${labels.get(row.peerId) ?? ""} ${identities.get(row.peerId)?.username ?? ""} ${row.lastMessage?.unsentAt === undefined ? row.lastMessage?.body ?? "" : ""}`.toLowerCase().includes(normalized)) return false;
    if (filter === "Archived") return dismissed;
    if (dismissed) return false;
    if (filter === "Requests") return view?.mode === "REQUEST" && view.request === "INCOMING";
    if (filter === "Unread") return row.unreadCount > 0;
    return true;
  });
  // A collapsed pane is a rail of the same people, not a second list: names and
  // previews leave, each avatar stays a labelled link and the unread marker
  // survives as a dot with the count in the link's name.
  if (pane?.wide && pane.collapsed) return <ChatRail rows={rows} labels={labels} identities={identities} selectedId={selectedId}
    onExpand={pane.toggle} headingRef={heading} toggleRef={paneToggle} />;
  return <section className="fb-chat-page" aria-label="Chats">
    <AppBar title="Chats" autoFocus actions={<>
      <RetrySync accountId={accountId} />
      {pane?.wide && <button ref={paneToggle} type="button" className="fb-chat-icon" aria-label="Collapse conversation list" onClick={pane.toggle}>
        <PanelLeftClose size={20} aria-hidden="true" />
      </button>}
      <ActionMenu label="Filter chats" icon={<ListFilter size={20} aria-hidden="true" />} items={["All", "Unread", "Archived"].map(value => ({ id: value, label: value, onAction: () => setFilter(value) }))} />
    </>} />
    <label className="fb-chat-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search people or chats" placeholder="Search people or chats" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <BackupPrompt sequences={chat.conversations.reduce((total, row) => total + row.lastSequence, 0)} />
    <div className="fb-chat-filters" role="group" aria-label="Show conversations">
      {["All", "Requests"].map((value) => <button key={value} type="button" aria-label={value === "Requests" ? `Requests, ${requests}` : "All"}
        aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}{value === "Requests" && requests > 0 && <span className="fb-chat-count" aria-hidden="true">{requests}</span>}</button>)}
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
          const view = chat.currentProjections?.[row.conversationId] ?? row.cachedProjection;
          const state = view?.ownBlocked ? "Blocked by you" : view?.ownHidden ? (view.mode === "CONNECTED" ? "Archived" : "Hidden request")
            : view?.ownDeclined ? "Dismissed" : view?.mode === "CONNECTED" ? "Connected"
              : view?.request === "INCOMING" ? "Message request" : view?.request === "OUTGOING" ? "Request sent" : "Conversation";
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
                <span className="fb-chat-preview">{row.lastMessage?.unsentAt !== undefined ? "Message unsent"
                  : row.lastMessage?.body || (row.lastMessage?.messageType === "LOCATION" ? "Location shared"
                    : row.lastMessage?.messageType === "MEDIA" ? "Photo"
                      : row.lastMessage?.messageType === "VOICE" ? "Voice message" : state)}</span>
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

interface StagedChatPhoto {
  key: string;
  source?: File;
  prepared?: PreparedMessagingPhoto;
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

function ThreadSession({ accountId, conversationId }: { accountId: string; conversationId: string }) {
  const { user } = useAuth();
  const chat = useMessaging();
  const [cached] = useState(() => getCachedMessagingThreadState(accountId, conversationId));
  const [renderedRevision, setRenderedRevision] = useState(-1);
  const [threadReadFailed, setThreadReadFailed] = useState(false);
  const [threadReadRetry, setThreadReadRetry] = useState(0);
  const runtimeOpen = chat.accountId === accountId && (chat.localReady || chat.status === "ready" || chat.status === "offline");
  useEffect(() => {
    if (runtimeOpen) return watchMessagingThread(accountId, conversationId);
  }, [runtimeOpen, accountId, conversationId]);
  const threadSync = chat.threadSync?.conversationId === conversationId ? chat.threadSync : null;
  const threadReconciled = !!threadSync && (threadSync.mode === "ready" || threadSync.mode === "soft")
    && (threadSync.appliedRevision === undefined || renderedRevision >= threadSync.appliedRevision);
  // Owner feedback 2026-11-06: a failed refresh must never stop the reader.
  // `threadLive` gates server authority (mark-read, receipts, media upload);
  // the screen itself stays readable and writable from durable local state.
  const threadLive = threadReconciled && !threadReadFailed;
  // Kept for the server-side effects below, which must not act on authority the
  // client does not currently hold.
  const threadBlocked = !threadLive;
  const row = chat.conversations.find((entry) => entry.conversationId === conversationId);
  const current = chat.currentProjections?.[conversationId];
  const view = current ?? row?.cachedProjection;
  const photoAllowed = view?.mode === "CONNECTED" && !view.ownBlocked && chat.accountId === accountId;
  const labels = useLabels(accountId, row ? [row.peerId] : []);
  const person = row ? labels.get(row.peerId) : undefined;
  const name = person?.displayName || person?.username;
  // Long-press is the phone's way into the message actions; the visible
  // ellipsis is a desktop affordance and is hidden from coarse pointers.
  const [messages, setMessages] = useState<StoredHumanMessage[]>(cached?.messages ?? []);
  const [outbox, setOutbox] = useState<OutboxEntry[]>(cached?.outbox ?? []);
  const [media, setMedia] = useState<MediaAttachment[]>(cached?.media ?? []);
  const [loaded, setLoaded] = useState(!!cached);
  const [draft, setDraft] = useState("");
  const draftRevision = useRef(0);
  // A report-linked entry carries the subject once; the first send consumes it so
  // a later ordinary message is never silently tagged with the same report.
  const route = useLocation();
  const navigate = useNavigate();
  const routeRef = useRef(route); routeRef.current = route;
  const queryReport = new URLSearchParams(route.search).get("report");
  const validReport = isUuid(queryReport) ? queryReport : null;
  const [reportContext, setReportContext] = useState(validReport);
  useEffect(() => { setReportContext(validReport); }, [validReport]);
  // The full-screen conversation-info route links back here with an explicit
  // search/media request; consume it once so closing the sheet does not reopen.
  useEffect(() => {
    const params = new URLSearchParams(route.search);
    const requested = params.get("search") === "1" ? "search"
      : params.get("media") === "1" ? "media"
      : params.get("location") === "1" ? "location" : null;
    if (!requested) return;
    setSheet(requested);
    params.delete("search"); params.delete("media"); params.delete("location");
    navigate({ pathname: route.pathname, search: params.toString() ? `?${params}` : "", hash: route.hash },
      { replace: true, state: route.state });
  }, [route, navigate]);
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
  const [photoSending, setPhotoSending] = useState(false);
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
  const [voiceSending, setVoiceSending] = useState(false);
  const voiceSupported = voiceRecordingSupported();
  const voiceAllowed = photoAllowed && voiceSupported;
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
  const photoAdmissions = useRef(new Map<string, { metadata: MediaMetadata; caption: string }>());
  // True between opening the native picker and its result: render state must
  // not cancel a selection the platform is still holding.
  const picking = useRef(false);
  const admission = useRef<{ metadata: MediaMetadata; caption: string; messageType?: "MEDIA" | "VOICE" } | null>(null);
  // A failed photo/voice admission keeps its ids for an identical retry, but the
  // composer must let that retry be sent without letting the attachment change.
  const [admissionFailed, setAdmissionFailed] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  // Live contexts authorize NEW observations only. Historical Read facts are
  // durable and never disappear just because consent/context/connection changes.
  const receiptAuthority = current ? JSON.stringify([accountId, conversationId, current.peerId,
    current.epoch, current.mode, current.requestEpoch, current.ownBlocked]) : null;
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const confirmedReads = useRef(new Set<string>());
  const confirmedObservations = useRef(new Set<string>());
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
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
    ? [{ id: item.key, src: item.url, width: item.prepared?.width ?? null, height: item.prepared?.height ?? null, alt: "Photo to send" }]
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
  async function openPhoto(id: string, bytes: ArrayBuffer, mime: string, group?: string[]) {
    if (!photoAllowed) return;
    const generation = ++viewerGeneration.current;
    setDraftViewer(null);
    // A single cell pages through every live photo in the conversation; a
    // group cell pages through its own send. Photos outside the lazy-read
    // margin are read here, on the explicit open, so the counter names the
    // real sequence instead of only the cells that happened to be on screen.
    const scope = group ?? messages.filter((message) => message.unsentAt === undefined && message.messageType === "MEDIA")
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
    setPhotos((list) => list.map((entry) => entry.key === item.key ? { ...entry, preparing: true, error: false } : entry));
    await prepareStaged(item, item.source);
  }
  async function choosePhoto(source: "photos" | "camera") {
    if (Capacitor.getPlatform() !== "android") {
      (source === "camera" ? cameraInput : photoInput).current?.click();
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
  /** Web/browser pick: the same staged tray, prepared through the codec. */
  async function stageLocalFiles(files: File[]) {
    const room = Math.max(0, MAX_STAGED_PHOTOS - photos.length);
    const accepted = files.slice(0, room);
    if (accepted.length === 0) { setError(`You can send up to ${MAX_STAGED_PHOTOS} photos at once.`); return; }
    const slots = reserveStaged(accepted.length);
    for (const [index, file] of accepted.entries()) {
      const slot = slots[index];
      if (slot) await prepareStaged(slot, file);
    }
    if (accepted.length < files.length) setError(`Only ${MAX_STAGED_PHOTOS} photos can be reviewed at once. The first ${accepted.length} were added.`);
  }
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (chat.accountId !== accountId || (chat.status === "opening" && !chat.localReady) || chat.status === "closed") return;
    let cancelled = false;
    void readMessagingThreadState(accountId, conversationId).then((state) => {
      if (cancelled) return;
      setMessages(state.messages); setOutbox(state.outbox); setMedia(state.media); setLoaded(true);
      setRenderedRevision(chat.revision); setThreadReadFailed(false);
    }).catch(() => { if (!cancelled) setThreadReadFailed(true); });
    void readMessagingUnsentHoldIds(accountId, conversationId).then((ids) => {
      if (!cancelled) setHeldMessageIds(new Set(ids));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [accountId, conversationId, chat.accountId, chat.status, chat.localReady, chat.revision, threadReadRetry]);
  useLayoutEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  // Presentation-only grouping: the wire still carries one message per photo.
  const groups = useMemo(() => photoBatches(messages), [messages]);
  // Pins are shared conversation state. A pin that names a photo hidden inside
  // a grid still jumps to the one visible bubble, and a pin whose message this
  // device can no longer see (deleted for me, or not yet synced) is not drawn
  // as a dead chip.
  const pinnedIds = view?.pinnedMessageIds ?? [];
  const pinnedRows = pinnedIds.flatMap((id) => {
    const message = messages.find(entry => entry.id === (groups.leaderOf.get(id) ?? id));
    return message && message.unsentAt === undefined ? [{ id, message }] : [];
  });
  useEffect(() => {
    if (sheet || !jumpTo) return;
    // A grouped photo is drawn by its leader, so a quote that names a follower
    // still lands on the one visible bubble instead of nowhere.
    const targetId = groups.leaderOf.get(jumpTo) ?? jumpTo;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(scroll.current?.querySelectorAll<HTMLElement>("[data-chat-message]") ?? [])
        .find(element => element.dataset.chatMessage === targetId);
      target?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: shouldReduceMotion() ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
      // A ring, not a second screen: the original is already here, it only has
      // to be findable after a long scroll.
      if (target) setFlash(previous => ({ id: targetId, nonce: (previous?.nonce ?? 0) + 1 }));
      setJumpTo(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [sheet, jumpTo, groups]);
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
      nearBottom.current = distance < 32;
      setShowJump(distance > 400);
      if (document.visibilityState !== "visible" || !nearBottom.current || highest <= lastMarked.current) return;
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
  }, [accountId, conversationId, highest, loaded, threadBlocked]);

  // This is live, disposable receipt authority, never the stored unread cursor.
  // A fetched context precedes a fresh geometric observation of an inbound bubble.
  useLayoutEffect(() => {
    const area = scroll.current;
    const projections = chat.currentProjections;
    if (threadBlocked || !area || !loaded || !visible || sheet !== null || reportTarget || viewer || chat.accountId !== accountId || chat.status !== "ready"
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
  }, [accountId, conversationId, chat.accountId, chat.status, chat.currentProjections, current, receiptAuthority, loaded, messages, visible, sheet, reportTarget, viewer, threadBlocked]);

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
    if (alive.current) nearBottom.current = true;
  }
  /** A discarded note is gone: a later note must not reuse its attachment id. */
  function discardVoice() {
    if (admission.current?.messageType === "VOICE") admission.current = null;
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
    if (!row || !voiceAllowed || voiceStatus !== "review" || !voiceRecording || voiceSending) return;
    setVoiceSending(true); setError(null);
    try {
      const recording = await voice.recorder.finalize();
      if (!recording || !alive.current) return;
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
      await sendMessagingVoice(accountId, conversationId, row.peerId, attempt.metadata, bytes, replyTo?.id);
      if (!alive.current) return;
      nearBottom.current = true;
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
    } finally { if (alive.current) setVoiceSending(false); }
  }
  /**
   * Normal conversation is not a form submission: the durable outbox admits the
   * message, the draft clears, and the next message can start immediately. Only
   * authority/destructive actions take `busy`.
   */
  async function send() {
    if (!runtimeOpen || !row || photoSending) return;
    const ready = photos.filter((item): item is StagedChatPhoto & { prepared: PreparedMessagingPhoto } => !!item.prepared);
    if (photos.length > 0 && ready.length !== photos.length) return;
    if (photos.length > 0 && (view?.mode !== "CONNECTED" || view.ownBlocked)) return;
    if (photos.length === 0 && !draft.trim()) return;
    const body = convertEmoticons(draft), sendingRevision = draftRevision.current;
    // Captured once: the reply belongs to this send, and a later gesture while
    // the message is in flight is newer intent for the next message.
    const replyTargetId = replyTo?.id;
    setError(null);
    try {
      if (ready.length === 0) {
        await sendMessagingText(accountId, conversationId, row.peerId, body, reportContext ?? undefined, replyTargetId);
        if (alive.current) {
          nearBottom.current = true;
          // Only clear what this draft owned: typing that arrived while it was
          // in flight is newer intent and must survive.
          if (draftRevision.current === sendingRevision) { draftRevision.current++; setDraft(""); }
          if (reportContext) clearReportContext(reportContext);
          setReplyTo(null);
          setAdmissionFailed(false);
        }
      } else {
        setPhotoSending(true);
        // Each photo is its own message, so a failed one leaves the rest of the
        // stack intact. The caption rides the first photo only.
        let consumed = false;
        for (const [index, item] of ready.entries()) {
          const admissionKey = item.key;
          const { bytes, ...info } = item.prepared;
          const attempt = photoAdmissions.current.get(admissionKey) ?? { caption: index === 0 ? body : "",
            metadata: { ...info, durationMs: null,
              id: crypto.randomUUID(), messageId: crypto.randomUUID(), direction: "OUT" as const, expiresAt: null } };
          photoAdmissions.current.set(admissionKey, attempt);
          await sendMessagingMedia(accountId, conversationId, row.peerId, attempt.caption, attempt.metadata, bytes, replyTargetId);
          photoAdmissions.current.delete(admissionKey);
          // The caption belonged to the first message that actually left, so
          // clear the draft as soon as it is carried, not at the end of a bulk
          // send that may still fail on a later photo.
          if (!consumed && alive.current) {
            consumed = true;
            nearBottom.current = true;
            if (draftRevision.current === sendingRevision) { draftRevision.current++; setDraft(""); }
            setReplyTo(null);
          }
          if (alive.current) setPhotos((list) => {
            const removed = list.find((entry) => entry.key === admissionKey);
            if (removed) releaseStagedUrl(removed);
            return list.filter((entry) => entry.key !== admissionKey);
          });
        }
        if (alive.current) { nearBottom.current = true; setAdmissionFailed(false); }
      }
    } catch {
      if (alive.current) {
        if (photos.length > 0) { setAdmissionFailed(true); setError("Those photos could not all be saved. The unsent ones are still here."); }
        else setError("Your message could not be saved. Your draft is still here.");
      }
    } finally { if (alive.current) setPhotoSending(false); }
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
  /**
   * The actions that annotate one message. This is the same `ActionMenu` the
   * feed and the report card use, so keyboard, collision placement, dismissal
   * and styling are the app's existing ones rather than a second implementation.
   */
  function messageActions(message: StoredHumanMessage, own: boolean): MenuAction[] {
    const items: MenuAction[] = [];
    // The pointer gesture is a swipe; the menu is the keyboard and desktop path
    // to the same reply, so the capability is never gesture-only.
    if (message.unsentAt === undefined) {
      items.push({ id: "reply", label: "Reply", onAction: () => startReply(message) });
    }
    if (message.unsentAt === undefined && message.body) {
      items.push({ id: "copy", label: "Copy text", onAction: () => {
        void navigator.clipboard?.writeText(message.body).then(
          () => announce("Message copied."),
          () => setError("Could not copy this message."),
        );
      } });
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
  const canCompose = !!row && !view?.ownBlocked && (view?.mode === "CONNECTED" || view?.request !== "INCOMING");
  const searchTerm = messageQuery.trim().toLowerCase();
  const searchMatches = searchTerm ? messages.filter(message => message.unsentAt === undefined && message.body.toLowerCase().includes(searchTerm)) : [];
  const gallery = photoAllowed ? messages.filter(message => message.messageType === "MEDIA" && message.unsentAt === undefined)
    .flatMap(message => { const attachment = media.find(item => item.messageId === message.id); return attachment ? [attachment] : []; }) : [];
  const confirming = sheet === "end" || sheet === "delete" || sheet === "unsend" || sheet === "clear";
  const confirmationTitle = sheet === "end" ? "End connection?" : sheet === "unsend" ? "Unsend message?" : sheet === "clear" ? "Clear chat for me?" : "Delete for me?";
  // One action list, rendered in the wide third pane and in the compact sheet.
  const conversationInfo = <div className="fb-chat-sheet">
    {person?.username && <Link className="fb-chat-info-row" to={`/u/${encodeURIComponent(person.username)}`}><UserRound size={20} aria-hidden="true" /><span>View profile</span></Link>}
    <button type="button" className="fb-chat-info-row" onClick={() => setSheet("search")}><Search size={20} aria-hidden="true" /><span>Search chat</span></button>
    <button type="button" className="fb-chat-info-row" onClick={() => setSheet("media")}><Images size={20} aria-hidden="true" /><span>Media</span></button>
    {locationAllowed && <button type="button" className="fb-chat-info-row" onClick={() => setSheet("location")}><MapPin size={20} aria-hidden="true" /><span>Share location</span></button>}
    <hr className="fb-chat-info-divider" />
    {typeof view?.ownMuted === "boolean" ? <PreferenceSwitchRow className="fb-chat-mute" title="Mute notifications" icon={BellOff}
      checked={view.ownMuted} disabled={busy || chat.status !== "ready" || typeof current?.ownMuted !== "boolean"}
      onChange={muted => void setMuted(muted)} /> : <p className="fb-chat-secondary">Sync to change chat notifications.</p>}
    <RetrySync accountId={accountId} labelled />
    <Link className="fb-chat-info-row" to="/settings/privacy/messages"><Settings2 size={20} aria-hidden="true" /><span>Message settings</span></Link>
    <hr className="fb-chat-info-divider" />
    <button type="button" className="fb-chat-info-row" disabled={busy || !current} onClick={() => void relationship(view?.ownHidden ? "unhide" : "hide")}><Archive size={20} aria-hidden="true" /><span>{view?.ownHidden ? "Move to inbox" : view?.mode === "CONNECTED" ? "Archive" : "Hide request"}</span></button>
    {view?.mode === "CONNECTED" && <button type="button" className="fb-chat-info-row" disabled={busy || !current} onClick={() => setSheet("end")}><LogOut size={20} aria-hidden="true" /><span>End connection</span></button>}
    <button type="button" className="fb-chat-info-row" disabled={busy || !current || highest === 0 || outbox.length > 0} onClick={() => setSheet("clear")}><Trash2 size={20} aria-hidden="true" /><span>Clear chat for me</span></button>
    {outbox.length > 0 && <p className="fb-chat-secondary">Wait for messages still sending before clearing this chat.</p>}
    <hr className="fb-chat-info-divider" />
    {row && <div className="fb-chat-info-block"><ShieldBan size={20} aria-hidden="true" /><BlockControl userId={row.peerId} name={name || "this account"} blocked={current?.ownBlocked}
      onChanged={() => { void refreshMessaging(accountId).catch(() => undefined); }} /></div>}
    {row && <button type="button" className="fb-chat-info-row" onClick={() => { setSheet(null); setReportTarget("account"); }}><Flag size={20} aria-hidden="true" /><span>Report account</span></button>}
  </div>;
  return <ChatDetailsLayout details={conversationInfo} onCompactOpen={() => setSheet("actions")}
    identity={<><UserAvatar username={name || person?.username} avatarUrl={person?.avatarUrl} size={72} shape="squircle" />
      <strong dir="auto">{name || "Conversation"}</strong><span className="fb-chat-secondary">{!view ? "Saved chat" : view.mode === "CONNECTED" ? "Connected" : "Message request"}</span></>}>
    {detailsToggle => <section className="fb-chat-page" aria-label="Conversation">
    <header className="fb-chat-header">
      <Link to="/chats" className="fb-chat-icon" aria-label="Back to chats"><ArrowLeft size={22} aria-hidden="true" /></Link>
      <ChatIdentity peerId={row?.peerId} name={name} username={person?.username} avatarUrl={person?.avatarUrl} muted={view?.ownMuted === true}
        conversationId={conversationId}
        status={!view ? "Saved chat" : view.mode === "CONNECTED" ? "Connected" : "Message request"} />
      {detailsToggle}
    </header>
    {/* Pinned messages: one compact row directly under the header. Tapping a
        chip uses the same jump as a reply quote — scroll, focus and ring. */}
    {pinnedRows.length > 0 && <div className="fb-chat-pins" role="region" aria-label="Pinned messages">
      {pinnedRows.map(({ id, message }) => {
        const author = message.authorId === accountId ? "You" : name || "Member";
        const preview = replyPreview(message);
        return <button key={id} type="button" className="fb-chat-pin"
          onClick={() => { nearBottom.current = false; setJumpTo(id); }}
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
    {(threadReadFailed || threadSync?.mode === "error") && <div className="fb-chat-statusline" role="status">
      <RefreshCw size={15} aria-hidden="true" />
      <span>Showing your saved messages. New changes will load when you reconnect.</span>
      <button type="button" onClick={() => {
        setThreadReadRetry(value => value + 1); void refreshMessaging(accountId).catch(() => undefined);
      }}>Try again</button>
    </div>}
    <div className="fb-chat-messages" ref={scroll}>
      <p className="fb-chat-sync" role="status">{chat.status === "offline" ? "Messages are saved here and will send when you reconnect." : ""}</p>
      {!loaded && <p role="status" className="fb-chat-secondary">Opening messages…</p>}
      {loaded && messages.length === 0 && <p className="fb-chat-empty">{view?.request === "INCOMING" ? "A new message request."
        : "Say hello and explain why you’d like to connect."}</p>}
      {view?.mode === "REQUEST" && <div className="fb-chat-request">
        <p>{view.request === "INCOMING" ? "Accept to reply. Photos and read receipts stay off until you connect."
          : view.request === "OUTGOING" ? "Request sent. You can add another message while you wait."
            : "Send a text message to start a request."}</p>
        {view.request === "INCOMING" && <div className="fb-chat-actions">
          <button type="button" disabled={busy || !current || view.ownBlocked} onClick={() => void relationship("accept")}>Accept</button>
          <button type="button" disabled={busy || !current} onClick={() => void relationship("decline")}>Decline</button>
        </div>}
      </div>}
      <ol className="fb-chat-transcript" aria-label="Messages">
        {messages.map((message, index) => {
          // A follower photo is drawn by its leader; the transcript owns only
          // rows a reader can actually see or focus.
          if (groups.followers.has(message.id)) return null;
          const batch = groups.batches.get(message.id);
          const own = message.authorId === accountId;
          const attachment = media.find((entry) => entry.messageId === message.id);
          // The run's last photo owns the clock and the ticks; the first owns
          // the caption, the quote and the bubble. That is the order it was
          // sent in, so the status cannot describe an older photo than the one
          // the reader is looking at.
          const statusMembers = batch ?? [message];
          const statusMessage = statusMembers[statusMembers.length - 1]!;
          const statusPending = outbox.find((entry) => entry.messageId === statusMessage.id);
          const statusAttachment = media.find((entry) => entry.messageId === statusMessage.id);
          const reviewMember = statusMembers.find((entry) => outbox.some((entryPending) => entryPending.messageId === entry.id && entryPending.status === "NEEDS_REVIEW"));
          const failedMember = statusMembers.find((entry) => {
            const entryAttachment = media.find((item) => item.messageId === entry.id);
            const entryPending = outbox.find((entryPending) => entryPending.messageId === entry.id);
            return entryAttachment?.state === "FAILED" || (!entry.server && entryPending?.status === "FAILED");
          });
          const removableMembers = statusMembers.filter((entry) => (entry.messageType === "MEDIA" || entry.messageType === "VOICE")
            && media.some((item) => item.messageId === entry.id) && !entry.server);
          // One day chip per calendar day keeps a long thread readable without
          // making every bubble carry a date.
          const day = message.createdAt ? formatChatDay(message.createdAt) : "";
          const before = index > 0 ? messages[index - 1] : undefined;
          const opensDay = !!day && day !== (before?.createdAt ? formatChatDay(before.createdAt) : "");
          const quoted = message.replyToId ? messages.find((entry) => entry.id === message.replyToId) : undefined;
          const quotedAttachment = quoted?.messageType === "MEDIA" && quoted.unsentAt === undefined
            ? media.find((entry) => entry.messageId === quoted.id) : undefined;
          // A bare emoji is the message: no bubble fill, no quote, no media.
          const emojiOnly = message.unsentAt === undefined && message.messageType === "TEXT"
            && !batch && !attachment && !message.replyToId && !message.contextReportId && !message.location
            && isEmojiOnly(message.body);
          const flashClass = flash?.id === message.id ? ` fb-chat-flash-${flash.nonce % 2 ? "a" : "b"}` : "";
          return <Fragment key={message.id}>
            {opensDay && <li className="fb-chat-day" role="presentation"><span>{day}</span></li>}
          {/* The swipe and the menu reach the same reply. Your own bubble
              answers with a right-to-left pull, a received one left-to-right —
              the direction each bubble already points. */}
          <motion.li data-chat-message={message.id} tabIndex={-1}
            drag={canCompose && message.unsentAt === undefined ? "x" : false}
            dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18}
            onDragEnd={(_event, info: PanInfo) => {
              if (message.unsentAt !== undefined || !canCompose) return;
              if (replySwipeFor(info.offset.x, own)) startReply(message);
            }}
            className={own ? "fb-chat-line fb-chat-line-own" : "fb-chat-line"}>
            {/* The same contextual layer the feed and the report card use: a
                400 ms hold (or right-click / Shift+F10) opens the app's own
                menu anchored to this bubble, never a bottom sheet. */}
            <LongPressArea label={own ? "Options for your message" : "Options for received message"}
              disabled={!message.server} className="fb-chat-message-surface"
              onOpen={() => { setSelectedMessageId(message.id); haptic("commit"); }}>
            {({ open, setOpen }) => <>
            <div data-receipt-message={message.messageType === "TEXT" && message.body && message.unsentAt === undefined ? message.id : undefined}
              className={`fb-chat-message${own ? " fb-chat-message-own" : ""}${message.messageType === "VOICE" && attachment && message.unsentAt === undefined ? " fb-chat-message-voice" : ""}${emojiOnly ? " fb-chat-message-emoji" : ""}${flashClass}`}>
            <span className="sr-only">{own ? "You: " : `${name || "Member"}: `}</span>
            {message.unsentAt === undefined && message.replyToId && <button type="button" className="fb-chat-quote"
              onClick={() => { nearBottom.current = false; setJumpTo(message.replyToId!); }}
              aria-label={`Quoted message from ${quoted ? (quoted.authorId === accountId ? "you" : name || "this member") : "an unavailable message"}: ${quoted ? replyPreview(quoted) : "unavailable"}. Show original`}>
              {photoAllowed && quotedAttachment && quotedAttachment.state !== "EVICTED"
                && <ChatQuotePhoto accountId={accountId} attachment={quotedAttachment} />}
              <span className="fb-chat-quote-copy">
                <span className="fb-chat-quote-author">{quoted ? (quoted.authorId === accountId ? "You" : name || "Member") : "Quoted message"}</span>
                <span className="fb-chat-quote-preview" dir="auto">{quoted ? replyPreview(quoted) : "Message unavailable"}</span>
              </span>
            </button>}
            {message.unsentAt !== undefined ? <p>Message unsent</p> : <>
            {batch && photoAllowed && <ChatPhotoGroup accountId={accountId} conversationId={conversationId} items={batch} media={media} onOpen={openPhoto} onReady={rememberPhoto} />}
            {batch && !photoAllowed && <p>Photos are available when connected.</p>}
            {!batch && message.messageType === "MEDIA" && attachment && photoAllowed && <ChatPhoto key={attachment.id} accountId={accountId} conversationId={conversationId} attachment={attachment} onOpen={openPhoto} onReady={rememberPhoto} />}
            {!batch && message.messageType === "MEDIA" && attachment && !photoAllowed && <p>Photos are available when connected.</p>}
            {message.messageType === "VOICE" && attachment && photoAllowed && <ChatVoice key={attachment.id} accountId={accountId} conversationId={conversationId} attachment={attachment} playback={voice.player} snapshot={playbackSnapshot}
              authorName={own ? user?.displayName || user?.username : name} avatarUrl={own ? user?.avatarUrl : person?.avatarUrl} />}
            {message.messageType === "VOICE" && attachment && !photoAllowed && <p>Voice messages are available when connected.</p>}
            {message.contextReportId && <ChatReportContext reportId={message.contextReportId} safetyKey={view?.ownBlocked ? "blocked" : "clear"} />}
            {message.location && <ChatLocation location={message.location} />}
            {message.body ? <p dir="auto" className={emojiOnly ? "fb-chat-emoji-only" : undefined}>{message.body}</p>
              : message.messageType === "LOCATION" ? (!message.location && <p>Location unavailable</p>)
              : !batch && !attachment && <p>{missingAttachmentCopy(message)}</p>}
            {!batch && !attachment && !message.body && missingAttachmentStale(message) && <button type="button" onClick={() => {
              // A message whose attachment never arrived is not stuck loading:
              // ask for one full pass before telling the reader it is gone.
              void retryMessagingMedia(accountId).catch(() => setError("Could not check for this attachment. Try syncing again."));
            }}>Check again</button>}
            <span className="fb-chat-message-status">
              {statusMessage.createdAt ? <time className="fb-chat-time" dateTime={new Date(statusMessage.createdAt).toISOString()}>
                {new Date(statusMessage.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time> : null}
              {own && <>{reviewMember ? "Needs review"
                : failedMember ? (failedMember.messageType === "VOICE" ? "Voice saved" : failedMember.messageType === "MEDIA" ? "Photo saved" : "Message saved")
                : statusMessage.messageType === "MEDIA" && !statusAttachment ? "Photo pending"
                : statusMessage.messageType === "VOICE" && !statusAttachment ? "Voice pending"
                : statusAttachment && !["READY", "EVICTED"].includes(statusAttachment.state)
                  ? (statusAttachment.state === "FAILED" ? (statusMessage.messageType === "VOICE" ? "Voice saved" : "Photo saved") : "Sending…")
                : statusMessage.server ? <ReceiptTicks read={!!(statusMessage.readByPeer || readIds.has(statusMessage.id))} />
                : statusPending?.status === "FAILED" ? "Message saved" : "Sending…"}
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
            {own && removableMembers.length > 0 && <button type="button" aria-label={batch ? "Remove pending photos"
              : message.messageType === "VOICE" ? "Remove pending voice message" : "Remove pending photo"} onClick={() => {
              // The bubble is the send: removing a still-pending grid removes
              // every photo in it, never a hidden half the reader cannot see.
              void (async () => {
                try { for (const entry of removableMembers) await removeMessagingMessage(accountId, conversationId, entry.id, false); }
                catch {
                  setError("Could not confirm this change. Sync and check your chat.");
                  void refreshMessaging(accountId).catch(() => undefined);
                }
              })();
            }}>Remove</button>}
            </>}
            </div>
            {message.server && <>
              {/* The popover is anchored to the bubble itself: the trigger is an
                  invisible anchor over the long-press surface, so the menu opens
                  where the message is rather than beside a 44 px control. The
                  visible affordance below is the named control for pointers. */}
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
              <button type="button" className="fb-chat-icon fb-chat-message-options"
                aria-label={own ? "Options for your message" : "Options for received message"}
                aria-haspopup="menu" aria-expanded={open}
                onClick={() => { setOpen(true); setSelectedMessageId(message.id); haptic("commit"); }}>
                <Ellipsis size={16} aria-hidden="true" />
              </button>
            </>}
            </>}
            </LongPressArea>
          </motion.li>
          </Fragment>;
        })}
      </ol>
      {view?.ownBlocked && <p className="fb-chat-secondary">You’ve blocked this account. Manage blocked accounts in Privacy settings.</p>}
    </div>
    {showJump && <button type="button" className="fb-chat-jump" aria-label="Jump to latest message" onClick={() => {
      const area = scroll.current;
      if (area) area.scrollTo({ top: area.scrollHeight, behavior: shouldReduceMotion() ? "auto" : "smooth" });
      nearBottom.current = true; setShowJump(false);
    }}><ChevronDown size={20} aria-hidden="true" /></button>}
    {error && !sheet && <p className="fb-chat-error" role="alert">{error}</p>}
    {photos.length > 0 && <div className="fb-chat-photo-draft" role="group"
      aria-label={`${photos.length} photo${photos.length === 1 ? "" : "s"} to send`}>
      <ul className="fb-chat-photo-strip">
        {photos.map((item, index) => <li key={item.key} className="fb-chat-photo-slot">
          {item.url && item.prepared
            ? (photoAllowed
                ? <button type="button" className="fb-chat-photo-open" aria-label={`Review photo ${index + 1} of ${photos.length}`}
                    onClick={() => { setViewer(null); setDraftViewer({ key: item.key }); }}>
                    <img src={item.url} alt="" />
                  </button>
                : <span className="fb-chat-photo-open"><img src={item.url} alt="" /></span>)
            : <span className="fb-chat-photo-open fb-chat-photo-pending" role="status">
                {item.error ? <ImageOff size={20} aria-hidden="true" /> : <span className="fb-chat-photo-spinner" aria-hidden="true" />}
                <span className="sr-only">{item.error ? "Could not prepare photo" : "Preparing photo"}</span>
              </span>}
          <button type="button" className="fb-chat-photo-remove" aria-label={`Remove photo ${index + 1}`}
            disabled={photoSending || admissionFailed} onClick={() => removeStaged(item.key)}><X size={14} aria-hidden="true" /></button>
        </li>)}
      </ul>
      <div className="fb-chat-photo-options">
        <p role="status" className="fb-chat-secondary">
          {!photoAllowed ? "Photos are available when connected."
            : photoSending ? "Sending photos…"
            : photos.some(item => item.preparing) ? "Preparing photos…"
            : photos.some(item => item.error) ? "Some photos could not be prepared. Retry or remove them."
            : `${photos.length} photo${photos.length === 1 ? "" : "s"} ready. Tap one to review.`}
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
          <input ref={photoInput} type="file" accept="image/*" multiple aria-label="Photo file input" hidden onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
            if (files.length > 0 && Capacitor.getPlatform() !== "android") void stageLocalFiles(files);
          }} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" aria-label="Camera file input" hidden onChange={(event) => {
            const source = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (source && Capacitor.getPlatform() !== "android") void stageLocalFiles([source]);
          }} />
        </>}
      <PeerChatComposer value={draft} onChange={value => { draftRevision.current++; setDraft(value); }} onSend={() => void send()} inputRef={composer}
        busy={false} locked={!runtimeOpen || photoSending || voiceSending} attachmentsLocked={photoSending || admissionFailed}
        canSend={runtimeOpen && (photos.length > 0 ? photoAllowed && photos.every(item => !!item.prepared) : !!draft.trim())}
        photoAllowed={view?.mode === "CONNECTED"}
        onCamera={() => void choosePhoto("camera")} onPhotos={() => void choosePhoto("photos")}
        voiceAvailable={voiceAllowed} onVoice={toggleVoiceCapture}
        context={<>
          {replyTo && <div className="fb-chat-reply-chip" role="status" data-chat-reply-to={replyTo.id}>
            <span className="fb-chat-reply-copy">
              <span className="fb-chat-reply-author">{replyTo.label}</span>
              <span className="fb-chat-reply-preview" dir="auto">{replyTo.preview}</span>
            </span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
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
    <MediaViewer items={viewerItems} index={activeViewer ? viewerItems.findIndex((item) => item.id === activeViewer.id) : null}
      onIndexChange={(index) => { if (viewer && viewerItems[index]) setViewer({ ...viewer, id: viewerItems[index].id }); }} onClose={closePhoto} />
    <MediaViewer items={draftViewerItems} index={draftViewerIndex < 0 ? null : draftViewerIndex}
      onIndexChange={(index) => { const item = draftViewerItems[index]; if (item) setDraftViewer({ key: item.id }); }}
      onClose={() => setDraftViewer(null)} />
    <ConfirmDialog open={confirming} onClose={() => setSheet(null)} title={confirmationTitle} busy={busy}
      confirmLabel={sheet === "end" ? "End connection" : sheet === "unsend" ? "Unsend" : sheet === "clear" ? "Clear for me" : "Delete for me"}
      cancelLabel={sheet === "end" ? "Keep connection" : "Cancel"}
      confirmDisabled={!current || (sheet === "end" ? current.mode !== "CONNECTED" : sheet === "clear" ? highest === 0 || outbox.length > 0
        : !selectedMessage?.server || (sheet === "unsend" && (selectedMessage.authorId !== accountId || selectedMessage.unsentAt !== undefined)))}
      onConfirm={() => { if (sheet === "end") void relationship("end"); else if (sheet === "delete" || sheet === "unsend" || sheet === "clear") void erase(sheet); }}>
      <p>{sheet === "end" ? "Your messages stay here. Either of you can send a new request."
        : sheet === "unsend" ? "Replace this message with ‘Message unsent’ for everyone. Each device that received it keeps a hidden copy for up to 24 hours so it can still be reported, then deletes it."
          : sheet === "clear" ? "This clears your copy on your devices, not theirs." : "Remove this message from your devices, not the other person’s chat."}</p>
      {error && <p className="fb-chat-error" role="alert">{error}</p>}
    </ConfirmDialog>
    <AdaptiveTaskSurface open={sheet !== null && sheet !== "location" && !confirming} onClose={() => setSheet(null)} busy={busy}
      title={sheet === "search" ? "Search chat" : sheet === "media" ? "Conversation media" : sheet === "review" ? "Review message" : "Conversation info"}>
      {sheet === "actions" ? conversationInfo : sheet === "search" ? <div className="fb-chat-search-task">
        <label className="fb-chat-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search saved messages" value={messageQuery} onChange={event => setMessageQuery(event.target.value)} /></label>
        <p role="status" className="fb-chat-secondary">{!searchTerm ? "Search the messages saved on this device." : `${searchMatches.length} ${searchMatches.length === 1 ? "message" : "messages"} found${searchMatches.length > 100 ? ". Showing the first 100." : ""}`}</p>
        <ul className="fb-chat-search-results">{searchMatches.slice(0, 100).map(message => <li key={message.id}>
          <button type="button" onClick={() => { nearBottom.current = false; setJumpTo(message.id); setSheet(null); }}><span className="fb-chat-secondary">{message.authorId === accountId ? "You" : name || "Member"}</span><span dir="auto">{message.body}</span></button>
        </li>)}</ul>
      </div> : sheet === "media" ? !photoAllowed ? <p>Photos are available when connected.</p> : gallery.length === 0 ? <p>No photos in this conversation yet.</p> : <ul className="fb-chat-gallery" aria-label="Conversation photos">
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
    <ReportSheet open={reportTarget !== null} target={reportTarget === "account" && row ? { targetType: "USER", targetId: row.peerId }
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
