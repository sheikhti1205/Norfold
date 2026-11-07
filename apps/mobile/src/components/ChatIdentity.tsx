import { useEffect, useRef } from "react";
import { BellOff } from "lucide-react";
import { UserAvatar } from "./UserAvatar";
import { UserIdentityTrigger } from "./UserIdentityTrigger";

/**
 * Compact thread heading; the complete name remains available to every user.
 *
 * Avatar and name are ONE direct link to the canonical full-screen profile.
 * When the conversation id is known, the same link carries the conversation
 * context the profile page revalidates before showing anything private. There
 * is no quick-card popover and no dropdown chevron.
 *
 * Lives in its own module (not in the Messaging screen) so the visual fixture
 * route can render the production header without pulling in the messaging
 * runtime.
 */
export function ChatIdentity({ peerId, name, username = name, avatarUrl, status, muted = false, conversationId }: {
  peerId?: string; name?: string; username?: string; avatarUrl?: string | null; status: string; muted?: boolean;
  conversationId?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const label = name || username || "Conversation";
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const identity = (
    <span className="fb-chat-identity">
      <UserAvatar username={label} avatarUrl={avatarUrl} size={44} />
      <span className="fb-chat-identity-copy"><span className="fb-chat-identity-name">{label}</span></span>
    </span>
  );
  return (
    <>
      <div className="fb-chat-heading">
        <h1 ref={heading} tabIndex={-1}>{username && peerId
          ? <UserIdentityTrigger person={{ id: peerId, username, displayName: name, avatarUrl, contextConversationId: conversationId }} trigger={identity} />
          : identity}
        </h1>
        <p className="fb-chat-secondary">
          {status}
          {muted && (
            <span className="fb-chat-muted" role="img" aria-label="Notifications muted">
              <BellOff size={13} aria-hidden="true" />
              <span aria-hidden="true">Muted</span>
            </span>
          )}
        </p>
      </div>
    </>
  );
}
