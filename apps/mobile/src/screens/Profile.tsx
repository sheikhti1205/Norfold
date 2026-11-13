import { Bookmark, ChevronRight, CircleCheck, FileStack, HelpCircle, MessagesSquare, Settings as SettingsIcon, Star, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth";
import { UserAvatar } from "../components/UserAvatar";
import { SettingsGroup, SettingsPage, SettingsRow, StatusPill } from "../components/settings";
import {
  fetchReputationTier,
  REPUTATION_TIER_LABELS,
  type ReputationTier,
} from "../services/trust";
import "./Profile.css";

/**
 * Own-profile reputation. The tier is a SERVER-owned label (NEW / NORMAL /
 * TRUSTED): this reads it and never derives, averages or caches a score. The
 * value is keyed by account so a previous account's label cannot survive a
 * switch, and an unreadable tier says so instead of guessing.
 */
function useOwnReputation(userId: string | undefined) {
  const [state, setState] = useState<
    { accountId: string; status: "loading" } | { accountId: string; status: "ready"; tier: ReputationTier } | { accountId: string; status: "unavailable" }
  >({ accountId: userId ?? "", status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const accountId = userId ?? "";
    if (!accountId) return;
    setState({ accountId, status: "loading" });
    void fetchReputationTier(accountId)
      .then((tier) => {
        if (!cancelled) setState({ accountId, status: "ready", tier });
      })
      .catch(() => {
        if (!cancelled) setState({ accountId, status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  // Never show a previous account's label during the first render after a switch.
  return state.accountId === (userId ?? "") ? state : { accountId: userId ?? "", status: "loading" as const };
}

/**
 * Profile landing: who you are, then the places your account can take you.
 *
 * Owner direction 2026-11-13 (references: the Instagram / X / Facebook profile
 * headers): identity is one compact band - avatar, name, handle, trust label,
 * email state - and everything else is a short destination list. No marketing
 * paragraphs, no second reputation card, no row that repeats what the band
 * already says. The page is a hub, not a dashboard.
 *
 * Profile stays the ONE canonical trust surface: the reputation label and the
 * way into ratings live here, not scattered onto every card, and rating detail
 * is reached from here rather than from Settings.
 *
 * The identity band uses the canonical UserAvatar; email and verification state
 * stay owner-only and never reach the public profile.
 */
export function Profile() {
  const { user } = useAuth();
  const reputation = useOwnReputation(user?.id);
  if (!user) return null;

  return (
    <SettingsPage title="Profile" backTo="/settings" backLabel="Back to Settings" className="fb-profile">
      <section aria-label="Account" className="fb-profile-identity">
        <UserAvatar avatarUrl={user.avatarUrl} username={user.username} size={56} />
        <div className="fb-profile-copy">
          <p className="fb-profile-name">{user.displayName?.trim() || `@${user.username}`}</p>
          <p className="fb-profile-handle">@{user.username}</p>
          <p className="fb-profile-mail">
            <span className="fb-profile-email">{user.email}</span>
            {user.emailVerified ? (
              <span className="fb-profile-verified">
                <CircleCheck size={14} aria-hidden="true" />
                Email verified
              </span>
            ) : (
              <Link to="/verify" className="fb-profile-verify">Verify email</Link>
            )}
          </p>
        </div>
        <Link to="/profile/edit" aria-label="Edit profile" className="fb-profile-edit">
          Edit
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section aria-label="Reputation" className="fb-profile-reputation">
        {reputation.status === "loading" && (
          <span role="status" className="fb-profile-reputation-note">Checking your reputation…</span>
        )}
        {reputation.status === "unavailable" && (
          <span role="status" className="fb-profile-reputation-note">Your reputation is unavailable right now.</span>
        )}
        {reputation.status === "ready" && (
          <>
            <StatusPill tone={reputation.tier === "TRUSTED" ? "success" : reputation.tier === "NORMAL" ? "accent" : "neutral"}>
              {REPUTATION_TIER_LABELS[reputation.tier]}
            </StatusPill>
            <span className="fb-profile-reputation-label">Reputation</span>
            <span className="fb-profile-reputation-note">From returned items and ratings</span>
          </>
        )}
      </section>

      <nav aria-label="Profile actions" className="fb-profile-actions">
        <SettingsGroup title="Activity">
          <SettingsRow title="My reports" icon={FileStack} route="/my" />
          <SettingsRow title="Saved reports" icon={Bookmark} route="/saved" />
          <SettingsRow title="Chats" icon={MessagesSquare} route="/chats" />
          <SettingsRow title="Ratings & recoveries" icon={Star} iconTone="amber" route="/settings/returns" />
        </SettingsGroup>
        <SettingsGroup title="Account">
          <SettingsRow title="Public profile" icon={UserRound} iconTone="blue" route={`/u/${user.username}`} />
          <SettingsRow title="Settings" icon={SettingsIcon} route="/settings" />
          <SettingsRow title="Help & guide" icon={HelpCircle} iconTone="help" route="/settings/help" />
        </SettingsGroup>
      </nav>
    </SettingsPage>
  );
}
