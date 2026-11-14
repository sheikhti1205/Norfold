import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CloudOff,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Star,
} from "lucide-react";
import {
  SettingIconTile,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusPill,
} from "../components/settings";
import { announce } from "../components/LiveRegion";
import { useAuth } from "../auth";
import { fetchPost } from "../services/posts";
import { fetchAccountLabels } from "../services/accountLabels";
import {
  canRateReturn,
  fetchReputationTier,
  fetchStanding,
  isTrustUnavailable,
  listMyRecoveries,
  rateReturn,
  type MyRecovery,
  type ReputationTier,
  type Standing,
} from "../services/trust";
import { ApiError } from "../services/session";
import "./Returns.css";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";
import { isMissingServerFunction } from "../utils/safetyService";
import { friendlyError } from "../utils/friendlyErrors";
import {
  RATING_REFUSAL_SENTENCES,
  REPUTATION_TIER_SENTENCES,
  STANDING_SENTENCES,
  formatSafetyDate,
} from "../utils/safetyCopy";

/** What a reader can say about one recovery. */
interface RecoveryView {
  row: MyRecovery;
  /** The recovered report's title, when it can still be read. */
  title: string | null;
  /** The other participant's name, when the account still has one. */
  counterpartName: string | null;
  /** True when the reader is the person who lost the item. */
  readerIsOwner: boolean | null;
}

/**
 * What the server refused, in words.
 *
 * The server owns the reason; the client owns the sentence. A refusal the
 * rating call already knows how to phrase is phrased here (looked up by
 * code), so no raw database text can ever reach the screen. Anything else
 * falls back to the shared error taxonomy, which is deliberately vague.
 */
function refusalSentence(err: unknown): string {
  if (err instanceof ApiError && err.code) {
    const known = RATING_REFUSAL_SENTENCES[err.code];
    if (known) return known;
  }
  return friendlyError(err).message;
}

/**
 * Recovered items, thanks and standing.
 *
 * THREE THINGS, IN ONE PLACE.
 *
 *   * THE SUMMARY. A recovery is a durable ROW, not a status: the report
 *     leaving the open search says the report closed, while this row says
 *     who returned it (MC D25). The reader sees the report, the date, and
 *     whether they were the one who got their item back or the one who
 *     helped.
 *
 *   * THE RATING, ELIGIBILITY-BACKED. A rating is written only by a
 *     participant in the recovery relationship, once per direction, and
 *     never about yourself (MC D26). The client never decides who may be
 *     rated: the server derives the other participant (the function has no
 *     rated-user parameter) and refuses a non-participant, a second rating
 *     in the same direction and a self rating. The control is offered only
 *     when the server's own row says there is a counterpart and the reader
 *     has not rated yet; the server still has the last word, and its refusal
 *     is shown as a sentence.
 *
 *   * THE REPUTATION AND THE STANDING. Reputation is DERIVED, a label
 *     computed at call time from the ratings a member received and their
 *     active sanction, never a stored score and never a number (MC D28).
 *     Standing is shown to its subject only; the server refuses to describe
 *     anybody else, so this screen only ever asks about the reader.
 *
 * LIST-FIRST. Standing, reputation and every recovery are rows with the shared
 * icon tile, title and description language. A recovery that can still be
 * rated carries its five targets under that row rather than in the display-only
 * value slot, because five 44dp targets cannot share a settings row's width.
 *
 * THE SERVICE IS THE CANONICAL ONE. `services/trust.ts` is owned by the
 * trust-client lane; this screen reads it and adds no second trust service
 * of its own.
 */
export function Returns() {
  const { user } = useAuth();
  return user ? <ScopedReturns key={user.id} userId={user.id} /> : null;
}

