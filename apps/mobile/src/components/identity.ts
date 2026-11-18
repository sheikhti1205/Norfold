import type { SearchedProfile } from "@norfold/shared";

/**
 * One person's public identity, as every surface carries it.
 *
 * Lives apart from `UserIdentityTrigger` so the trigger can wrap its own link
 * in the profile card without a runtime import cycle.
 */
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
