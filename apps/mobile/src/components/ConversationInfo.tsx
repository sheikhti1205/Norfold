import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Archive, BellOff, Images, LogOut, MapPin, Search, Settings2, ShieldBan, Trash2 } from "lucide-react";
import { useMessaging } from "../services/messaging/useMessaging";
import {
  changeMessagingRelationship, clearMessagingConversation, readMessagingMedia,
  readMessagingThreadState, setMessagingMuted,
} from "../services/messaging/runtime";
import type { MediaAttachment, StoredHumanMessage } from "../services/messaging/history";
import { PreferenceSwitchRow } from "./settings";
import { BlockControl } from "./BlockControl";
import { ReportSheet } from "./ReportSheet";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { announce } from "./LiveRegion";
import { friendlyError } from "../utils/friendlyErrors";
import "./conversationInfo.css";

/**
 * Conversation-information sections rendered by the canonical `/u/:username`
 * route when — and only when — the caller supplies a conversation id that the
 * signed-in account is actually a participant in and whose other participant is
 * this profile. The profile page performs that revalidation before mounting
 * this component; nothing here trusts a query parameter.
 *
 * Every action reuses the existing messaging owner: mute, archive/hide, END,
 * clear-for-me, block and report. There is no second management screen and no
 * third pane.
 */