function ScopedReturns({ userId }: { userId: string }) {
  const alive = useSafetyLifetime();
  const [views, setViews] = useState<RecoveryView[] | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [tier, setTier] = useState<ReputationTier | null>(null);
  const [trustUnavailable, setTrustUnavailable] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [standingError, setStandingError] = useState<string | null>(null);
  const [tierError, setTierError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    setTrustUnavailable(null);
    setViews(null);
    let rows: MyRecovery[];
    try {
      rows = await listMyRecoveries();
    } catch (err) {
      if (!alive.current) return;
      if (isTrustUnavailable(err) || isMissingServerFunction(err)) {
        setTrustUnavailable(
          "Recovered items are not available in this build yet. The server does not have the recovery records yet.",
        );
        return;
      }
      setListError(friendlyError(err).message);
      return;
    }

    if (!alive.current) return;
    const names = await fetchAccountLabels(
      rows.map((row) => row.counterpartUserId).filter((id): id is string => id !== null),
    ).catch(() => new Map<string, string>());
    if (!alive.current) return;

    const loaded = await Promise.all(
      rows.map(async (row): Promise<RecoveryView> => {
        let title: string | null = null;
        let readerIsOwner: boolean | null = null;
        try {
          const post = await fetchPost(row.lostPostId);
          title = post.title;
          readerIsOwner = userId ? post.userId === userId : null;
        } catch {
          // The report may be gone. The recovery still happened, so the row
          // stays; it just has no title to show.
          title = null;
        }
        return {
          row,
          title,
          counterpartName: row.counterpartUserId ? (names.get(row.counterpartUserId) ?? null) : null,
          readerIsOwner,
        };
      }),
    );
    if (alive.current) setViews(loaded);
  }, [userId, alive]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadStanding = useCallback(async () => {
    setStandingError(null); setStanding(null);
    try {
      const value = await fetchStanding();
      if (alive.current) setStanding(value);
    } catch (err) {
      if (alive.current) setStandingError(isMissingServerFunction(err)
        ? "Your standing is not available in this build yet." : friendlyError(err).message);
    }
  }, [alive]);
  const loadTier = useCallback(async () => {
    setTierError(null); setTier(null);
    try {
      const value = await fetchReputationTier(userId);
      if (alive.current) setTier(value);
    } catch (err) {
      if (alive.current) setTierError(isMissingServerFunction(err)
        ? "Your reputation is not available in this build yet." : friendlyError(err).message);
    }
  }, [alive, userId]);
  useEffect(() => { void loadStanding(); void loadTier(); }, [loadStanding, loadTier]);

  const rate = async (view: RecoveryView, value: number): Promise<void> => {
    if (busy) return;
    setBusy(view.row.returnId);
    setError(null);
    setNotice(null);
    try {
      await rateReturn({
        returnId: view.row.returnId,
        score: value,
        recovery: view.row,
        selfUserId: userId,
      });
      if (!alive.current) return;
      const outcome = "Thanks. Your rating was saved.";
      setNotice(outcome);
      announce(outcome);
      await load();
    } catch (err) {
      if (!alive.current) return;
      const sentence = isMissingServerFunction(err)
        ? "Rating recovered items is not available in this build yet." : refusalSentence(err);
      setError(sentence);
      announce(sentence);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const listUnavailable = listError !== null || trustUnavailable !== null;

  return (
    <SettingsPage
      title="Recovered items"
      backTo="/settings"
      description="The items that came back, and what happened next."
    >
      <SettingsGroup
        title="Your standing"
        description="Your standing and reputation are worked out from your activity. They are not a score you can raise directly."
      >
        {standingError ? (
          <>
            <p role="alert" data-testid="standing-error" className="fb-return-message" data-tone="error">
              {standingError}
            </p>
            <SettingsRow
              title="Retry standing"
              description="Ask the server for your standing again."
              icon={RefreshCw}
              onClick={() => void loadStanding()}
            />
          </>
        ) : standing ? (
          <SettingsRow
            title="Standing"
            description={<span data-testid="returns-standing">{STANDING_SENTENCES[standing]}</span>}
            icon={ShieldCheck}
            iconTone={standing === "GOOD" ? "success" : "warning"}
          />
        ) : (
          <SettingsRow title="Checking your standing…" icon={ShieldCheck} />
        )}

        {tierError ? (
          <>
            <p role="alert" data-testid="reputation-error" className="fb-return-message" data-tone="error">
              {tierError}
            </p>
            <SettingsRow
              title="Retry reputation"
              description="Ask the server for your reputation again."
              icon={RefreshCw}
              onClick={() => void loadTier()}
            />
          </>
        ) : tier ? (
          <SettingsRow
            title="Reputation"
            description={<span data-testid="returns-tier">{REPUTATION_TIER_SENTENCES[tier]}</span>}
            icon={Star}
            iconTone="brand"
          />
        ) : (
          <SettingsRow title="Checking your reputation…" icon={Star} />
        )}
      </SettingsGroup>

      <SettingsGroup title="Recovered items">
        {notice ? (
          <p role="status" data-testid="returns-notice" className="fb-return-message">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="returns-error" className="fb-return-message" data-tone="error">
            {error}
          </p>
        ) : null}

        {trustUnavailable ? (
          <SettingsRow
            title="Not available yet"
            description={<span data-testid="returns-unavailable">{trustUnavailable}</span>}
            icon={CloudOff}
          />
        ) : null}
        {listError ? (
          <SettingsRow
            title="Your recovered items couldn't be read"
            description={<span data-testid="returns-list-error">{listError}</span>}
            icon={CloudOff}
          />
        ) : null}
        {listUnavailable ? (
          <SettingsRow
            title="Retry recovered items"
            description="Ask the server again."
            icon={RefreshCw}
            onClick={() => void load()}
          />
        ) : null}

        {!listUnavailable && views === null ? (
          <SettingsRow title="Checking your recovered items…" icon={Archive} />
        ) : null}
        {!listUnavailable && views !== null && views.length === 0 ? (
          <SettingsRow
            title="Nothing has been recovered yet."
            description="When an item you reported or helped return is recovered, it appears here."
            icon={PackageCheck}
          />
        ) : null}

        {views?.map((view) => (
          <RecoveryEntry
            key={view.row.returnId}
            view={view}
            busy={busy !== null}
            onRate={(value) => void rate(view, value)}
          />
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}

/**
 * One recovery as a row: what came back, which side the reader was on, and the
 * rating state. Five target-width rating buttons sit below the row copy, not
 * in the value slot, so neither the title nor the targets are squeezed.
 */
function RecoveryEntry({
  view,
  busy,
  onRate,
}: {
  view: RecoveryView;
  busy: boolean;
  onRate: (value: number) => void;
}) {
  const { row } = view;
  const counterpart = view.counterpartName
    ?? (row.externalHelper ? "someone outside Norfold" : "another member");
  const canRate = canRateReturn(row);
  const side = view.readerIsOwner === true
    ? "Your item came back"
    : view.readerIsOwner === false
      ? "You helped an item come back"
      : "You took part in a recovery";
  return (
    <div className="fb-return-row" data-testid="returns-row">
      <div className="fb-return-head">
        <SettingIconTile icon={Archive} tone={view.readerIsOwner === true ? "success" : "brand"} />
        <span className="fb-settings-row-copy">
          <span className="fb-settings-row-title">
            {view.title ?? "A report you took part in recovering"}
          </span>
          <span className="fb-settings-row-description">
            {side} · recovered {formatSafetyDate(row.recoveredAt)} · with {counterpart}
          </span>
        </span>
        {row.myRating !== null ? (
          <StatusPill tone="success">You rated {row.myRating} of 5</StatusPill>
        ) : canRate ? null : (
          <StatusPill tone="neutral">Nothing to rate</StatusPill>
        )}
      </div>

      {row.counterpartRating !== null ? (
        <p className="fb-return-note">They rated you {row.counterpartRating} of 5.</p>
      ) : null}

      {canRate && row.myRating === null ? (
        <div className="fb-return-rate">
          <p className="fb-return-rate-label">How was the return?</p>
          <RatingButtons name={view.counterpartName ?? "this member"} busy={busy} onRate={onRate} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The five-point rating control.
 *
 * Five real buttons, each with its own accessible name ("Rate Sam 4 out of
 * 5"), so a screen reader is not told "button 3", and each at least 44dp.
 * The stars are decoration; the number is the label.
 */
function RatingButtons({
  name,
  busy,
  onRate,
}: {
  name: string;
  busy: boolean;
  onRate: (value: number) => void;
}) {
  return (
    <span className="fb-return-rate-buttons" role="group" aria-label={`Rate ${name}`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          disabled={busy}
          onClick={() => onRate(value)}
          aria-label={`Rate ${name} ${value} out of 5`}
          data-testid={`rate-${value}`}
          className="fb-return-rate-button"
        >
          {value}
        </button>
      ))}
    </span>
  );
}
