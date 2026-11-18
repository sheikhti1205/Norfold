import type { ReactNode } from "react";
import { Link } from "react-router";
import { UserAvatar } from "./UserAvatar";
import { ProfilePreview } from "./ProfilePreview";
import { identityDisplayName, identityHref, type PublicIdentity } from "./identity";
import "./UserIdentityTrigger.css";

export { identityDisplayName, identityHref };
export type { PublicIdentity };

/**
 * A person's avatar and name are ONE link to their full-screen profile.
 *
 * The link is still the destination on every input. Around it sits the one
 * profile card (`ProfilePreview`), so every surface that names a person answers
 * "who is this?" in place: a gentle rest or key focus on a computer, and a tap
 * on a phone. The card's own avatar, name and View full profile button open the
 * same canonical destination.
 *
 * Rows that also do something else (a chat row, a helper picker) split their hit
 * targets instead of making the identity a selector.
 */
export function UserIdentityTrigger({ person, trigger, className = "" }: {
  person: PublicIdentity;
  trigger?: ReactNode;
  className?: string;
}) {
  const name = identityDisplayName(person);
  return (
    <ProfilePreview person={person}>
      <Link to={identityHref(person)} className={`fb-identity-link ${className}`} aria-label={`Open ${name}'s profile`}>
        {trigger ?? <>
          <UserAvatar username={name} avatarUrl={person.avatarUrl} size={28} />
          <span className="fb-identity-name">{name}</span>
        </>}
      </Link>
    </ProfilePreview>
  );
}
