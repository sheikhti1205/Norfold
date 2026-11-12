import { UserAvatar } from "./UserAvatar";
import "./MessagingStrip.css";

export type StripPerson = { conversationId: string; name: string; avatarUrl?: string | null; username: string };

export interface ConversationStripProps {
  people: StripPerson[];
  activeConversationId?: string | null;
  onOpen: (conversationId: string) => void;
  onDismiss?: (conversationId: string) => void;
  max?: number;
}

export function ConversationStrip({ people, activeConversationId, onOpen, max = 8 }: ConversationStripProps) {
  if (people.length === 0) return <p className="fb-conversation-strip-empty">Conversations will appear here.</p>;

  return (
    <div className="fb-conversation-strip" style={{ maxWidth: `${Math.max(1, max) * 72}px` }}>
      {people.map((person) => (
        <button key={person.conversationId} type="button" className="fb-conversation-strip-person"
          aria-label={person.name} aria-current={person.conversationId === activeConversationId ? "true" : undefined}
          onClick={() => onOpen(person.conversationId)}>
          <UserAvatar avatarUrl={person.avatarUrl} username={person.username} size={44} />
          <span className="fb-conversation-strip-name">{person.name}</span>
        </button>
      ))}
    </div>
  );
}
