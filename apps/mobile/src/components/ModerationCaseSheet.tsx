import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { FileText, MessageCircle, MessageSquare, UserRound } from "lucide-react";
import { useAuth } from "../auth";
import { AdaptiveTaskSurface } from "./AdaptiveTaskSurface";
import { Button } from "./Button";
import { SelectField, TextAreaField } from "./Fields";
import { ReportDatePicker } from "./ReportDatePicker";
import { announce } from "./LiveRegion";
import { friendlyError } from "../utils/friendlyErrors";
import {
  ACTION_CAPABILITIES,
  ACTION_SANCTION_KINDS,
  MODERATION_ACTIONS,
  REPORT_REASONS,
  applyModeration,
  fetchModerationTarget,
  type ModerationAction,
  type ModerationQueueEntry,
  type ModerationTarget,
  type ReportReason,
  type ReportTargetType,
} from "../services/moderation";
import {
  CHAT_MESSAGE_TYPE_LABELS,
  MODERATION_ACTION_HINTS,
  MODERATION_ACTION_LABELS,
  MODERATION_VISIBILITY_LABELS,
  REPORT_REASON_LABELS,
  REPORT_TARGET_LABELS,
  UNAVAILABLE_SENTENCES,
  formatSafetyDate,
} from "../utils/safetyCopy";
import { isMissingServerFunction } from "../utils/safetyService";

/** One readable line about the target. */
export interface TargetLine {
  label: string;
  value: string;
}

/**
 * The subject of a case at a glance.
 *
 * The queue row names a target type; a reviewer needs to know immediately
 * whether they are judging a person, a post, a comment or one chat message,
 * because the same reason code means different things in each context.
 */
const CASE_SUBJECTS = {
  POST: {
    title: "Lost & found report",
    note: "One post, with the reports filed about it.",
    Icon: FileText,
  },
  COMMENT: {
    title: "Comment",
    note: "One comment, with the reports filed about it.",
    Icon: MessageSquare,
  },
  USER: {
    title: "A person",
    note: "Reports about an account. Evidence below is what each reporter chose to send.",
    Icon: UserRound,
  },
  MESSAGE: {
    title: "Chat message",
    note: "One message, with the reports filed about it.",
    Icon: MessageCircle,
  },
} as const satisfies Record<ReportTargetType, { title: string; note: string; Icon: typeof FileText }>;

/**
 * The target, in words — never in ids.
 *
 * The server returns the live row (MC D5's bounded shape), which contains the
 * target's id and its author's id. Those are never rendered: a moderator
 * reads the CONTENT, and the ids are what the console already uses to act.
 * Every field below is picked by name from a fixed list, so a field the
 * server adds later is ignored rather than dumped.
 */
