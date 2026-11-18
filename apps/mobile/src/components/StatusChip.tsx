import type { ComponentType } from "react";
import type { PostItem } from "@norfold/shared";
import { CircleAlert, CircleCheck, CircleDashed, Link2, Lock } from "lucide-react";

export type SemanticStatusKind = "lost" | "found" | "unrecovered" | "matched" | "recovered" | "closed";

/**
 * Derive the single semantic status chip from existing PostItem fields only —
 * no invented statuses. An OPEN report reads as its type (Lost/Found); any
 * resolved lifecycle state supersedes it (Matched/Recovered/Closed).
 */
function semanticStatus(post: PostItem): { kind: SemanticStatusKind; label: string } {
  switch (post.status) {
    case "MATCHED":
      return { kind: "matched", label: "Matched" };
    case "RECOVERED":
      return { kind: "recovered", label: "Recovered" };
    case "CLOSED":
      return { kind: "closed", label: "Closed" };
    default:
      return post.type === "LOST"
        ? { kind: "lost", label: "Lost" }
        : { kind: "found", label: "Found" };
  }
}

/**
 * The report surface shows both facts at once: what the report is (Lost or
 * Found) and where its lifecycle stands (Unrecovered until it is resolved).
 * The feed keeps the single collapsed chip, because there the state has to
 * survive a two-line clamp.
 */
export function detailStatusBadges(post: PostItem): Array<{ kind: SemanticStatusKind; label: string }> {
  const type = post.type === "LOST"
    ? { kind: "lost" as const, label: "Lost" }
    : { kind: "found" as const, label: "Found" };
  const lifecycle = post.status === "OPEN"
    ? { kind: "unrecovered" as const, label: "Unrecovered" }
    : semanticStatus(post);
  return [type, lifecycle];
}

const STATUS_ICONS: Record<SemanticStatusKind, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  lost: CircleAlert,
  found: CircleCheck,
  unrecovered: CircleDashed,
  matched: Link2,
  recovered: CircleCheck,
  closed: Lock,
};

const STATUS_TONE: Record<SemanticStatusKind, string> = {
  lost: "fb-status-lost",
  found: "fb-status-found",
  unrecovered: "fb-status-open",
  matched: "fb-status-matched",
  recovered: "fb-status-recovered",
  closed: "fb-status-closed",
};

/**
 * Canonical semantic status badge: text + icon carry the meaning, never color
 * alone. The tone sets the fill and ink; the hairline border derives from the
 * ink so every tone keeps a defined edge on its own surface.
 */
export function StatusBadge({ kind, label, testId }: {
  kind: SemanticStatusKind; label: string; testId?: string;
}) {
  const Icon = STATUS_ICONS[kind];
  return (
    <span data-testid={testId} data-status={kind} className={`fb-type-badge ${STATUS_TONE[kind]}`}>
      <Icon size={14} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Extracted verbatim from `PostCardContent` (I4a) so the comment report card
 * reuses one badge renderer; the testid and tone classes do not change for any
 * existing consumer.
 */
export function StatusChip({ post }: { post: PostItem }) {
  const status = semanticStatus(post);
  return <StatusBadge kind={status.kind} label={status.label} testId="post-status-chip" />;
}
