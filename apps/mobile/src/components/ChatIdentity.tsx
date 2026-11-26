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
 *
 * `variant="dock"` is the window's Messenger-style hierarchy: a 40px circular
 * avatar beside ONE copy column that stacks the name and the relationship
 * line. The status line moves inside the identity copy for the dock only, so
 * the 40px avatar and both text lines are a single ~48px row instead of three
 * lines hanging under the avatar. It is a `span` there because the copy sits
 * inside the heading link; the full-page heading keeps its status paragraph
 * below the `h1`. Shape and size stay here because the avatar is part of the
 * identity link; the header chrome is owned by the caller's stylesheet.
 */
export function ChatIdentity({ peerId, name, username = name, avatarUrl, status, muted = false, conversationId, variant }: {
  peerId?: string; name?: string; username?: string; avatarUrl?: string | null; status: string; muted?: boolean;
  conversationId?: string;
  /** `dock` swaps the 44px squircle for the window's 40px circle. */
  variant?: "page" | "dock";
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const label = name || username || "Conversation";
  const dock = variant === "dock";
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const relationship = (
    <>
      {status}
      {muted && (
        <span className="fb-chat-muted" role="img" aria-label="Notifications muted">
          <BellOff size={13} aria-hidden="true" />
          <span aria-hidden="true">Muted</span>
        </span>
      )}
    </>
  );
  const identity = (
    <span className="fb-chat-identity">
      <UserAvatar username={label} avatarUrl={avatarUrl} size={dock ? 40 : 44} shape={dock ? "circle" : "squircle"} />
      <span className="fb-chat-identity-copy">
        <span className="fb-chat-identity-name">{label}</span>
        {dock && <span className="fb-chat-secondary">{relationship}</span>}
      </span>
    </span>
  );
  return (
    <>
      <div className="fb-chat-heading">
        <h1 ref={heading} tabIndex={-1}>{username && peerId
          ? <UserIdentityTrigger person={{ id: peerId, username, displayName: name, avatarUrl, contextConversationId: conversationId }} trigger={identity} />
          : identity}
        </h1>
        {!dock && <p className="fb-chat-secondary">{relationship}</p>}
      </div>
    </>
  );
}
