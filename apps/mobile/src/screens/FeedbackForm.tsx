import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "../components/Button";
import { TextAreaField } from "../components/Fields";
import { announce } from "../components/LiveRegion";
import { PreferenceRadioRow, PreferenceSwitchRow, SettingsGroup, SettingsPage, StatusPill } from "../components/settings";
import { widthBand } from "../components/responsive";
import { APP_VERSION } from "../services/appCapabilities";
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_STATUS_LABELS,
  fetchAppRatingContext,
  listMyFeedback,
  rateApp,
  submitFeedback,
  type FeedbackCategory,
  type MyFeedback,
  type AppRatingContext,
} from "../services/feedback";
import { friendlyError } from "../utils/friendlyErrors";
import { UNAVAILABLE_SENTENCES, formatSafetyDate } from "../utils/safetyCopy";
import { isMissingServerFunction } from "../utils/safetyService";
import { useAuth } from "../auth";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";

/**
 * The one feedback form.
 *
 * The four kinds are the server's four kinds (MC D30) — a closed vocabulary,
 * not a free-text category — and the note is the only free text a reader
 * sends.
 *
 * THE TECHNICAL CONTEXT IS FOUR NAMED SCALARS, NEVER A BLOB. The server's
 * function has no `jsonb` parameter at all, so a client physically cannot
 * upload a log, a token, a prompt history or a photo (MC D31). This form
 * offers one explicit switch: when it is off, NO technical value is sent at
 * all; when it is on, the four scalars below and nothing else travel. The
 * copy says exactly that, because "include technical details" without saying
 * which details is a promise nobody can keep.
 *
 * THE READER SEES THEIR OWN STATUS, AND NOTHING ELSE. The server grants
 * `id, category, status, created_at, updated_at` and deliberately withholds
 * the message, the technical context and the moderator's note (MC D32). This
 * screen shows the four it was given: the kind, the state and the date.
 */
export function FeedbackForm() {
  const { user } = useAuth();
  return user ? <ScopedFeedbackForm key={user.id} /> : null;
}

