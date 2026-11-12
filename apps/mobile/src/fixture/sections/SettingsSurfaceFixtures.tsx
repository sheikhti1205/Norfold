import { useState } from "react";
import { Link } from "react-router";
import { Bookmark, ChevronRight, CircleHelp, LogOut, MessageSquareWarning, Palette, Settings as SettingsIcon } from "lucide-react";
import { NavLayoutCard, SettingsGroup, SettingsPage, SettingsRow, SettingsSearch, ThemeCard } from "../../components/settings";
import { UserAvatar } from "../../components/UserAvatar";
import { settingsDestinations, settingsSectionFor, type SettingsSection } from "../../services/destinations";
import { accountSummary, accessibilitySummary, appearanceSummary, mediaSummary, ROW_PRESENTATION } from "../../screens/Settings";
import { feedLayoutSummary } from "../../screens/FeedLayoutSettings";
import { resolveFeedLayout, useViewportWidth } from "../../components/responsive";
import { APP_VERSION } from "../../services/appCapabilities";
import { FixtureFrame, FixtureSection, type FixtureVariant } from "../FixtureSection";
import "../../screens/Settings.css";
import "../../screens/AppearanceSettings.css";
import "../../components/AccountMenu.css";

const titles: Record<string, string> = {
  "recovered-items": "Recovered items", account: "Account & verification", devices: "Devices", backup: "Chat backup",
  "chat-preferences": "Chat preferences", appearance: "Appearance", notifications: "Notification preferences",
  accessibility: "Accessibility", "feed-layout": "Feed layout", "local-intelligence": "Local tools", ai: "Optional AI Chat",
  privacy: "Privacy & safety", feedback: "Send feedback", media: "Media & uploads", diagnostics: "Diagnostics",
  terms: "Terms of use", "privacy-policy": "Privacy policy", "community-guidelines": "Community guidelines",
  help: "Help & guide", replay: "Replay introduction", updates: "Updates & version history", about: "About Norfold",
};
const sections: readonly [SettingsSection, string | undefined][] = [
  ["updates", undefined], ["account", "Account"], ["preferences", "Preferences"], ["intelligence", "Intelligence"],
  ["privacy", "Privacy"], ["more", "More"], ["advanced", "Advanced"], ["troubleshooting", "Troubleshooting"],
  ["legal", "Legal"], ["helpAbout", "Help & about"],
];
const values: Record<string, string> = {
  account: accountSummary({ emailVerified: true, phoneVerified: false }),
  appearance: appearanceSummary("system", "blue"), notifications: "Review settings",
  accessibility: accessibilitySummary("standard", "system"), media: mediaSummary(false), about: APP_VERSION,
};

function SettingsIndex() {
  const [query, setQuery] = useState("");
  const viewportWidth = useViewportWidth();
  const rows = settingsDestinations({ platform: "web", signedIn: true, capabilities: [] });
  return <SettingsPage title="Settings" utilities={false} autoFocus={false} className="fb-settings-root">
    <Link to="/profile" className="fb-settings-profile">
      <UserAvatar avatarUrl={null} username="Account" size={64} />
      <span className="fb-settings-profile-copy"><span className="fb-settings-profile-name">Account</span></span>
      <span className="fb-settings-profile-edit">View profile <ChevronRight size={18} aria-hidden="true" /></span>
    </Link>
    <SettingsSearch query={query} onQueryChange={setQuery} />
    {sections.map(([section, title]) => <SettingsGroup key={section} title={title}>
      {rows.filter(row => settingsSectionFor(row.id) === section && (titles[row.id] ?? row.title).toLowerCase().includes(query.toLowerCase())).map(row => {
        // Production owns each row's title, icon and detail flag; a fixture that
        // re-declared them would review a screen production does not render.
        const presentation = ROW_PRESENTATION[row.id];
        return <SettingsRow key={row.id}
          title={presentation?.title ?? titles[row.id] ?? row.title}
          icon={presentation?.icon}
          iconTone={presentation?.iconTone}
          route={row.route}
          value={row.id === "feed-layout" ? feedLayoutSummary("auto", resolveFeedLayout("auto", viewportWidth)) : values[row.id]}
          description={row.id === "updates" ? "Version history and update notices." : presentation?.detail ? row.summary : undefined} />;
      })}
    </SettingsGroup>)}
    <SettingsGroup><SettingsRow title="Sign out" icon={LogOut} destructive /></SettingsGroup>
  </SettingsPage>;
}