export function describeTarget(
  targetType: ReportTargetType,
  row: Record<string, unknown> | null,
): TargetLine[] {
  if (!row) return [];
  const read = (key: string): string | null => {
    const value = row[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const lines: TargetLine[] = [];
  const push = (label: string, value: string | null): void => {
    if (value) lines.push({ label, value });
  };

  if (targetType === "POST") {
    push("Title", read("title"));
    push("Details", read("description_excerpt"));
    push("Kind", read("type") === "FOUND" ? "Found item" : read("type") === "LOST" ? "Lost item" : null);
    push("Report status", read("status"));
    const visibility = read("moderation_visibility");
    push(
      "Visibility",
      visibility && visibility in MODERATION_VISIBILITY_LABELS
        ? MODERATION_VISIBILITY_LABELS[visibility as keyof typeof MODERATION_VISIBILITY_LABELS]
        : null,
    );
    push("Posted", formatSafetyDate(read("created_at")) || null);
    return lines;
  }

  if (targetType === "COMMENT") {
    push("Comment", read("body_excerpt"));
    push("Posted", formatSafetyDate(read("created_at")) || null);
    return lines;
  }

  push("Name", read("display_name"));
  push("Username", read("username"));
  push("Joined", formatSafetyDate(read("created_at")) || null);
  return lines;
}

/**
 * The evidence snapshot, in words.
 *
 * The snapshot is what the report was about, captured when the report was
 * filed (MC D5), so an author editing the content afterwards cannot erase
 * it. It is bounded to a few hundred characters and it expires: after 90
 * days the server stops serving it (MC §13.11), and a case whose snapshot has
 * expired says so rather than showing an empty box.
 */
export function describeEvidence(evidence: Record<string, unknown> | null): TargetLine[] {
  if (!evidence) return [];
  const read = (key: string): string | null => {
    const value = evidence[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const lines: TargetLine[] = [];
  const push = (label: string, value: string | null): void => {
    if (value) lines.push({ label, value });
  };
  push("Title", read("title"));
  push("Details", read("description_excerpt"));
  push(evidence.target_type === "MESSAGE" ? "Message" : "Comment", read("body_excerpt"));
  push("Name", read("display_name"));
  push("Username", read("username"));
  return lines;
}

export interface EvidenceMessageLine {
  messageId: string;
  type: "TEXT" | "MEDIA" | "VOICE" | "LOCATION";
  excerpt: string;
  sentAt: string;
}

/**
 * The messages a reporter chose to send with a person report.
 *
 * These are "reporter-selected recent messages", never the whole conversation:
 * the label in the case says so, because a moderator must not mistake a chosen
 * excerpt for a complete thread. A row whose type is outside the closed
 * vocabulary is dropped rather than guessed.
 */
export function describeEvidenceMessages(evidence: Record<string, unknown> | null): EvidenceMessageLine[] {
  if (!evidence || !Array.isArray(evidence.messages)) return [];
  return evidence.messages
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value))
    .map((row) => {
      const messageId = typeof row.message_id === "string" ? row.message_id : "";
      const type = row.message_type;
      if (!messageId) return null;
      if (type !== "TEXT" && type !== "MEDIA" && type !== "VOICE" && type !== "LOCATION") return null;
      return {
        messageId,
        type,
        excerpt: typeof row.body_excerpt === "string" ? row.body_excerpt.trim() : "",
        sentAt: typeof row.sent_at === "string" ? row.sent_at : "",
      } satisfies EvidenceMessageLine;
    })
    .filter((row): row is EvidenceMessageLine => row !== null);
}

export interface ModerationCaseSheetProps {
  open: boolean;
  /** The queue row being reviewed. Null while the sheet is closed. */
  entry: ModerationQueueEntry | null;
  /** The capabilities the signed-in account holds. */
  capabilities: readonly string[];
  /** True for an admin, who holds every capability. */
  isAdmin: boolean;
  onClose: () => void;
  /** Called after the server confirmed an action. */
  onApplied: () => void;
}

/**
 * One case: the target, the reports about it, what has already been done,
 * and the one action a moderator may take.
 *
 * THE SERVER IS THE AUTHORITY FOR EVERY ACTION. The client hides an action
 * the account's permissions do not cover — a moderator with `content_hide`
 * may hide but is not offered a suspension — but the hiding is a courtesy:
 * `findback_apply_moderation` re-checks the permission on every call and
 * refuses with 42501. A refusal is shown as a sentence.
 *
 * THE ACTION LIST IS CLOSED. The nine actions are the server's nine (MC
 * D39), and the reason code is one of the server's seven report reasons.
 */
export function ModerationCaseSheet({
  open,
  entry,
  capabilities,
  isAdmin,
  onClose,
  onApplied,
}: ModerationCaseSheetProps) {
  const { user } = useAuth();
  const generation = useRef(0);
  const readRequest = useRef(0);
  const endsAtFieldId = useId();
  const targetType = entry?.targetType;
  const targetId = entry?.targetId;
  const [target, setTarget] = useState<ModerationTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ModerationAction | "">("");
  const [reasonCode, setReasonCode] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [applying, setApplying] = useState(false);

  const allowedActions = MODERATION_ACTIONS.filter((value) => {
    const capability = ACTION_CAPABILITIES[value];
    return isAdmin || capabilities.includes(capability);
  });

  const load = useCallback(async () => {
    if (!open || !user?.id || !targetType || !targetId) return;
    const version = generation.current;
    const request = ++readRequest.current;
    const isCurrent = () => generation.current === version && readRequest.current === request;
    setLoading(true);
    setError(null);
    setTarget(null);
    try {
      const result = await fetchModerationTarget(targetType, targetId);
      if (!isCurrent()) return;
      if (result.targetType !== targetType || result.targetId !== targetId) {
        throw new Error("The server did not return this case.");
      }
      setTarget(result);
    } catch (err) {
      if (!isCurrent()) return;
      setTarget(null);
      setError(isMissingServerFunction(err) ? UNAVAILABLE_SENTENCES.queue : friendlyError(err).message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [open, user?.id, targetType, targetId]);

  // Account/case/open boundaries invalidate reads AND mutation callbacks before
  // paint. Keep the shared sheet mounted so its exit animation still runs.
  useLayoutEffect(() => {
    generation.current += 1;
    setTarget(null);
    setAction("");
    setReasonCode("");
    setNote("");
    setEndsAt("");
    setError(null);
    setLoading(false);
    setApplying(false);
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  if (!entry) return null;

  const targetLines = describeTarget(entry.targetType, target?.target ?? null);
  const sanctionKind = action === "" ? null : ACTION_SANCTION_KINDS[action] ?? null;
  const subject = CASE_SUBJECTS[entry.targetType];
  const SubjectIcon = subject.Icon;

  const apply = async (): Promise<void> => {
    if (applying || loading || !target || !open || !user) return;
    const version = generation.current;
    const isCurrent = () => generation.current === version;
    if (action === "") {
      setError("Choose what to do.");
      announce("Choose what to do.");
      return;
    }
    if (reasonCode === "") {
      setError("Choose the reason for this action.");
      announce("Choose the reason for this action.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await applyModeration({
        targetType: entry.targetType,
        targetId: entry.targetId,
        action,
        reasonCode,
        note: note.trim() === "" ? null : note.trim(),
        sanctionKind,
        sanctionEndsAt: endsAt === "" ? null : new Date(`${endsAt}T00:00:00Z`).toISOString(),
      });
      if (!isCurrent()) return;
      const outcome = "Action recorded.";
      announce(outcome);
      onApplied();
    } catch (err) {
      if (!isCurrent()) return;
      const sentence = err instanceof Error && err.message === "MODERATION_DECISION_FINAL"
        ? "Another moderator already decided this case. Only that moderator can change it, unless the author asks for re-evaluation."
        : isMissingServerFunction(err)
          ? UNAVAILABLE_SENTENCES.queue
          : friendlyError(err).message;
      setError(sentence);
      announce(sentence);
    } finally {
      if (isCurrent()) setApplying(false);
    }
  };

  return (
    <AdaptiveTaskSurface open={open} onClose={onClose} title="Review this case" busy={applying}>
      <div className="flex flex-col gap-4 py-2">
        <section className="fb-case-summary" aria-label="Case summary">
          <span className="fb-case-summary-icon" aria-hidden="true"><SubjectIcon size={20} /></span>
          <div className="fb-case-summary-copy">
            <p className="fb-case-summary-title">{subject.title}</p>
            <p className="fb-case-summary-meta">
              {entry.reportCount === 1 ? "1 report" : `${entry.reportCount} reports`}
              {" · first reported "}{formatSafetyDate(entry.firstReportedAt)}
            </p>
            <p className="fb-case-summary-note">{subject.note}</p>
          </div>
        </section>

        {loading ? (
          <p role="status" className="fb-admin-note">
            Loading the case…
          </p>
        ) : null}

        {error ? (
          <p role="alert" data-testid="moderation-case-error" className="fb-admin-error">
            {error}
          </p>
        ) : null}

        {target && !target.targetExists ? (
          <p role="status" data-testid="moderation-case-missing" className="fb-admin-note">
            The thing that was reported no longer exists. You can still close the report.
          </p>
        ) : null}

        {target?.reopen ? (
          <section
            aria-label="Re-evaluation requested"
            data-testid="moderation-case-reopen"
            className="flex flex-col gap-1 rounded-m3-sm border border-outline-variant bg-surface-container p-3"
          >
            <h3 className="text-sm font-semibold text-on-surface">
              The author asked for re-evaluation
            </h3>
            <p className="fb-admin-log-detail">{target.reopen.message}</p>
            <p className="text-xs text-on-surface-variant">
              Asked {formatSafetyDate(target.reopen.submittedAt)}. Deciding it now starts a new
              decision.
            </p>
          </section>
        ) : null}

        {target?.decision ? (
          <p className="fb-admin-log-detail" data-testid="moderation-case-decision">
            Current decision: {MODERATION_ACTION_LABELS[target.decision.action]} · round{" "}
            {target.decision.generation}
          </p>
        ) : null}

        {targetLines.length > 0 ? (
          <section aria-label="What was reported" className="fb-case-block">
            <h3 className="fb-case-block-title">What was reported</h3>
            <dl className="fb-case-fields">
              {targetLines.map((line) => (
                <div key={line.label} className="fb-case-field">
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {target && target.reports.length > 0 ? (
          <section aria-label="The reports" className="fb-case-block">
            <h3 className="fb-case-block-title">The reports</h3>
            <div className="fb-case-reports">
              {target.reports.map((report, index) => {
                const evidence = describeEvidence(report.evidence);
                const messages = describeEvidenceMessages(report.evidence);
                return (
                  <article key={report.id} className="fb-case-report">
                    <header className="fb-case-report-head">
                      <span className="fb-case-report-index">Report {index + 1}</span>
                      <span className="fb-case-report-kind">{REPORT_TARGET_LABELS[entry.targetType]}</span>
                    </header>
                    <p className="fb-case-report-reason">{REPORT_REASON_LABELS[report.reason]}</p>
                    <p className="fb-admin-log-detail">Filed {formatSafetyDate(report.createdAt)}</p>
                    {report.detail ? (
                      <p className="fb-case-report-detail">The reporter wrote: “{report.detail}”</p>
                    ) : null}
                    <div className="fb-case-evidence">
                      <p className="fb-case-evidence-title">What the reporter sent</p>
                      {report.evidence === null ? (
                        <p className="fb-admin-log-detail">
                          The saved snapshot is no longer available — it expires after 90 days.
                        </p>
                      ) : evidence.length > 0 ? (
                        <dl className="fb-case-fields">
                          {evidence.map((line) => (
                            <div key={line.label} className="fb-case-field">
                              <dt>{line.label}</dt>
                              <dd>{line.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {messages.length > 0 ? (
                        <div className="fb-case-messages" data-testid="moderation-case-messages">
                          <p className="fb-case-evidence-title">
                            {messages.length === 1
                              ? "1 selected message"
                              : `${messages.length} selected messages`}
                            <span className="fb-case-evidence-note">not the whole chat</span>
                          </p>
                          <ul className="fb-case-message-list">
                            {messages.map((message) => (
                              <li key={message.messageId}>
                                <span className="fb-case-message-type">{CHAT_MESSAGE_TYPE_LABELS[message.type]}</span>
                                {message.sentAt ? <span className="fb-case-message-time">{formatSafetyDate(message.sentAt)}</span> : null}
                                {message.excerpt ? <span className="fb-case-message-body">“{message.excerpt}”</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {report.media.length > 0 ? (
                        <p className="fb-case-media" data-testid="moderation-case-media">
                          {report.media.length === 1 ? "1 attached evidence copy" : `${report.media.length} attached evidence copies`}
                          {" · "}
                          {report.media.filter((item) => item.mime.startsWith("audio/")).length > 0
                            ? "Photos and voice notes are copied from the sent message."
                            : "Photos are copied from the sent message."}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {target && target.decisions.length > 0 ? (
          <section aria-label="What has been done" className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-on-surface">What has been done</h3>
            {target.decisions.map((decision) => (
              <p key={`${decision.action}-${decision.createdAt}`} className="fb-admin-log-detail">
                {MODERATION_ACTION_LABELS[decision.action]} — {REPORT_REASON_LABELS[decision.reason]} ·{" "}
                {formatSafetyDate(decision.createdAt)}
              </p>
            ))}
          </section>
        ) : null}

        <section aria-label="Take action" className="fb-admin-form">
          <h3 className="text-sm font-semibold text-on-surface">Take action</h3>
          {allowedActions.length === 0 ? (
            <p className="fb-admin-note">
              Your permissions do not allow any action on this case. An admin can act on it.
            </p>
          ) : (
            <>
              <SelectField
                label="What to do"
                value={action}
                placeholder="Choose an action"
                options={allowedActions.map((value) => ({
                  value,
                  label: `${MODERATION_ACTION_LABELS[value]} — ${MODERATION_ACTION_HINTS[value]}`,
                }))}
                onChange={(value) => {
                  setAction(value as ModerationAction | "");
                  setError(null);
                }}
              />
              <SelectField
                label="Reason"
                value={reasonCode}
                placeholder="Choose a reason"
                options={REPORT_REASONS.map((value) => ({ value, label: REPORT_REASON_LABELS[value] }))}
                onChange={(value) => {
                  setReasonCode(value as ReportReason | "");
                  setError(null);
                }}
              />
              {sanctionKind ? (
                <div className="block">
                  {/*
                    A sanction end date is necessarily in the future, which the
                    report picker's default past-only domain forbids. The
                    opt-in keeps every report and filter field capped.
                  */}
                  <label
                    htmlFor={endsAtFieldId}
                    className="mb-1 block text-sm font-medium text-on-surface"
                  >
                    Ends on (optional)
                  </label>
                  <ReportDatePicker
                    id={endsAtFieldId}
                    label="Ends on (optional)"
                    title="End date"
                    description="Choose the day the restriction should end. Leave it empty for no end date."
                    placeholder="No end date"
                    allowFuture
                    disabled={applying}
                    value={endsAt}
                    onChange={setEndsAt}
                  />
                  {endsAt ? (
                    <div className="mt-1 flex justify-end">
                      <Button
                        variant="text"
                        disabled={applying}
                        aria-label="Clear end date"
                        onClick={() => {
                          setEndsAt("");
                          // The Clear control unmounts with the value; keep
                          // keyboard focus on the field instead of the body.
                          document.getElementById(endsAtFieldId)?.focus();
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <TextAreaField
                label="Note for the record (optional)"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button onClick={() => void apply()} loading={applying}>
                Apply
              </Button>
            </>
          )}
        </section>
      </div>
    </AdaptiveTaskSurface>
  );
}
