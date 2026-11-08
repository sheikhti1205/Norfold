import { useId } from "react";
import { Check } from "lucide-react";
import { CHAT_MESSAGE_TYPE_LABELS, PERSON_EVIDENCE_COPY, formatSafetyDate } from "../utils/safetyCopy";

/** One accepted message the reporter may attach to a person report. */
export interface PersonEvidenceMessage {
  id: string;
  messageType: "TEXT" | "MEDIA" | "VOICE" | "LOCATION";
  /** The exact body the server verifies; empty for a caption-less attachment. */
  body: string;
  /** When the author's device created it, in epoch milliseconds. */
  createdAt?: number;
}

export interface PersonReportEvidenceProps {
  /** Newest first, already filtered to what this reporter may send. */
  messages: readonly PersonEvidenceMessage[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}

/** The server's bound on one person report. */
export const PERSON_EVIDENCE_MAX = 20;

/**
 * The message picker inside the one report sheet.
 *
 * The owner's rule: a person report sends the five most recent messages by
 * default, whatever their kind, and the reporter may send fewer or more. The
 * default is chosen by the caller when the sheet opens; this component only
 * edits the selection.
 *
 * It never shows full media, only the kind and the caption: a thumbnail here
 * would duplicate the media viewer and suggest the bytes are evidence the
 * reporter is uploading. They are not — a copy is made server-side from the
 * original attachment.
 */
export function PersonReportEvidence({ messages, selected, onChange, disabled = false }: PersonReportEvidenceProps) {
  const groupName = useId();
  const atCap = selected.size >= PERSON_EVIDENCE_MAX;

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < PERSON_EVIDENCE_MAX) next.add(id);
    onChange(next);
  };

  if (messages.length === 0) {
    return (
      <section aria-label={PERSON_EVIDENCE_COPY.title} className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-on-surface">{PERSON_EVIDENCE_COPY.title}</h3>
        <p className="text-sm text-on-surface-variant">{PERSON_EVIDENCE_COPY.none}</p>
      </section>
    );
  }

  return (
    <section aria-label={PERSON_EVIDENCE_COPY.title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-on-surface">{PERSON_EVIDENCE_COPY.title}</h3>
        <span role="status" className="text-xs text-on-surface-variant">
          {PERSON_EVIDENCE_COPY.selected(selected.size)}
        </span>
      </div>
      <p className="text-sm text-on-surface-variant">{PERSON_EVIDENCE_COPY.hint}</p>
      {messages.length <= 5 ? (
        <p className="text-xs text-on-surface-variant">{PERSON_EVIDENCE_COPY.fewer(messages.length)}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="fb-surface-button text-sm"
          disabled={disabled || selected.size >= Math.min(messages.length, PERSON_EVIDENCE_MAX)}
          onClick={() => onChange(new Set(messages.slice(0, PERSON_EVIDENCE_MAX).map((message) => message.id)))}
        >
          {PERSON_EVIDENCE_COPY.selectAll}
        </button>
        <button
          type="button"
          className="fb-surface-button text-sm"
          disabled={disabled || selected.size === 0}
          onClick={() => onChange(new Set())}
        >
          {PERSON_EVIDENCE_COPY.clear}
        </button>
      </div>
      <ul className="flex flex-col">
        {messages.map((message) => {
          const checked = selected.has(message.id);
          const typeLabel = CHAT_MESSAGE_TYPE_LABELS[message.messageType];
          const excerpt = message.body.trim();
          const blocked = disabled || (!checked && atCap);
          const date = message.createdAt ? formatSafetyDate(new Date(message.createdAt).toISOString()) : "";
          return (
            <li key={message.id}>
              <label className="fb-choice" data-checked={checked} data-disabled={blocked}>
                <input
                  className="fb-choice-input"
                  type="checkbox"
                  name={groupName}
                  value={message.id}
                  checked={checked}
                  disabled={blocked}
                  onChange={() => toggle(message.id)}
                />
                <span className="fb-choice-title flex flex-wrap items-baseline gap-x-2">
                  <span>{typeLabel}</span>
                  {date ? <span className="text-xs font-normal text-on-surface-variant">{date}</span> : null}
                  {checked ? <Check size={16} aria-hidden="true" /> : null}
                </span>
                {excerpt ? (
                  <span className="fb-choice-description" dir="auto">{excerpt}</span>
                ) : (
                  <span className="fb-choice-description">No caption</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {atCap ? <p className="text-xs text-on-surface-variant">{PERSON_EVIDENCE_COPY.cap}</p> : null}
    </section>
  );
}
