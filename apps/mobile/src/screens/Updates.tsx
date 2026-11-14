import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Capacitor } from "@capacitor/core";
import { ChevronDown, CloudOff, Download, Globe, RefreshCw, Smartphone } from "lucide-react";
import { UpdateChanges } from "../components/UpdateChanges";
import { UpdateJob } from "../components/UpdateJob";
import { nativeUpdates, useNativeUpdateState } from "../services/updates/nativeRuntime";
import { announce } from "../components/LiveRegion";
import {
  PreferenceSwitchRow,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusPill,
} from "../components/settings";
import { APP_VERSION } from "../services/appCapabilities";
import type { UpdateCheckFailure, UpdateSnapshot } from "../services/updates/controller";
import type { AndroidRelease, ReleaseHistoryRecord } from "../services/updates/types";
import {
  checkForUpdates,
  markUpdateRead,
  refreshInstalledUpdates,
  setUpdatePopupEnabled,
  useUpdateSnapshot,
} from "../services/updates/runtime";
import { formatTimestamp } from "../utils/dates";
import { readBuildInfo } from "../services/buildInfo";
import { useAuth } from "../auth";
import { fetchMyRole } from "../services/roles";
import { destinationFor, resolveDestination, type DestinationContext } from "../services/destinations";
import { releaseNoteFor, type ReleaseNote } from "../services/updates/releaseNotes";
import "./Updates.css";

/** One human sentence per failure cause; never a raw transport or provider string. */
export function checkFailureCopy(code: UpdateCheckFailure): string {
  switch (code) {
    case "offline":
      return "No connection. Everything below is the last information saved on this device.";
    case "http":
      return "The update service answered with an error. Try again in a while.";
    case "invalid":
      return "The update information could not be read, so it was ignored.";
    case "untrusted":
      return "The update information did not come from the trusted source, so it was ignored.";
    case "timeout":
      return "The check took too long to answer.";
    case "backoff":
      return "Waiting a little before checking again.";
  }
}

function checkedAt(ms: number | null): string {
  if (ms === null) return "not yet";
  return formatTimestamp(new Date(ms).toISOString());
}

function checkStatusCopy(
  snapshot: UpdateSnapshot,
  native: boolean,
): { label: string; tone: "neutral" | "success" | "warning" | "error" } {
  const check = snapshot.lastCheck;
  if (check === null) return { label: "Not checked yet", tone: "neutral" };
  if (check.status === "error") return { label: "Couldn't check", tone: "warning" };
  if (!native) return { label: "History updated", tone: "neutral" };
  if (snapshot.installed === null) return { label: "Version unavailable", tone: "warning" };
  if (snapshot.eligible !== null) return { label: "Update available", tone: "warning" };
  return { label: "No compatible update", tone: "neutral" };
}

function historyState(
  release: AndroidRelease | ReleaseHistoryRecord,
  snapshot: UpdateSnapshot,
): string | null {
  if ("downloadStatus" in release) {
    return release.downloadStatus === "none" ? "No files published" : "Archived beta";
  }
  if (snapshot.installed !== null && release.versionCode === snapshot.installed.versionCode) {
    return "Installed";
  }
  if (release.id === snapshot.eligible?.id) return "Available";
  if (release.artifacts.length === 0) return "No files published";
  if (!release.accepted) return "Not accepted";
  return null;
}

/**
 * The capabilities a written note names, linked only when the canonical
 * destination resolves for this reader. An unresolved id stays as text, never
 * as a dead control.
 */
