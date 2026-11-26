import { useEffect, useRef, useState } from "react";
import { MapPin, Users } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import type { PostItem, PublicProfile as PublicProfileShape } from "@norfold/shared";
import { fetchPublicProfile, appendReportPage, hasMoreReports } from "../services/profile";
import { connectionCountLabel, fetchConnectionCount } from "../services/connections";
import { fetchFeed } from "../services/posts";
import { fetchReputationTier, REPUTATION_TIER_LABELS } from "../services/trust";
import { UserAvatar } from "../components/UserAvatar";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { BlockedByViewerShield } from "../components/BlockedByViewerShield";
import { SettingsGroup, SettingsPage, SettingsRow, StatusPill } from "../components/settings";
import { useAuth } from "../auth";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";
import { PeerIdentityActions } from "../components/PeerIdentityActions";
import { ConversationInfo } from "../components/ConversationInfo";
import { useMessaging } from "../services/messaging/useMessaging";
import { friendlyError } from "../utils/friendlyErrors";

/** "Joined January 2026" from an ISO timestamp; tolerant of bad input. */
function formatJoined(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Joined recently";
  return `Joined ${date.toLocaleDateString(undefined, { year: "numeric", month: "long" })}`;
}

/**
 * Read-only public profile for another member, reached from a report author or
 * a profile link (`/u/:username`). Shows only the public identity surface —
 * avatar, display name, @username, bio, verification badges, join date — and
 * that member's reports via the existing feed API. Email and phone never travel
 * here: `fetchPublicProfile` maps the safe RPC columns only.
 */
