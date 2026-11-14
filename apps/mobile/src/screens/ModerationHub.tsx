import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { Flag, MessageSquare, Scale, UserCog } from "lucide-react";
import { SettingsGroup, SettingsPage, SettingsRow } from "../components/settings";
import { fetchMyRole, type MyRole } from "../services/roles";
import "../components/AdminConsole.css";

export function ModerationHub() {
  const [role, setRole] = useState<MyRole | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError(false);
    setRole(null);
    void fetchMyRole().then(value => {
      if (alive) { setRole(value); setReady(true); }
    }).catch(() => {
      if (alive) { setError(true); setReady(true); }
    });
    return () => { alive = false; };
  }, [attempt]);

  const admin = role?.role === "ADMIN" || role?.isAdmin === true;
  const reports = admin || role?.capabilities.includes("reports_review");
  const appeals = admin || role?.capabilities.includes("appeals_review");
  const feedback = admin || role?.capabilities.includes("feedback_read");

  if (ready && !error && !admin && !reports && !appeals && !feedback) {
    return <Navigate to="/settings" replace />;
  }

  return <SettingsPage title="Staff console" backTo="/settings" description="Review work and manage who can do it.">
    <SettingsGroup>
      {!ready && <p role="status" className="fb-admin-note">Checking your permissions…</p>}
      {ready && error && <div role="alert" className="fb-admin-error">
        Couldn't check your permissions. <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
      </div>}
      {ready && !error && admin && <SettingsRow title="Team & permissions" description="Who can moderate, and what each of them may do." icon={UserCog} iconTone="privacy" route="/settings/team" />}
      {ready && !error && reports && <SettingsRow title="Review reports" description="Open reports, grouped by the person or item they are about." icon={Flag} iconTone="privacy" route="/settings/moderation/queue" />}
      {ready && !error && appeals && <SettingsRow title="Review appeals" description="Moderation decisions people asked us to look at again." icon={Scale} iconTone="privacy" route="/settings/moderation/appeals" />}
      {ready && !error && feedback && <SettingsRow title="Review feedback" description="What people told us about using Norfold." icon={MessageSquare} iconTone="help" route="/settings/moderation/feedback" />}
    </SettingsGroup>
  </SettingsPage>;
}
