import { useEffect, useState } from "react";
import { useUpdateSnapshot } from "../services/updates/runtime";
import { useLocation, useOutlet } from "react-router";
import { SplitView } from "../components/SplitView";
import {
  Accessibility,
  Activity,
  Bell,
  CircleHelp,
  Cpu,
  Info,
  LayoutGrid,
  LogOut,
  MessageSquare,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import { useAuth } from "../auth";
import { readRememberedAccounts } from "../services/rememberedAccounts";
import { readAccountSession } from "../services/accountSessions";
import { announce } from "../components/LiveRegion";
import {
  ACCENT_OPTIONS,
  TEXT_SCALE_OPTIONS,
  useAppearance,
  type AccentId,
  type ReduceMotionOverride,
  type TextScaleId,
} from "../appearance";
import { useTheme, type Theme } from "../theme";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSearch,
  PreferenceSwitchRow,
  type SettingIconTone,
} from "../components/settings";
import { Capacitor } from "@capacitor/core";
import { settingsDestinations, settingsSectionFor, type SettingsSection } from "../services/destinations";
import type { LucideIcon } from "lucide-react";
import { SettingsProfileHeader } from "./settings/SettingsProfileHeader";
import { SettingsNestedPages } from "./settings/SettingsNestedGroup";
import { useSettingsWindowHosted } from "../components/settingsWindowHost";
import { searchSettings } from "../services/settingsIndex";
import { useFeedLayoutPreference } from "../services/feedLayoutPreference";
import { resolveFeedLayout, useViewportWidth } from "../components/responsive";
import { feedLayoutSummary } from "./FeedLayoutSettings";
import { fetchNotificationPreferences, type NotificationPreferences } from "../services/notificationPreferences";
import { pushController } from "../services/pushRuntime";
import { fetchMyRole, type MyRole } from "../services/roles";
import { AdminBootstrapRow } from "../components/AdminBootstrapRow";
import type { PushPermissionState } from "../services/pushNotifications";
import { APP_VERSION } from "../services/appCapabilities";
import { friendlyError } from "../utils/friendlyErrors";
import "./Settings.css";

/**
 * Presentation for a Settings row. Titles here are the row labels (which differ
 * deliberately from the catalogue's discoverable titles); routes, summaries and
 * aliases come from the catalogue, so nothing about *where* a row goes is
 * written twice.
 */
export const ROW_PRESENTATION: Record<string, { title: string; icon: LucideIcon; iconTone: SettingIconTone; detail?: boolean }> = {
  "recovered-items": { title: "Recovered items", icon: RotateCcw, iconTone: "success", detail: true },
  devices: { title: "Devices", icon: MonitorSmartphone, iconTone: "teal", detail: true },
  "chat-preferences": { title: "Chat", icon: MessageSquare, iconTone: "neutral", detail: true },
  appearance: { title: "Personalization", icon: Palette, iconTone: "appearance" },
  notifications: { title: "Notification preferences", icon: Bell, iconTone: "notifications" },
  accessibility: { title: "Accessibility", icon: Accessibility, iconTone: "accessibility" },
  "feed-layout": { title: "Feed layout", icon: LayoutGrid, iconTone: "teal" },
  "local-intelligence": { title: "Local tools", icon: Cpu, iconTone: "ai", detail: true },
  ai: { title: "Optional AI Chat", icon: Sparkles, iconTone: "ai", detail: true },
  privacy: { title: "Privacy & safety", icon: ShieldCheck, iconTone: "privacy" },
  feedback: { title: "Send feedback", icon: MessageSquare, iconTone: "neutral", detail: true },
  diagnostics: { title: "Diagnostics", icon: Activity, iconTone: "privacy" },
  terms: { title: "Terms of use", icon: Scale, iconTone: "about" },
  "privacy-policy": { title: "Privacy policy", icon: ShieldCheck, iconTone: "privacy" },
  "community-guidelines": { title: "Community guidelines", icon: Users, iconTone: "help" },
  help: { title: "Help & guide", icon: CircleHelp, iconTone: "help" },
  replay: { title: "Replay introduction", icon: RotateCcw, iconTone: "help" },
  updates: { title: "Updates & version history", icon: RefreshCw, iconTone: "about", detail: true },
  about: { title: "About Norfold", icon: Info, iconTone: "about" },
};