export function ConversationInfo({ accountId, conversationId, peer }: {
  accountId: string;
  conversationId: string;
  peer: { id: string; username: string; name: string };
}) {
  const chat = useMessaging();
  const [messages, setMessages] = useState<StoredHumanMessage[]>([]);
  const [media, setMedia] = useState<MediaAttachment[]>([]);
  const [pendingOutbox, setPendingOutbox] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"end" | "clear" | null>(null);
  const [reporting, setReporting] = useState(false);
  const [viewer, setViewer] = useState<{ index: number; items: MediaViewerItem[] } | null>(null);

  const current = chat.accountId === accountId ? chat.currentProjections?.[conversationId] : undefined;
  const live = chat.accountId === accountId && chat.status === "ready" && Boolean(current);

  useEffect(() => {
    let cancelled = false;
    void readMessagingThreadState(accountId, conversationId).then((state) => {
      if (cancelled) return;
      setMessages(state.messages); setMedia(state.media); setPendingOutbox(state.outbox.length);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [accountId, conversationId, chat.revision]);

  const galleries = useMemo(() => media.filter((attachment) =>
    messages.some((message) => message.id === attachment.messageId && message.unsentAt === undefined)), [media, messages]);
  const highest = messages.reduce((maximum, message) => Math.max(maximum, message.server?.sequence ?? 0), 0);

  async function act(work: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await work(); setNotice(done); announce(done); }
    catch (cause) { setError(friendlyError(cause).message); }
    finally { setBusy(false); }
  }

  return <section aria-label="Conversation information" className="fb-conversation-info">
    <div className="fb-conversation-shortcuts">
      <Link to={`/chats/${encodeURIComponent(conversationId)}?search=1`}><Search size={20} aria-hidden="true" /><span>Search chat</span></Link>
      <a href="#conversation-photos"><Images size={20} aria-hidden="true" /><span>Shared photos</span></a>
      <Link to="/settings/privacy/messages"><Settings2 size={20} aria-hidden="true" /><span>Message settings</span></Link>
      {current?.mode === "CONNECTED" && (
        <Link to={`/chats/${encodeURIComponent(conversationId)}?location=1`}>
          <MapPin size={20} aria-hidden="true" /><span>Share location</span>
        </Link>
      )}
    </div>

    <section id="conversation-photos" aria-label="Shared photos" className="fb-conversation-photos">
      <header><h2>Shared photos</h2><span>{galleries.length}</span></header>
      {galleries.length === 0 ? <p className="fb-chat-secondary">No photos in this conversation yet.</p> : <>
        <ul>
          {galleries.slice(0, 9).map((attachment) => <li key={attachment.id}>
            <SharedPhoto accountId={accountId} attachment={attachment} onOpen={(src, width, height) => {
              setViewer({ index: galleries.findIndex((entry) => entry.id === attachment.id), items: [{
                id: attachment.messageId, src, width, height, alt: "Conversation photo",
              }] });
            }} />
          </li>)}
        </ul>
        {galleries.length > 9 && <Link className="fb-surface-button" to={`/chats/${encodeURIComponent(conversationId)}?media=1`}>View all photos</Link>}
      </>}
    </section>

    <section aria-label="Conversation actions" className="fb-conversation-actions">
      <h2>Conversation</h2>
      {typeof current?.ownMuted === "boolean"
        ? <PreferenceSwitchRow title="Mute notifications" icon={BellOff} checked={current.ownMuted}
            disabled={busy || !live} onChange={(muted) => void act(() => setMessagingMuted(accountId, conversationId, muted), muted ? "Conversation muted." : "Conversation unmuted.")} />
        : <p className="fb-chat-secondary">Sync to change chat notifications.</p>}
      <button type="button" disabled={busy || !live} onClick={() => void act(
        () => changeMessagingRelationship(accountId, conversationId, current?.ownHidden ? "unhide" : "hide"),
        current?.ownHidden ? "Moved back to your inbox." : current?.mode === "CONNECTED" ? "Conversation archived." : "Request hidden.")}>
        <Archive size={20} aria-hidden="true" /><span>{current?.ownHidden ? "Move to inbox" : current?.mode === "CONNECTED" ? "Archive conversation" : "Hide request"}</span>
      </button>
      {current?.mode === "CONNECTED" && (confirming === "end"
        ? <InlineConfirm text="Your messages stay here. Either of you can send a new request."
            confirm="End connection" busy={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void act(async () => { await changeMessagingRelationship(accountId, conversationId, "end"); setConfirming(null); }, "Connection ended.")} />
        : <button type="button" disabled={busy || !live} onClick={() => setConfirming("end")}><LogOut size={20} aria-hidden="true" /><span>End connection</span></button>)}
      {(confirming === "clear"
        ? <InlineConfirm text="This clears your copy on your devices, not theirs."
            confirm="Clear for me" busy={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void act(async () => { await clearMessagingConversation(accountId, conversationId, highest); setConfirming(null); }, "Your copy was cleared.")} />
        : <button type="button" disabled={busy || !live || highest === 0 || pendingOutbox > 0} onClick={() => setConfirming("clear")}>
            <Trash2 size={20} aria-hidden="true" /><span>Clear chat for me</span>
          </button>)}
      {pendingOutbox > 0 && <p className="fb-chat-secondary">Wait for messages still sending before clearing this chat.</p>}
      <hr className="fb-chat-info-divider" />
      <div className="fb-conversation-block">
        <ShieldBan size={20} aria-hidden="true" />
        <BlockControl userId={peer.id} name={peer.name} blocked={current?.ownBlocked}
          onChanged={() => undefined} />
      </div>
      <button type="button" onClick={() => setReporting(true)}><FlagIcon /><span>Report account</span></button>
    </section>

    {error && <p role="alert" className="fb-chat-error">{error}</p>}
    {notice && <p role="status" className="fb-chat-secondary">{notice}</p>}
    <MediaViewer items={viewer?.items ?? []} index={viewer ? 0 : null} onIndexChange={() => undefined} onClose={() => setViewer(null)} />
    <ReportSheet open={reporting} target={{ targetType: "USER", targetId: peer.id }} onClose={() => setReporting(false)} />
  </section>;
}

function FlagIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></svg>;
}

function InlineConfirm({ text, confirm, busy, onCancel, onConfirm }: {
  text: string; confirm: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="fb-conversation-confirm" role="group" aria-label={confirm}>
    <p>{text}</p>
    <div>
      <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="destructive" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirm}</button>
    </div>
  </div>;
}

/** One locally-stored chat photo. Bytes never leave the device for this grid;
 * opening reuses the canonical viewer with the same local object URL. */
function SharedPhoto({ accountId, attachment, onOpen }: {
  accountId: string; attachment: MediaAttachment; onOpen: (src: string, width: number, height: number) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void readMessagingMedia(accountId, attachment.id).then((bytes) => {
      if (cancelled || !bytes) { if (!cancelled) setFailed(true); return; }
      url = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
      setSrc(url);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [accountId, attachment.id, attachment.mime]);
  if (failed) return <div className="fb-conversation-photo-fallback" aria-label="Photo unavailable">Unavailable</div>;
  if (!src) return <div className="fb-conversation-photo-fallback" role="status">Loading…</div>;
  return <button type="button" aria-label="View photo" onClick={() => onOpen(src, attachment.width, attachment.height)}>
    <img src={src} alt="" />
  </button>;
}
