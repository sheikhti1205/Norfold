import { useEffect, useState } from "react";
import { POST_STATUSES, POST_STATUS_LABELS, type PostItem, type PostStatus } from "@norfold/shared";
import { AppBar } from "../components/AppBar";
import { useAuth } from "../auth";
import { fetchMyPosts } from "../services/posts";
import { listMyRecoveries, type MyRecovery } from "../services/trust";
import "./Insights.css";

type Result<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; value: T };

const MONTHS_SHOWN = 6;
const STAR_VALUES = [5, 4, 3, 2, 1] as const;

/** Unique returns: the same return can appear once per rated side. */
function uniqueReturns(rows: MyRecovery[]): MyRecovery[] {
  return [...new Map(rows.map((row) => [row.returnId, row])).values()];
}

function ratingsOf(returns: MyRecovery[]): number[] {
  return returns
    .map((row) => row.counterpartRating)
    .filter((rating): rating is number => rating !== null && Number.isFinite(rating) && rating >= 1 && rating <= 5);
}

/**
 * Reports per calendar month for the last six months, including the current
 * one. Real `createdAt` values only: an unparseable date is skipped rather than
 * bucketed into "now", and a month with no reports stays visible at zero.
 */
export function reportsByMonth(items: readonly PostItem[], now: Date) {
  const buckets = Array.from({ length: MONTHS_SHOWN }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1 - index), 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
      count: 0,
    };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const item of items) {
    const date = new Date(item.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function statusCountsOf(items: PostItem[]): Record<PostStatus, number> {
  const counts = Object.fromEntries(POST_STATUSES.map((status) => [status, 0])) as Record<PostStatus, number>;
  for (const item of items) counts[item.status] += 1;
  return counts;
}

function share(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

export function Insights() {
  const { user } = useAuth();
  return user ? <InsightsForAccount key={user.id} /> : null;
}

/**
 * Account insights, drawn from the two real lists this account already owns:
 * its reports (`fetchMyPosts`) and its confirmed returns (`listMyRecoveries`).
 *
 * Nothing here is derived from a guess: totals exist only when the report page
 * is complete, a rating average exists only when at least one counterpart
 * rating does, and each chart states its own loading/error/empty case instead
 * of painting zeros over unknown data.
 */
function InsightsForAccount() {
  const [reports, setReports] = useState<Result<{ items: PostItem[]; complete: boolean }>>({ kind: "loading" });
  const [recoveries, setRecoveries] = useState<Result<MyRecovery[]>>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void fetchMyPosts().then((page) => {
      if (active) setReports({ kind: "ready", value: { items: page.items, complete: !page.nextCursor } });
    }).catch(() => { if (active) setReports({ kind: "error" }); });
    void listMyRecoveries().then((rows) => {
      if (active) setRecoveries({ kind: "ready", value: rows });
    }).catch(() => { if (active) setRecoveries({ kind: "error" }); });
    return () => { active = false; };
  }, []);

  const completeReports = reports.kind === "ready" && reports.value.complete ? reports.value.items : null;
  const reportsTotal = completeReports?.length ?? null;
  const returns = recoveries.kind === "ready" ? uniqueReturns(recoveries.value) : null;
  const ratings = returns ? ratingsOf(returns) : [];
  const averageRating = ratings.length > 0
    ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    : null;

  const months = completeReports ? reportsByMonth(completeReports, new Date()) : [];
  const monthMax = Math.max(1, ...months.map((month) => month.count));
  const lost = completeReports ? completeReports.filter((item) => item.type === "LOST").length : 0;
  const found = completeReports ? completeReports.filter((item) => item.type === "FOUND").length : 0;
  const statusCounts = completeReports ? statusCountsOf(completeReports) : null;
  const resolved = statusCounts ? statusCounts.RECOVERED + statusCounts.CLOSED : 0;
  const ratingCounts = STAR_VALUES.map((star) => ({
    star,
    count: ratings.filter((rating) => Math.round(rating) === star).length,
  }));
  const ratingMax = Math.max(1, ...ratingCounts.map((entry) => entry.count));

  return <div className="fb-insights">
    <AppBar title="Insights" backTo="/" />
    <div className="fb-insights-body">
      <dl className="fb-insights-stats" aria-label="At a glance">
        <div>
          <dt>Reports</dt>
          <dd>{reportsTotal ?? "—"}</dd>
        </div>
        <div>
          <dt>Returns</dt>
          <dd>{returns ? returns.length : "—"}</dd>
        </div>
        <div>
          <dt>Rating</dt>
          <dd>{averageRating === null ? "—" : averageRating.toFixed(1)}</dd>
        </div>
      </dl>

      <section aria-labelledby="insights-reports">
        <h2 id="insights-reports">Your reports</h2>
        {reports.kind === "loading" && <p role="status" className="fb-insights-note">Loading your reports...</p>}
        {reports.kind === "error" && <p role="alert" className="fb-insights-note">Your reports could not be loaded. Please try again later.</p>}
        {reports.kind === "ready" && !reports.value.complete && (
          <p className="fb-insights-note">Report totals are unavailable because the full list could not be loaded.</p>
        )}
        {completeReports && reportsTotal === 0 && (
          <p className="fb-insights-empty">No reports yet.</p>
        )}
        {completeReports && reportsTotal !== null && reportsTotal > 0 && (
          <>
            <figure className="fb-insight-block">
              <figcaption>Reports over time</figcaption>
              <div className="fb-chart-columns">
                {months.map((month) => (
                  <div key={month.key} className="fb-chart-column">
                    <span className="fb-chart-count">{month.count}</span>
                    <span className="fb-chart-track" aria-hidden="true">
                      <span
                        className="fb-chart-bar"
                        style={{ height: month.count === 0 ? "0" : `${Math.max(4, (month.count / monthMax) * 100)}%` }}
                      />
                    </span>
                    <span className="fb-chart-month">{month.label}</span>
                  </div>
                ))}
              </div>
              <p className="fb-insight-caption">Last {MONTHS_SHOWN} months</p>
            </figure>

            <div className="fb-insight-pair">
              <figure className="fb-insight-block">
                <figcaption>Lost and found</figcaption>
                <div
                  className="fb-chart-split"
                  role="img"
                  aria-label={`${lost} lost and ${found} found of ${reportsTotal} reports`}
                >
                  {lost > 0 && <span className="fb-chart-split-lost" style={{ flexGrow: lost }} />}
                  {found > 0 && <span className="fb-chart-split-found" style={{ flexGrow: found }} />}
                </div>
                <ul className="fb-chart-legend">
                  <li><span className="fb-chart-dot fb-chart-dot-lost" aria-hidden="true" />Lost<strong>{lost}</strong></li>
                  <li><span className="fb-chart-dot fb-chart-dot-found" aria-hidden="true" />Found<strong>{found}</strong></li>
                </ul>
              </figure>

              <figure className="fb-insight-block">
                <figcaption>Status</figcaption>
                <ul className="fb-chart-bars">
                  {POST_STATUSES.map((status) => (
                    <li key={status}>
                      <span className="fb-chart-bar-label">{POST_STATUS_LABELS[status]}</span>
                      <span className="fb-chart-bar-track" aria-hidden="true">
                        <span className="fb-chart-bar-fill" style={{ width: `${share(statusCounts?.[status] ?? 0, reportsTotal)}%` }} />
                      </span>
                      <span className="fb-chart-bar-count">{statusCounts?.[status] ?? 0}</span>
                    </li>
                  ))}
                </ul>
                <p className="fb-insight-caption">Resolved {resolved} of {reportsTotal} ({share(resolved, reportsTotal)}%)</p>
              </figure>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="insights-ratings">
        <h2 id="insights-ratings">Ratings received</h2>
        {recoveries.kind === "loading" && <p role="status" className="fb-insights-note">Loading your ratings...</p>}
        {recoveries.kind === "error" && <p role="alert" className="fb-insights-note">Your ratings could not be loaded. Please try again later.</p>}
        {recoveries.kind === "ready" && (
          <>
            <p className="fb-insights-ratingline">
              {ratings.length === 0
                ? "0 ratings"
                : `${ratings.length} ${ratings.length === 1 ? "rating" : "ratings"}, ${averageRating?.toFixed(1)} average`}
            </p>
            {ratings.length > 0 && (
              <figure className="fb-insight-block">
                <figcaption>How you were rated</figcaption>
                <ul className="fb-chart-bars fb-chart-ratings">
                  {ratingCounts.map(({ star, count }) => (
                    <li key={star}>
                      <span className="fb-chart-bar-label">{star} star{star === 1 ? "" : "s"}</span>
                      <span className="fb-chart-bar-track" aria-hidden="true">
                        <span className="fb-chart-bar-fill" style={{ width: `${share(count, ratingMax)}%` }} />
                      </span>
                      <span className="fb-chart-bar-count">{count}</span>
                    </li>
                  ))}
                </ul>
              </figure>
            )}
          </>
        )}
        {recoveries.kind === "ready" && returns && returns.length > 0 && (
          <p className="fb-insight-caption">
            {returns.length} confirmed {returns.length === 1 ? "return" : "returns"}.
          </p>
        )}
      </section>
    </div>
  </div>;
}