export function PublicProfile() {
  const { username = "" } = useParams();
  const { user } = useAuth();
  // Reports carry viewer-dependent block flags. Neither a handle nor an
  // account replacement may reuse that list, its reveal state or its cursors.
  return <PublicProfileSession key={JSON.stringify([user?.id ?? null, username])} username={username} />;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function PublicProfileSession({ username }: { username: string }) {
  const { user } = useAuth();
  const chat = useMessaging();
  const [params] = useSearchParams();
  const rawConversation = params.get("conversation");
  const rawReport = params.get("report");
  const contextReportId = rawReport && UUID.test(rawReport) ? rawReport : undefined;
  const alive = useSafetyLifetime();
  const pageInFlight = useRef(false);
  const [profile, setProfile] = useState<PublicProfileShape | null>(null);
  const [reports, setReports] = useState<PostItem[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reputationTier, setReputationTier] = useState<string | null>(null);
  const [reputationLoading, setReputationLoading] = useState(false);
  const [connections, setConnections] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setMoreError(null);
    setProfile(null);
    setReports([]);
    setNextCursor(null);
    setConnections(null);
    (async () => {
      try {
        const found = await fetchPublicProfile(username);
        if (!alive) return;
        setProfile(found);
        void fetchConnectionCount(found.id).then((count) => {
          if (alive) setConnections(count);
        }).catch(() => undefined);
        setReputationTier(null);
        setReputationLoading(true);
        void fetchReputationTier(found.id).then((tier) => {
          if (alive) setReputationTier(tier);
        }).catch(() => {
          if (alive) setReputationTier(null);
        }).finally(() => {
          if (alive) setReputationLoading(false);
        });
        void loadReports(found.id);
      } catch (err) {
        if (alive) {
          const notFound = friendlyError(err).code === "NOT_FOUND";
          setRetryable(!notFound);
          setError(notFound ? "That profile could not be found." : "That profile could not be loaded. Please try again.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username, retry]);

  async function loadReports(userId: string) {
    setReportsLoading(true);
    setReportsError(false);
    try {
      const page = await fetchFeed({ userId });
      if (!alive.current) return;
      setReports(page.items);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      if (alive.current) setReportsError(true);
    } finally {
      if (alive.current) setReportsLoading(false);
    }
  }

  async function loadMoreReports() {
    if (!alive.current || !profile || !nextCursor || pageInFlight.current) return;
    pageInFlight.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchFeed({ userId: profile.id }, nextCursor);
      if (!alive.current) return;
      setReports((previous) => appendReportPage(previous, page));
      setNextCursor(page.nextCursor ?? null);
    } catch {
      if (!alive.current) return;
      // The loaded profile and reports stay: only the next page failed.
      setMoreError("Could not load more reports. Check your connection and try again.");
    } finally {
      pageInFlight.current = false;
      if (alive.current) setLoadingMore(false);
    }
  }

  const projection = rawConversation && user && chat.accountId === user.id && chat.status === "ready"
    ? chat.currentProjections?.[rawConversation] : undefined;
  const conversation = projection && profile && rawConversation && projection.peerId === profile.id
    && projection.conversationId === rawConversation && !projection.ownBlocked ? rawConversation : undefined;

  return (
    <SettingsPage title="Profile" backTo="/" backLabel="Back">
      {loading && <p role="status">Loading profile…</p>}
      {error && (
        <div><p
          role="alert"
          className="rounded-m3-sm border border-error px-3 py-2 text-sm text-error"
        >
          {error}
        </p>{retryable && <button type="button" className="inline-flex min-h-12 min-w-12 items-center text-sm text-on-surface" onClick={() => setRetry((value) => value + 1)}>Try again</button>}</div>
      )}
      {profile && (
        <>
          <section
            aria-label="Public profile"
            className="flex min-w-0 flex-col gap-3 py-2"
          >
            {/* Reference anatomy: 64px avatar left, identity block beside it,
                bio and location below, one meta line last. Verification is the
                badge at the name, not a second row of pills; the overflow menu
                lives once, in PeerIdentityActions, instead of twice. */}
            <div className="flex min-w-0 items-start gap-4">
              <UserAvatar avatarUrl={profile.avatarUrl} username={profile.username} size={64} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-lg font-bold leading-snug">
                  <span className="min-w-0 break-words">{profile.displayName || profile.username}</span>
                  <VerifiedBadge emailVerified={profile.emailVerified} phoneVerified={profile.phoneVerified}
                    telegramPhoneVerified={(profile as { telegramPhoneVerified?: boolean }).telegramPhoneVerified} />
                </h2>
                <p className="break-all text-sm text-on-surface-variant">@{profile.username}</p>
                {profile.locationLabel && (
                  <p className="flex min-w-0 items-center gap-1 text-sm text-on-surface-variant">
                    <MapPin size={14} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 break-words">{profile.locationLabel}</span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
                  <span>{formatJoined(profile.createdAt)}</span>
                  {connectionCountLabel(connections) && (
                    <span className="inline-flex items-center gap-1" data-testid="public-profile-connections">
                      <Users size={12} aria-hidden="true" />
                      {connectionCountLabel(connections)}
                    </span>
                  )}
                  {reputationLoading && <span role="status">Checking reputation…</span>}
                  {reputationTier && (
                    <StatusPill tone={reputationTier === "TRUSTED" ? "success" : reputationTier === "NORMAL" ? "accent" : "neutral"}>
                      Reputation: {REPUTATION_TIER_LABELS[reputationTier as keyof typeof REPUTATION_TIER_LABELS] ?? reputationTier}
                    </StatusPill>
                  )}
                </div>
              </div>
            </div>
            {profile.bio ? (
              <p className="whitespace-pre-line break-words text-[0.9375rem] leading-relaxed text-on-surface">{profile.bio}</p>
            ) : (
              // An absent bio is a stated tag.
              <p data-testid="public-profile-no-bio"
                className="inline-flex max-w-max items-center rounded-full border border-outline-variant px-2 py-0.5 text-xs text-on-surface-variant">
                No bio
              </p>
            )}
            {user && <PeerIdentityActions person={{ ...profile, contextReportId }} />}
          </section>

          {/* Conversation context is sensitive: it is shown only when this
              account's live runtime proves the caller is a participant and the
              profile is the other participant. A stale or forged id falls back
              to the public profile with no private sections. */}
          {conversation && user && (
            <ConversationInfo accountId={user.id} conversationId={conversation}
              peer={{ id: profile.id, username: profile.username, name: profile.displayName || profile.username }} />
          )}

          <SettingsGroup title="Reports">
            {reportsLoading ? (
              <p role="status" className="p-4 text-sm text-on-surface-variant">Loading reports…</p>
            ) : reportsError ? (
              <div className="flex flex-col gap-2 p-4">
                <p role="alert" className="text-sm text-error">Could not load reports. Check your connection and try again.</p>
                <button type="button" onClick={() => void loadReports(profile.id)}
                  className="inline-flex min-h-12 min-w-12 items-center self-start px-2 text-sm font-medium underline">Retry</button>
              </div>
            ) : reports.length === 0 ? (
              <p className="p-4 text-sm text-on-surface-variant">No public reports yet.</p>
            ) : (
              reports.map((report) => (
                // O5 mount (CF-060 R10): outside the SettingsRow anchor, whose
                // own docs forbid an interactive control inside the row.
                <BlockedByViewerShield
                  key={report.id}
                  rowId={report.id}
                  blocked={report.blockedAuthor}
                  mode="row"
                >
                  <SettingsRow
                    title={report.title}
                    description={report.type === "LOST" ? "Lost" : "Found"}
                    route={`/posts/${report.id}`}
                  />
                </BlockedByViewerShield>
              ))
            )}
            {hasMoreReports({ items: reports, nextCursor }) && (
              <div className="flex flex-col gap-2 p-4">
                {moreError && (
                  <p role="alert" className="text-sm text-error">
                    {moreError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void loadMoreReports()}
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  className="min-h-12 rounded-m3-sm bg-surface-container px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
                >
                  {loadingMore ? "Loading more reports…" : "Load more reports"}
                </button>
              </div>
            )}
          </SettingsGroup>
        </>
      )}
    </SettingsPage>
  );
}
