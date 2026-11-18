import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { MessageCircle, UserPlus } from "lucide-react";
import { useOptionalAuth } from "../auth";
import { useMessaging } from "../services/messaging/useMessaging";
import { refreshMessaging, requestMessagingConversation } from "../services/messaging/runtime";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";
import type { PublicIdentity } from "./identity";

/**
 * The one people action: add a friend, or message a friend.
 *
 * Owner direction 2026-11-18: a single button, never a connect form. A person
 * you have no relationship with gets "Add friend", which sends the request and
 * opens the conversation straight away. Once accepted the same button reads
 * "Message" and opens that conversation. A request that is waiting reads
 * "Request sent", and one that reached you reads "View request"; both open the
 * conversation, which is the canonical owner of accepting or declining.
 *
 * The relationship comes from this account's live messaging snapshot only.
 * A cached projection is not current authority, so before the snapshot is
 * ready the button asks the runtime to open instead of guessing a state.
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
  const projection = ready
    ? Object.values(chat.currentProjections ?? {}).find((row) => row.peerId === person.id)
    : undefined;

  if (projection?.ownBlocked) {
    return <p className="fb-peer-chat-note">You blocked this account. Unblock it to message.</p>;
  }

  const connected = projection?.mode === "CONNECTED";
  const reportQuery = person.contextReportId ? `?report=${encodeURIComponent(person.contextReportId)}` : "";
  const href = projection
    ? `/chats/${encodeURIComponent(projection.conversationId)}${reportQuery}`
    : null;
  const label = connected ? "Message"
    : projection?.request === "OUTGOING" ? "Open chat"
      : projection?.request === "INCOMING" ? "View request"
        : "Add friend";
  const Icon = href ? MessageCircle : UserPlus;
  const relationshipNote = connected ? null
    : projection?.request === "OUTGOING" ? "Request sent. You can still message."
      : projection?.request === "INCOMING" ? "This person asked to message you."
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
        <Icon size={17} aria-hidden="true" />
        <span>{busy ? "Opening…" : label}</span>
      </button>
      {(relationshipNote || note) && (
        <p className="fb-peer-chat-note" role="status">{note ?? relationshipNote}</p>
      )}
    </>
  );
}