const THEME_LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const MOTION_LABELS: Record<ReduceMotionOverride, string> = {
  system: "System",
  reduce: "Reduced",
  full: "Full",
};

/** Live theme + accent, e.g. `Dark · Emerald`. */
export function appearanceSummary(theme: Theme, accent: AccentId, source: "preset" | "system" = "preset"): string {
  const accentLabel = source === "system" ? "System colors" : ACCENT_OPTIONS.find((option) => option.id === accent)?.label ?? accent;
  return `${THEME_LABELS[theme]} · ${accentLabel}`;
}

/** Live text scale + motion override, e.g. `Default text · System motion`. */
export function accessibilitySummary(textScale: TextScaleId, reduceMotion: ReduceMotionOverride): string {
  const textLabel =
    TEXT_SCALE_OPTIONS.find((option) => option.id === textScale)?.label ?? textScale;
  return `${textLabel} text · ${MOTION_LABELS[reduceMotion]} motion`;
}

/** Live photo-quality flag. */
export function mediaSummary(highQualityPhoto: boolean): string {
  return highQualityPhoto ? "High quality" : "Standard";
}

/** Whether this device can return to the account without a password. */
export function keptOnDevice(accountId: string): boolean {
  try {
    return readAccountSession(accountId) !== null
      && readRememberedAccounts().some((account) => account.id === accountId);
  } catch {
    return false;
  }
}

/**
 * Stored prefs win; OS permission fills the gap; otherwise an honest
 * fallback — never a guessed value.
 */
export function notificationSummary(
  prefs: Pick<NotificationPreferences, "pushEnabled"> | null,
  permission: PushPermissionState | null,
): string {
  if (prefs) return prefs.pushEnabled ? "On" : "Off";
  switch (permission) {
    case "granted":
      return "On";
    case "denied":
      return "Off";
    case "prompt":
      return "Turn on";
    case "unsupported":
      return "Not supported";
    default:
      return "Review settings";
  }
}

/**
 * Settings root: profile header, search, grouped settings, sign-out.
 *
 * Account / Preferences / Intelligence / Privacy / More group the index.
 * Advanced, Legal and Help & about label their directly navigable rows.
 * Live summaries degrade to honest fallback text when a source is unreadable.
 */
export function Settings() {
  const { user } = useAuth();
  const detail = useOutlet();
  const { pathname } = useLocation();
  return <div className="fb-settings-layout"><SplitView selected={Boolean(detail)} scrollKey={pathname}
    list={<SettingsNavigation key={user?.id ?? "guest"} detailSelected={Boolean(detail)} />}
    detail={detail ?? <section className="fb-settings-placeholder"><h2>Your settings</h2><p>Choose a category to make it yours.</p></section>} />
  </div>;
}