function AccountPopover() {
  return <div className="fb-account-menu"><div className="fb-account-dialog" role="dialog" aria-label="Account">
    <Link to="/profile" className="fb-account-row fb-account-identity"><UserAvatar avatarUrl={null} username="Account" size={40} /><span className="fb-account-identity-text"><strong>Account</strong></span><ChevronRight size={20} aria-hidden="true" /></Link>
    <div className="fb-account-divider" />
    <Link to="/settings/appearance" className="fb-account-row"><Palette size={24} aria-hidden="true" />Appearance</Link>
    <Link to="/saved" className="fb-account-row"><Bookmark size={24} aria-hidden="true" />Saved</Link>
    <Link to="/settings/feedback" className="fb-account-row"><MessageSquareWarning size={24} aria-hidden="true" />Report a problem</Link>
    <div className="fb-account-divider" />
    <Link to="/settings" className="fb-account-row"><SettingsIcon size={24} aria-hidden="true" />Settings</Link>
    <div className="fb-account-divider" />
    <Link to="/settings/help" className="fb-account-row"><CircleHelp size={24} aria-hidden="true" /><span>Help</span><ChevronRight size={20} aria-hidden="true" /></Link>
    <div className="fb-account-row"><LogOut size={24} aria-hidden="true" /><span>Log out</span><ChevronRight size={20} aria-hidden="true" /></div>
  </div></div>;
}

function Choices({ variant, theme, layout }: { variant: FixtureVariant; theme: "system" | "light" | "dark"; layout: "bottom" | "rail" }) {
  return <SettingsPage title="Appearance" backTo="/settings" utilities={false} autoFocus={false}>
    <SettingsGroup title="Theme"><fieldset className="fb-choice-fieldset"><legend className="sr-only">Theme</legend><div className="fb-preview-grid fb-preview-grid-theme">
      {(["system", "light", "dark"] as const).map(value => <ThemeCard key={value} name={`theme-${variant}`} value={value} checked={theme === value} onChange={() => {}} />)}
    </div></fieldset></SettingsGroup>
    <SettingsGroup title="Navigation"><fieldset className="fb-choice-fieldset"><legend className="sr-only">Layout</legend><div className="fb-preview-grid fb-preview-grid-nav">
      {(["bottom", "rail"] as const).map(value => <NavLayoutCard key={value} name={`nav-${variant}`} value={value} checked={layout === value} onChange={() => {}} />)}
    </div></fieldset></SettingsGroup>
  </SettingsPage>;
}

export function SettingsSurfaceFixtures() {
  return <FixtureSection id="settings-surface" title="Settings surface" description="Settings index, account menu, and appearance choices.">
    <FixtureFrame section="settings-surface" variant="normal"><SettingsIndex /></FixtureFrame>
    <FixtureFrame section="settings-surface" variant="loading"><AccountPopover /></FixtureFrame>
    {([
      ["empty", "system", "bottom"], ["error", "light", "rail"], ["long-content", "dark", "bottom"],
      ["large-text", "system", "rail"], ["dark", "dark", "rail"], ["amoled", "dark", "bottom"], ["small-width", "light", "rail"],
    ] as const).map(([variant, theme, layout]) => <FixtureFrame key={variant} section="settings-surface" variant={variant}>
      <Choices variant={variant} theme={theme} layout={layout} />
    </FixtureFrame>)}
  </FixtureSection>;
}