function ScopedFeedbackForm() {
  const alive = useSafetyLifetime();
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [message, setMessage] = useState("");
  const [includeTechnical, setIncludeTechnical] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState<MyFeedback[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rating, setRating] = useState<AppRatingContext | null>(null);
  const [ratingError, setRatingError] = useState<"load" | "save" | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const ratingSaving = useRef(false);
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const [ratingNotice, setRatingNotice] = useState<string | null>(null);

  const loadRating = useCallback(async () => {
    setRatingError(null);
    try {
      const result = await fetchAppRatingContext();
      if (alive.current) setRating(result);
    } catch {
      if (alive.current) setRatingError("load");
    }
  }, [alive]);

  const saveRating = async (score: number) => {
    if (ratingSaving.current) return;
    ratingSaving.current = true;
    setRatingBusy(true);
    setPendingScore(score);
    setRatingError(null);
    setRatingNotice(null);
    try {
      const result = await rateApp(score);
      if (!alive.current) return;
      setRating(result);
      setPendingScore((current) => current === score ? null : current);
      setRatingNotice("Rating saved. Thank you.");
      announce("Rating saved. Thank you.");
    } catch {
      if (alive.current) setRatingError("save");
    } finally {
      ratingSaving.current = false;
      if (alive.current) setRatingBusy(false);
    }
  };

  const loadMine = useCallback(async () => {
    setHistoryError(null);
    setMine(null);
    try {
      const rows = await listMyFeedback();
      if (alive.current) setMine(rows);
    } catch (err) {
      if (alive.current) setHistoryError(isMissingServerFunction(err)
        ? "Your feedback history is not available in this build yet."
        : friendlyError(err).message);
    }
  }, [alive]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => { void loadRating(); }, [loadRating]);

  const scalars = useMemo(() => {
    if (!includeTechnical) {
      return { appVersion: null, platform: null, screen: null, deviceClass: null };
    }
    const band = widthBand(typeof window === "undefined" ? 599 : window.innerWidth);
    const deviceClass = band === "compact" ? "phone" : band === "medium" ? "large screen" : "wide screen";
    return {
      appVersion: APP_VERSION,
      platform: Capacitor.getPlatform(),
      // This form is the feedback screen. Never collect an arbitrary fragment,
      // query, dynamic account/report ID or auth callback as technical context.
      screen: "feedback",
      deviceClass,
    };
  }, [includeTechnical]);

  const send = async (): Promise<void> => {
    if (sending) return;
    if (category === "") {
      setError("Choose what kind of feedback this is.");
      announce("Choose what kind of feedback this is.");
      return;
    }
    if (message.trim() === "") {
      setError("Write something before sending feedback.");
      announce("Write something before sending feedback.");
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await submitFeedback({
        category,
        message,
        includeTechnicalInfo: includeTechnical,
        appVersion: scalars.appVersion,
        platform: scalars.platform,
        screen: scalars.screen,
        deviceClass: scalars.deviceClass,
      });
      if (!alive.current) return;
      const outcome = "Thanks — your feedback was sent.";
      setNotice(outcome);
      announce(outcome);
      setMessage("");
      setCategory("");
      setIncludeTechnical(false);
      await loadMine();
    } catch (err) {
      if (!alive.current) return;
      const sentence = isMissingServerFunction(err)
        ? UNAVAILABLE_SENTENCES.feedback
        : friendlyError(err).message;
      setError(sentence);
      announce(sentence);
    } finally {
      if (alive.current) setSending(false);
    }
  };

  return (
    <SettingsPage
      title="Send feedback"
      backTo="/settings"
      description="Tell us what is working and what is not."
    >
      <SettingsGroup title="Rate your experience with Norfold">
        <div className="px-3 py-2">
          {rating ? <>
            <fieldset aria-busy={ratingBusy} className="flex flex-wrap gap-1">
              <legend className="sr-only">Rate your experience with Norfold</legend>
              {[1, 2, 3, 4, 5].map((score) => (
                <label key={score} className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-1 text-sm text-on-surface">
                  <input type="radio" name="app-rating" value={score} aria-label={`${score} out of 5`}
                    checked={(pendingScore ?? rating.myScore) === score} onChange={() => setPendingScore(score)}
                    onClick={() => void saveRating(score)} className="accent-primary" />
                  <span>{score}</span>
                </label>
              ))}
            </fieldset>
            {pendingScore !== null && <p className="text-sm text-on-surface-variant">Rating not saved yet.</p>}
            <p className="text-sm text-on-surface-variant">
              {rating.count === 0 ? "No ratings yet." : `${rating.average!.toFixed(1)} out of 5 from ${rating.count} ${rating.count === 1 ? "rating" : "ratings"}.`}
            </p>
          </> : !ratingError ? <p role="status" className="text-sm text-on-surface-variant">Loading ratings…</p> : null}
          {ratingNotice && <p className="text-sm text-on-surface-variant">{ratingNotice}</p>}
          {ratingError && <div role="alert" className="text-sm text-error">
            <p>{ratingError === "load" ? "Could not load ratings." : "Could not save your rating."}</p>
            <button type="button" className="min-h-[44px] underline" onClick={() => {
              if (ratingError === "load") void loadRating();
              else if (pendingScore !== null) void saveRating(pendingScore);
            }}>Retry rating</button>
          </div>}
        </div>
      </SettingsGroup>
      <SettingsGroup title="What kind of feedback is this?">
        <fieldset className="fb-choice-fieldset flex flex-col">
          <legend className="sr-only">What kind of feedback is this?</legend>
          <div className="fb-choice-list flex flex-col">
            {FEEDBACK_CATEGORIES.map((value) => (
              <PreferenceRadioRow
                key={value}
                name="feedback-category"
                value={value}
                title={FEEDBACK_CATEGORY_LABELS[value]}
                checked={category === value}
                onChange={() => {
                  setCategory(value);
                  setError(null);
                }}
              />
            ))}
          </div>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup title="Your message">
        <TextAreaField
          label="Tell us what happened"
          hint={`Up to ${FEEDBACK_MESSAGE_MAX} characters. ${message.length} used.`}
          value={message}
          maxLength={FEEDBACK_MESSAGE_MAX}
          onChange={(event) => {
            setMessage(event.target.value);
            setError(null);
          }}
        />
        <div className="px-3 py-2">
          <Button onClick={() => void send()} loading={sending}>
            Send feedback
          </Button>
        </div>
        {notice ? (
          <p role="status" data-testid="feedback-notice" className="px-3 py-2 text-sm text-on-surface-variant">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="feedback-error" className="px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Technical details"
        description="Optional. It helps us find the problem faster."
      >
        <PreferenceSwitchRow
          title="Include technical details"
          description="Adds your app version, your device type, your platform and the screen you were on. It never adds your message, your photos, your location or your account details."
          checked={includeTechnical}
          onChange={(value) => setIncludeTechnical(value)}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Feedback you sent"
        description="Track the status of your own feedback here. Our team can review what you send."
      >
        {historyError && <div role="alert" data-testid="feedback-history-error">
          <p>{historyError}</p>
          <button type="button" className="min-h-[44px] px-3" onClick={() => void loadMine()}>Retry feedback history</button>
        </div>}
        {!historyError && mine === null ? (
          <p role="status" className="fb-settings-row-description">
            Loading your feedback…
          </p>
        ) : null}
        {mine !== null && mine.length === 0 ? (
          <p className="fb-settings-row-description">You haven’t sent any feedback yet.</p>
        ) : null}
        {mine?.map((row) => (
          <div
            key={row.id}
            className="fb-settings-row"
            data-testid="feedback-history-row"
            aria-label={`${FEEDBACK_CATEGORY_LABELS[row.category]} — ${FEEDBACK_STATUS_LABELS[row.status]}`}
          >
            <span className="fb-settings-row-copy">
              <span className="fb-settings-row-title">{FEEDBACK_CATEGORY_LABELS[row.category]}</span>
              <span className="fb-settings-row-description">Sent {formatSafetyDate(row.createdAt)}</span>
            </span>
            <span className="fb-settings-row-value">
              <StatusPill tone={row.status === "RESOLVED" ? "success" : "neutral"}>
                {FEEDBACK_STATUS_LABELS[row.status]}
              </StatusPill>
            </span>
          </div>
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}
