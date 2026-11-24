import { useState } from "react";
import { useAuth } from "../auth";
import { useMessaging } from "../services/messaging/useMessaging";
import { changeMessagingRelationship } from "../services/messaging/runtime";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";
import { SafetyActions } from "./SafetyActions";
import { PeerChatButton } from "./PeerChatButton";
import type { PublicIdentity } from "./identity";

/**
 * The person's actions on their full profile: one relationship button, the
 * quiet way out of a friendship, and the safety owner.
 *
 * There is no connect form and no second way to
 * start a conversation. `PeerChatButton` owns the single action and the
 * relationship labels, so the card and the profile page cannot drift apart.
 */
export function PeerIdentityActions({ person }: { person: PublicIdentity }) {
  const { user } = useAuth();
  if (!user || user.id === person.id) return null;
  return <PeerActionsSession key={JSON.stringify([user.id, person.id, person.contextReportId])} accountId={user.id} person={person} />;
}

function PeerActionsSession({ accountId, person }: { accountId: string; person: PublicIdentity }) {
  const chat = useMessaging();
  const alive = useSafetyLifetime();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Relationship authority exists only after a completed refresh. A cached or
  // offline projection is not current authority, so it never offers the quiet
  // way out of a friendship it cannot prove.
  const ready = chat.accountId === accountId && chat.status === "ready";
  const live = ready
    ? Object.values(chat.currentProjections ?? {}).find((row) => row.peerId === person.id)
    : undefined;
  const projection = live ?? (chat.conversations ?? [])
    .map((summary) => summary.cachedProjection)
    .find((row) => row?.peerId === person.id) ?? undefined;
  const name = person.displayName?.trim() || person.username;

  // A blocked pair is an honest state, not an empty space: say what is true
  // and leave unblock/report to the canonical safety owner. The cache cannot
  // settle a block; only the live snapshot can.
  if (live?.ownBlocked) return <div className="fb-peer-actions">
    <p className="fb-identity-relationship">You blocked this account. Unblock it to message.</p>
    <SafetyActions reportPerson person={{ userId: person.id, name }} />
  </div>;

  function endRelationship() {
    if (!ready || !projection || busy) return;
    setBusy(true);
    setNotice(null);
    void changeMessagingRelationship(accountId, projection.conversationId, "end")
      .then(() => { if (alive.current) { setConfirmEnd(false); setNotice("Removed from friends."); } })
      .catch(() => { if (alive.current) setNotice("Couldn't remove this friend. Try again."); })
      .finally(() => { if (alive.current) setBusy(false); });
  }

  return <div className="fb-peer-actions">
    <PeerChatButton person={person} />
    {projection?.mode === "CONNECTED" && (confirmEnd
      ? <div className="fb-peer-actions-confirm" role="group" aria-label="Remove friend">
          <p>Your messages stay in the conversation. Either of you can send a new request.</p>
          <div>
            <button type="button" className="fb-surface-button" disabled={busy} onClick={() => setConfirmEnd(false)}>Cancel</button>
            <button type="button" className="fb-surface-button destructive" disabled={busy} onClick={endRelationship}>
              {busy ? "Removing…" : "Remove friend"}
            </button>
          </div>
        </div>
      : <button type="button" className="fb-surface-button" disabled={busy} onClick={() => setConfirmEnd(true)}>Remove friend</button>)}
    {notice && <p className="fb-peer-chat-note" role="status">{notice}</p>}
    {/* §9 safety rows: the canonical safety owner supplies Report user and
        Block user; this card composes it rather than adding a second control. */}
    <SafetyActions reportPerson person={{ userId: person.id, name }} />
  </div>;
}