function FeatureList({ note, context }: { note: ReleaseNote; context: DestinationContext }) {
  return (
    <ul className="fb-update-list">
      {note.features.map((feature) => {
        const destination = feature.destinationId ? destinationFor(feature.destinationId) : null;
        const resolution = feature.destinationId
          ? resolveDestination(feature.destinationId, context)
          : null;
        return (
          <li key={feature.summary}>
            {feature.summary}
            {destination !== null && resolution?.kind === "available" ? (
              <Link className="fb-update-feature-link" to={resolution.route}>
                {destination.title}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ChangeList({ changes }: { changes: readonly string[] }) {
  return (
    <ul className="fb-update-list">
      {changes.map((change) => <li key={change}>{change}</li>)}
    </ul>
  );
}

/** The written story for one version: about, what changed, new features. */
function ReleaseNoteBody({
  note,
  context,
}: {
  note: ReleaseNote;
  context: DestinationContext;
}) {
  return (
    <>
      <p className="fb-update-about">{note.about}</p>
      {note.changes.length > 0 ? (
        <>
          <h3 className="fb-update-subheading">What changed</h3>
          <ChangeList changes={note.changes} />
        </>
      ) : null}
      {note.features.length > 0 ? (
        <>
          <h3 className="fb-update-subheading">New features</h3>
          <FeatureList note={note} context={context} />
        </>
      ) : null}
    </>
  );
}

export function Updates() {
  const { user } = useAuth();
  const [role, setRole] = useState<{ userId: string; capabilities: readonly string[] } | null>(null);
  const snapshot = useUpdateSnapshot();
  const native = Capacitor.isNativePlatform();
  const job = useNativeUpdateState();
  const check = snapshot.lastCheck;
  const status = checkStatusCopy(snapshot, native);
  const [buildGitSha, setBuildGitSha] = useState("");

  useEffect(() => {
    let live = true;
    setRole(null);
    if (user?.id) void fetchMyRole().then((value) => {
      if (live) setRole({ userId: user.id, capabilities: value.capabilities });
    }).catch(() => {});
    return () => { live = false; };
  }, [user?.id]);

  useEffect(() => {
    let live = true;
    void readBuildInfo().then((info) => { if (live) setBuildGitSha(info.buildGitSha ?? ""); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    // Read the installed identity, then one bounded check. Both are cheap and
    // cached; a failure is reported, never hidden.
    void refreshInstalledUpdates().then(() => checkForUpdates());
  }, []);

  // Opening this screen IS seeing the release. Mark it seen so the optional
  // popup cannot ask about a version the reader has just read about.
  useEffect(() => {
    for (const release of snapshot.history) markUpdateRead(release.id);
  }, [snapshot.history]);

  const checking = snapshot.checking;
  const jobActive = ["downloading", "verifying", "ready", "installing", "needs-permission", "needs-confirmation"].includes(job.kind);

  const context: DestinationContext = {
    platform: native ? "android" : "web",
    signedIn: !!user,
    capabilities: role && role.userId === user?.id ? role.capabilities : [],
  };
  const catalogueContext = {
    ...context,
    buildGitSha,
    capabilitiesKnown: role !== null && role.userId === user?.id,
    satisfiedPrerequisites: [],
  };

  const installedLine = snapshot.installed !== null
    ? `Android build ${snapshot.installed.versionCode} · ${APP_VERSION}`
    : native
      ? "This build can't confirm its own version"
      : `Web build · ${APP_VERSION}`;

  const checkLine = check === null
    ? "Norfold checks for a newer version when you open this screen."
    : check.status === "error"
      ? checkFailureCopy(check.code ?? "offline")
      : `Checked ${checkedAt(check.checkedAt)}.`;

  // The story leads with what the reader can install. Without an installable
  // update it describes the build they are running, which is the honest answer
  // on the web where there is nothing to install.
  const eligible = snapshot.eligible;
  const featuredVersion = eligible?.versionName ?? APP_VERSION;
  const featuredRelease = eligible
    ?? snapshot.history.find((release) => release.versionName === APP_VERSION)
    ?? null;
  const featuredNote = releaseNoteFor(featuredVersion);
  const featuredState = eligible !== null
    ? "Available to install"
    : featuredVersion === APP_VERSION ? "This build" : "Published";
  const featuredFeatures = (snapshot.features ?? [])
    .filter((feature) => feature.releaseId === featuredRelease?.id);

  const history = snapshot.history;

  return (
    <div data-testid="updates-screen">
      <SettingsPage
        title="Updates & version history"
        description="What this build is, and what is newer."
        backTo="/settings"
      >
        <SettingsGroup title="This build">
          <SettingsRow
            title={`Norfold ${APP_VERSION}`}
            description={<span data-testid="updates-installed">{installedLine}</span>}
            icon={native ? Smartphone : Globe}
            value={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
          />
          <SettingsRow
            title={checking ? "Checking…" : "Check now"}
            description={checkLine}
            icon={RefreshCw}
            disabled={checking}
            onClick={() => void checkForUpdates().then((next) => {
              announce(
                next.lastCheck?.status === "error"
                  ? "Couldn't check for updates."
                  : next.eligible !== null
                    ? "A newer version is available."
                    : !native ? "Version history updated."
                      : next.installed === null ? "This build can't confirm its own version."
                        : "No compatible update is available.",
              );
            })}
          />
          {eligible !== null ? (
            native && !jobActive ? (
              <SettingsRow
                title={`Download ${eligible.versionName}`}
                description={releaseNoteFor(eligible.versionName)?.about
                  ?? "A newer Android build is ready to install."}
                icon={Download}
                value="Download"
                onClick={() => void nativeUpdates.download(eligible, snapshot.installed)}
              />
            ) : (
              <SettingsRow
                title={`${eligible.versionName} is available`}
                description={releaseNoteFor(eligible.versionName)?.about
                  ?? "A newer Android build is ready to install."}
                icon={Download}
              />
            )
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="What this update is about">
          <div className="fb-update-featured" data-testid="updates-featured">
            <div className="fb-update-featured-head">
              <span className="fb-update-featured-version">{featuredVersion}</span>
              <StatusPill tone={featuredState === "Available to install" ? "warning" : "neutral"}>
                {featuredState}
              </StatusPill>
            </div>
            {featuredNote !== null ? (
              <ReleaseNoteBody note={featuredNote} context={context} />
            ) : (
              <p className="fb-update-note">
                Written notes for this version are not in this build yet. The version number and
                release date below are the facts this build can prove.
              </p>
            )}
            {featuredFeatures.length > 0 ? (
              <>
                <h3 className="fb-update-subheading">Announced features</h3>
                <UpdateChanges features={featuredFeatures} context={catalogueContext} />
              </>
            ) : null}
            {featuredRelease !== null ? (
              <p className="fb-update-note">
                Published {formatTimestamp(featuredRelease.publishedAt)}.
              </p>
            ) : null}
          </div>
        </SettingsGroup>

        {native && job.kind !== "idle" ? (
          <SettingsGroup title="Update progress">
            <UpdateJob
              state={job}
              onInstall={() => void nativeUpdates.install()}
              onCancel={() => void nativeUpdates.cancel()}
              onPermission={() => void nativeUpdates.openPermission()}
            />
          </SettingsGroup>
        ) : null}

        <SettingsGroup
          title="Update notices"
          description="Off by default: versions and changes stay here in Settings. Turn this on for a quiet card when a newer version is ready, only once per version, and never over something you're doing."
        >
          <PreferenceSwitchRow
            title="Show update notices"
            description="A single dismissible notice when a new version is ready."
            checked={snapshot.popupEnabled}
            onChange={(next) => {
              setUpdatePopupEnabled(next);
              announce(next ? "Update notices on." : "Update notices off.");
            }}
          />
        </SettingsGroup>

        <SettingsGroup
          title="Version history"
          description={native
            ? "Every release this device knows about, newest first. Open one to read what changed."
            : "Web updates are deployed automatically; there is nothing to install here. Open a version to read what changed."}
        >
          {history.length === 0 ? (
            <SettingsRow
              title="No version history yet"
              description={<span data-testid="updates-history-empty">Norfold lists each release here after it checks for updates.</span>}
              icon={CloudOff}
            />
          ) : (
            <ul className="fb-update-history" data-testid="updates-history">
              {history.map((release) => {
                const note = releaseNoteFor(release.versionName);
                const state = historyState(release, snapshot);
                const isFeatured = release.versionName === featuredVersion;
                const features = (snapshot.features ?? [])
                  .filter((feature) => feature.releaseId === release.id);
                return (
                  <li key={release.id} data-testid="updates-history-item">
                    <details className="fb-update-version">
                      <summary>
                        <span className="fb-update-version-copy">
                          <span className="fb-update-version-name">{release.versionName}</span>
                          <span className="fb-update-version-about">
                            {note?.about ?? "No written notes for this version in this build."}
                          </span>
                        </span>
                        {state !== null ? <StatusPill tone="neutral">{state}</StatusPill> : null}
                        <ChevronDown size={18} aria-hidden="true" className="fb-update-chevron" />
                      </summary>
                      <div className="fb-update-version-body">
                        {note !== null ? <ReleaseNoteBody note={note} context={context} /> : null}
                        {!isFeatured && features.length > 0 ? (
                          <>
                            <h3 className="fb-update-subheading">Announced features</h3>
                            <UpdateChanges features={features} context={catalogueContext} />
                          </>
                        ) : null}
                        <p className="fb-update-note">
                          {formatTimestamp(release.publishedAt)}
                          {!("artifacts" in release) || release.artifacts.length === 0
                            ? " · Announcement"
                            : ""}
                        </p>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsGroup>
      </SettingsPage>
    </div>
  );
}