function SettingsNavigation({ detailSelected }: { detailSelected: boolean }) {
  const updates = useUpdateSnapshot();
  const { user, logout, setAccountKept } = useAuth();
  const { theme } = useTheme();
  const { settings } = useAppearance();
  const { layout: feedLayout } = useFeedLayoutPreference();
  const viewportWidth = useViewportWidth();
  // The floating window owns settings search in its top bar; the standalone
  // page keeps the in-page field. Never both on one surface.
  const windowHosted = useSettingsWindowHosted();
  const [query, setQuery] = useState("");
  const [notifValue, setNotifValue] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [retention, setRetention] = useState<{ id: string; keep: boolean } | null>(() =>
    user ? { id: user.id, keep: keptOnDevice(user.id) } : null);
  const keepAccount = retention?.id === user?.id && retention?.keep === true;
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    // The switch reflects the durable choice: a kept account has both the
    // remembered identity and the retained session that makes switching back
    // passwordless.
    setRetention({ id: userId, keep: keptOnDevice(userId) });
  }, [userId]);
  // An unreadable server role leaves the staff console hidden.
  const [roleSnapshot, setRoleSnapshot] = useState<{ userId: string; role: MyRole } | null>(null);
  // Hide previous-account authority on the first render, before effects run.
  const staffRole = roleSnapshot?.userId === user?.id ? roleSnapshot?.role : null;
  const [roleRevision, setRoleRevision] = useState(0);

  useEffect(() => {
    // roles.ts emits this only after a server-confirmed explicit acceptance.
    const refresh = () => setRoleRevision(value => value + 1);
    window.addEventListener("findback:role-changed", refresh);
    return () => window.removeEventListener("findback:role-changed", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const userId = user?.id;
    if (!userId) return;
    void fetchMyRole()
      .then((role) => {
        if (!cancelled) setRoleSnapshot({ userId, role });
      })
      .catch(() => {
        if (!cancelled) setRoleSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, roleRevision]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await fetchNotificationPreferences();
        if (!cancelled) setNotifValue(notificationSummary(prefs, null));
        return;
      } catch {
        /* fall through to the OS permission probe */
      }
      try {
        const permission = await pushController().permission();
        if (!cancelled) setNotifValue(notificationSummary(null, permission));
      } catch {
        if (!cancelled) setNotifValue(notificationSummary(null, null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!user) return null;

  const trimmed = query.trim();
  const destinationContext = {
    platform: Capacitor.isNativePlatform() ? "android" as const : "web" as const,
    signedIn: true,
    capabilities: [],
  };
  const matches = trimmed ? searchSettings(trimmed, destinationContext) : null;
  const isStaff = staffRole?.role === "ADMIN" || staffRole?.isAdmin ||
    staffRole?.capabilities.some(capability => ["reports_review", "appeals_review", "feedback_read"].includes(capability));

  // Rows and the search index are generated from the same catalogue, filtered
  // for this caller, so no row can advertise a route the catalogue does not
  // know and no catalogue entry can go missing from the screen.
  const rows = settingsDestinations(destinationContext);
  const rowValue = (id: string): string | undefined => {
    switch (id) {
      case "appearance": return appearanceSummary(theme, settings.accent, settings.accentSource);
      case "notifications": return notifValue ?? "Review settings";
      case "accessibility": return accessibilitySummary(settings.textScale, settings.reduceMotion);
      case "feed-layout": return feedLayoutSummary(feedLayout, resolveFeedLayout(feedLayout, viewportWidth));
      case "about": return APP_VERSION;
      default: return undefined;
    }
  };
  const inSection = (section: SettingsSection) => rows
    .filter((destination) => settingsSectionFor(destination.id) === section)
    .map((destination) => {
      const presentation = ROW_PRESENTATION[destination.id];
      // A placed destination without a row presentation is a programming error:
      // silently dropping the row would hide a real screen from Settings.
      if (!presentation) throw new Error(`No Settings row presentation for ${destination.id}`);
      return <SettingsRow
        key={destination.id}
        title={presentation.title}
        description={destination.id === "updates"
          ? updates.checking ? "Checking for updates…"
            : updates.lastCheck?.status === "error" ? "Couldn't check. Saved version history is still available."
              : updates.eligible ? `${updates.eligible.versionName} is available.`
                : "Version history and update notices."
          : presentation.detail ? destination.summary : undefined}
        icon={presentation.icon}
        iconTone={presentation.iconTone}
        value={rowValue(destination.id)}
        route={destination.route}
      />;
    });

  const handleSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    void logout({ keepAccount })
      .catch((err: unknown) => {
        setSignOutError(friendlyError(err).message);
      })
      .finally(() => {
        setSigningOut(false);
      });
  };

  return (
    <SettingsPage title="Settings" className="fb-settings-root" headingLevel={detailSelected ? 2 : 1} autoFocus={!detailSelected}>
      <SettingsNestedPages>
      <SettingsProfileHeader user={user} />
      {!windowHosted && <SettingsSearch
        query={query}
        onQueryChange={setQuery}
        results={matches && matches.length > 0 ? matches : undefined}
      />}
      {matches ? (
        matches.length === 0 && (
          <div className="fb-settings-empty">
            <p role="status">No settings found</p>
            <p>Try theme, notifications, AI, privacy, or text size.</p>
          </div>
        )
      ) : (
        <>
          <AdminBootstrapRow />
          <SettingsGroup>{inSection("updates")}</SettingsGroup>
          {inSection("account").length > 0 && (
            <SettingsGroup title="Account">{inSection("account")}</SettingsGroup>
          )}
          {inSection("chat").length > 0 && (
            <SettingsGroup title="Chat">{inSection("chat")}</SettingsGroup>
          )}
          {inSection("preferences").length > 0 && (
            <SettingsGroup title="Preferences">{inSection("preferences")}</SettingsGroup>
          )}
          {inSection("intelligence").length > 0 && (
            <SettingsGroup title="Intelligence">{inSection("intelligence")}</SettingsGroup>
          )}
          {inSection("privacy").length > 0 && (
            <SettingsGroup title="Privacy">{inSection("privacy")}</SettingsGroup>
          )}
          {isStaff && (
            <SettingsGroup title="Staff">
              <SettingsRow
                title="Staff console"
                description="Reports, appeals, feedback and team permissions."
                icon={UserCog}
                iconTone="privacy"
                route="/settings/staff"
              />
            </SettingsGroup>
          )}
          <SettingsGroup title="More">
            {inSection("more")}
            <section className="fb-settings-index-group" aria-labelledby="settings-advanced-heading">
              <h3 id="settings-advanced-heading">Advanced</h3>
              {inSection("advanced")}
              <section className="fb-settings-index-group" aria-labelledby="settings-troubleshooting-heading">
                <h4 id="settings-troubleshooting-heading">Troubleshooting</h4>
                {inSection("troubleshooting")}
              </section>
            </section>
            <section className="fb-settings-index-group" aria-labelledby="settings-legal-heading">
              <h3 id="settings-legal-heading">Legal</h3>
              {inSection("legal")}
            </section>
            <section className="fb-settings-index-group" aria-labelledby="settings-help-heading">
              <h3 id="settings-help-heading">Help & about</h3>
              {inSection("helpAbout")}
            </section>
          </SettingsGroup>
          <div className="fb-settings-signout">
          <SettingsGroup>
            <PreferenceSwitchRow
              title="Keep this account signed in"
              description={keepAccount
                ? "Saved on this device. Switch back without your password."
                : "This account is not saved here. You will sign in again next time."}
              icon={UserRound}
              checked={keepAccount}
              onChange={keep => {
                if (!user) return;
                const previous = keepAccount;
                // Optimistic: the switch and the Sign out row agree at once.
                // A failed vault write rolls the switch back and says why.
                setRetention({ id: user.id, keep });
                setSignOutError(null);
                void setAccountKept(user.id, keep).then(() => {
                  announce(keep
                    ? "This account will stay signed in on this device."
                    : "This account will be removed from this device after you sign out.");
                }).catch((err: unknown) => {
                  setRetention({ id: user.id, keep: previous });
                  setSignOutError(friendlyError(err).message);
                });
              }}
              disabled={signingOut}
            />
            <SettingsRow
              title={signingOut ? "Signing out…" : "Sign out"}
                icon={LogOut}
                destructive
                disabled={signingOut}
                onClick={handleSignOut}
              />
            </SettingsGroup>
            {signOutError && <p role="alert" className="fb-settings-error">{signOutError}</p>}
          </div>
        </>
      )}
      </SettingsNestedPages>
    </SettingsPage>
  );
}
