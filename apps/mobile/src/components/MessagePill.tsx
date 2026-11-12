import { X } from "lucide-react";
import { UserAvatar } from "./UserAvatar";
import "./MessagingStrip.css";

export interface MessagePillProps {
  person: { name: string; avatarUrl?: string | null; username: string };
  preview: string;
  onOpen: () => void;
  onDismiss: () => void;
}

export function MessagePill({ person, preview, onOpen, onDismiss }: MessagePillProps) {
  return (
    <div className="fb-message-pill" role="status" aria-live="polite">
      <button type="button" className="fb-message-pill-open" onClick={onOpen}>
        <UserAvatar avatarUrl={person.avatarUrl} username={person.username} size={40} />
        <span className="fb-message-pill-content">
          <span className="fb-message-pill-name">{person.name}</span>
          <span className="fb-message-pill-preview">{preview}</span>
        </span>
      </button>
      <button type="button" className="fb-message-pill-dismiss" aria-label={`Dismiss message from ${person.name}`}
        onClick={(event) => { event.stopPropagation(); onDismiss(); }}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
