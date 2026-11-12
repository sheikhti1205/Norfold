import { useEffect, useState } from "react";
import { POST_STATUS_LABELS, type PostItem } from "@norfold/shared";
import { AppBar } from "../components/AppBar";
import { useAuth } from "../auth";
import { fetchMyPosts } from "../services/posts";
import { listMyRecoveries, type MyRecovery } from "../services/trust";

type Result<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; value: T };

export function Insights() {
  const { user } = useAuth();
  return user ? <InsightsForAccount key={user.id} /> : null;
}

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

  const uniqueReturns = recoveries.kind === "ready" ? [...new Map(recoveries.value.map((row) => [row.returnId, row])).values()] : [];
  const ratings = uniqueReturns.map((row) => row.counterpartRating).filter((rating): rating is number => rating !== null);

  return <div className="h-full overflow-y-auto">
    <AppBar title="Insights" backTo="/" />
    <div className="space-y-6 px-4 py-5">
      <section aria-labelledby="insights-reports">
        <h2 id="insights-reports" className="text-lg font-semibold">Your reports</h2>
        {reports.kind === "loading" && <p role="status">Loading your reports...</p>}
        {reports.kind === "error" && <p role="alert">Your reports could not be loaded. Please try again later.</p>}
        {reports.kind === "ready" && (!reports.value.complete ? <p>Report totals are unavailable because the full list could not be loaded.</p> : reports.value.items.length === 0 ? <p>No insights yet</p> :
          <ul>{(["LOST", "FOUND"] as const).flatMap((type) => Object.entries(POST_STATUS_LABELS).map(([status, label]) => {
            const count = reports.value.items.filter((post) => post.type === type && post.status === status).length;
            return count > 0 ? <li key={`${type}-${status}`}>{type === "LOST" ? "Lost" : "Found"}, {label}: {count}</li> : null;
          }))}</ul>)}
      </section>
      <section aria-labelledby="insights-returns"><h2 id="insights-returns" className="text-lg font-semibold">Completed returns</h2><p>Unavailable because confirmation details are not available.</p></section>
      <section aria-labelledby="insights-ratings">
        <h2 id="insights-ratings" className="text-lg font-semibold">Ratings received</h2>
        {recoveries.kind === "loading" && <p role="status">Loading your ratings...</p>}
        {recoveries.kind === "error" && <p role="alert">Your ratings could not be loaded. Please try again later.</p>}
        {recoveries.kind === "ready" && <p>{ratings.length} ratings{ratings.length > 0 && `, ${ (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) } average`}</p>}
      </section>
    </div>
  </div>;
}
