import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { MessageSquareText, UserCheck } from "lucide-react";
import { useOptionalAuth } from "../auth";
import { useMessaging } from "../services/messaging/useMessaging";
import { refreshMessaging, requestMessagingConversation } from "../services/messaging/runtime";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";
import type { PublicIdentity } from "./identity";

/**
 * The one people action: message this person.
 *
 * Owner direction 2026-11-18: messaging anyone starts the conversation, and a
 * person who is not a friend yet receives it as a message request they can
 * accept or decline. There is no second "connect" action to get wrong, and a
 * friend is a designed state (check + Friends), not another text button.
 *
 * The live snapshot is the authority. Before it is ready the button falls back
 * to this account's own cached index for the label and destination, because a
 * friend whose live projections are still opening must not be offered a second
 * friend request. The cache is never used for a block decision, which only the
 * live state can settle.
 */
export function PeerChatButton({ person, className = "" }: { person: PublicIdentity; className?: string }) {
  // The card that hosts this button can be opened outside the signed-in shell
  // (a public profile page, a test harness). The optional session decides
  // whether there is an action at all; everything below needs a real session,
  // so it mounts only for a signed-in viewer.
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  if (!user || user.id === person.id) return null;
  return <PeerChatSession key={JSON.stringify([user.id, person.id, person.contextReportId])} accountId={user.id} person={person} className={className} />;
}

function PeerChatSession({ accountId, person, className }: { accountId: string; person: PublicIdentity; className: string }) {
  const chat = useMessaging();
  const navigate = useNavigate();
  const alive = useSafetyLifetime();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ready = chat.accountId === accountId && chat.status === "ready";
  const live = ready
    ? Object.values(chat.currentProjections ?? {}).find((row) => row.peerId === person.id)
    : undefined;
  const projection = live ?? (chat.conversations ?? [])
    .map((summary) => summary.cachedProjection)
    .find((row) => row?.peerId === person.id) ?? undefined;

  if (live?.ownBlocked) {
    return <p className="fb-peer-chat-note">You blocked this account. Unblock it to message.</p>;
  }

  const connected = projection?.mode === "CONNECTED";
  const incoming = projection?.mode === "REQUEST" && projection.request === "INCOMING";
  const outgoing = projection?.mode === "REQUEST" && projection.request === "OUTGOING";
  const reportQuery = person.contextReportId ? `?report=${encodeURIComponent(person.contextReportId)}` : "";
  const href = projection
    ? `/chats/${encodeURIComponent(projection.conversationId)}${reportQuery}`
    : null;
  const label = incoming ? "View request" : outgoing ? "Open chat" : "Message";
  const relationshipNote = connected ? null
    : outgoing ? "Request sent. You can still message."
      : incoming ? "This person asked to message you. Accept or decline in the chat."
        : null;

  async function run() {
    if (pending.current) return;
    setNote(null);
    if (href) {
      navigate(href);
      return;
    }
    if (!ready) {
      // The runtime may still be opening, or offline. Ask it to open and say so
      // instead of leaving a control that silently does nothing.
      setNote(chat.status === "offline"
        ? "You're offline. Check your connection, then tap again."
        : "Opening your messages. Tap again in a moment.");
      void refreshMessaging(accountId).catch(() => undefined);
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const conversationId = await requestMessagingConversation(accountId, person.id);
      if (alive.current) navigate(`/chats/${encodeURIComponent(conversationId)}${reportQuery}`);
    } catch {
      if (alive.current) setNote("Couldn't start this conversation. Check your connection and try again.");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`fb-peer-chat-primary ${className}`.trim()}
        onClick={() => void run()}
        disabled={busy}
        aria-busy={busy}
        aria-label={`${label} ${person.displayName?.trim() || person.username}`}
      >
        <MessageSquareText size={17} aria-hidden="true" />
        <span>{busy ? "Opening…" : label}</span>
      </button>
      {connected && (
        <span className="fb-peer-chat-friends">
          <UserCheck size={16} aria-hidden="true" />
          Friends
        </span>
      )}
      {(relationshipNote || note) && (
        <p className="fb-peer-chat-note" role="status">{note ?? relationshipNote}</p>
      )}
    </>
  );
}
