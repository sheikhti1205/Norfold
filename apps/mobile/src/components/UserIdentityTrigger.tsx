import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SearchedProfile } from "@norfold/shared";
import { UserAvatar } from "./UserAvatar";

export type PublicIdentity = Pick<SearchedProfile, "id" | "username"> & Partial<Pick<SearchedProfile, "displayName" | "avatarUrl">> & {
  /** Present when this identity was opened from a report: the first message may
   * carry that live report reference so the recipient knows the subject. */
  contextReportId?: string;
  /** Present when opened from a conversation: the canonical profile route then
   * also shows the conversation-information sections after server revalidation. */
  contextConversationId?: string;
};

/** The one canonical person destination. Context travels in the query string
 * so the profile page can revalidate it; nothing private is in the URL. */
export function identityHref(person: Pick<PublicIdentity, "username" | "contextReportId" | "contextConversationId">): string {
  const params = new URLSearchParams();
  if (person.contextReportId) params.set("report", person.contextReportId);
  if (person.contextConversationId) params.set("conversation", person.contextConversationId);
  const query = params.toString();
  return `/u/${encodeURIComponent(person.username)}${query ? `?${query}` : ""}`;
}

export function identityDisplayName(person: Pick<PublicIdentity, "username" | "displayName">): string {
  return person.displayName?.trim() || person.username;
}

/**
 * A person's avatar and name are ONE direct link to their full-screen profile.
 *
 * There is deliberately no quick-card popover, mini profile, bottom sheet or
 * intermediate step: a person is a destination. Rows that also do something
 * else (a chat row, a helper picker) split their hit targets instead of making
 * the identity a selector.
 */
export function UserIdentityTrigger({ person, trigger, className = "" }: {
  person: PublicIdentity;
  trigger?: ReactNode;
  className?: string;
}) {
  const name = identityDisplayName(person);
  return (
    <Link to={identityHref(person)} className={`fb-identity-link ${className}`} aria-label={`Open ${name}'s profile`}>
      {trigger ?? <>
        <UserAvatar username={name} avatarUrl={person.avatarUrl} size={28} />
        <span className="fb-identity-name">{name}</span>
      </>}
    </Link>
  );
}
