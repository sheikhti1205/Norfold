import { useState } from "react";
import { LogOut } from "lucide-react";
import { NavLayoutCard, SettingsGroup, SettingsPage, SettingsRow, SettingsSearch, ThemeCard } from "../../components/settings";
import { AccountMenu } from "../../components/AccountMenu";
import { SettingsProfileHeader } from "../../screens/settings/SettingsProfileHeader";
import { settingsDestinations, settingsSectionFor, type SettingsSection } from "../../services/destinations";
import { accessibilitySummary, appearanceSummary, mediaSummary, ROW_PRESENTATION } from "../../screens/Settings";
import { feedLayoutSummary } from "../../screens/FeedLayoutSettings";
import { resolveFeedLayout, useViewportWidth } from "../../components/responsive";
import { APP_VERSION } from "../../services/appCapabilities";
import { FixtureFrame, FixtureSection, type FixtureVariant } from "../FixtureSection";
import "../../screens/Settings.css";
import "../../screens/AppearanceSettings.css";
import "../../components/AccountMenu.css";
import type { PublicUser } from "@norfold/shared";

const FIXTURE_USER: PublicUser = {
  id: "fixture-user",
  username: "account",
  email: "account@example.com",
  phone: "+10000000000",
  emailVerified: true,
  phoneVerified: false,
  avatarUrl: null,
  displayName: "Account",
  bio: null,
  locationLabel: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const titles: Record<string, string> = {
  "recovered-items": "Recovered items", "sign-in-security": "Sign-in & security",
  devices: "Devices", backup: "Chat backup",
  "chat-preferences": "Chat preferences", appearance: "Appearance", notifications: "Notification preferences",
  accessibility: "Accessibility", "feed-layout": "Feed layout", "local-intelligence": "Local tools", ai: "Optional AI Chat",
  privacy: "Privacy & safety", feedback: "Send feedback", media: "Media & uploads", diagnostics: "Diagnostics",
  terms: "Terms of use", "privacy-policy": "Privacy policy", "community-guidelines": "Community guidelines",
  help: "Help & guide", replay: "Replay introduction", updates: "Updates & version history", about: "About Norfold",
};
const sections: readonly [SettingsSection, string | undefined][] = [
  ["updates", undefined], ["account", "Account"], ["chat", "Chat"], ["preferences", "Preferences"], ["intelligence", "Intelligence"],
  ["privacy", "Privacy"], ["more", "More"], ["advanced", "Advanced"], ["troubleshooting", "Troubleshooting"],
  ["legal", "Legal"], ["helpAbout", "Help & about"],
];
const values: Record<string, string> = {
  appearance: appearanceSummary("system", "blue"), notifications: "Review settings",
  accessibility: accessibilitySummary("standard", "system"), media: mediaSummary(false), about: APP_VERSION,
};

function SettingsIndex() {
  const [query, setQuery] = useState("");
  const viewportWidth = useViewportWidth();
  const rows = settingsDestinations({ platform: "web", signedIn: true, capabilities: [] });
  return <SettingsPage title="Settings" autoFocus={false} className="fb-settings-root">
    <SettingsProfileHeader user={FIXTURE_USER} />
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

function Choices({ variant, theme, layout }: { variant: FixtureVariant; theme: "system" | "light" | "dark"; layout: "bottom" | "rail" }) {
  return <SettingsPage title="Appearance" backTo="/settings" autoFocus={false}>
    <SettingsGroup title="Theme"><fieldset className="fb-choice-fieldset"><legend className="sr-only">Theme</legend><div className="fb-preview-grid fb-preview-grid-theme">
      {(["system", "light", "dark"] as const).map(value => <ThemeCard key={value} name={`theme-${variant}`} value={value} checked={theme === value} onChange={() => {}} />)}
    </div></fieldset></SettingsGroup>
    <SettingsGroup title="Navigation"><fieldset className="fb-choice-fieldset"><legend className="sr-only">Layout</legend><div className="fb-preview-grid fb-preview-grid-nav">
      {(["bottom", "rail"] as const).map(value => <NavLayoutCard key={value} name={`nav-${variant}`} value={value} checked={layout === value} onChange={() => {}} />)}
    </div></fieldset></SettingsGroup>
  </SettingsPage>;
}

/**
 * The account menu is the production component, not a copy of it.
 *
 * The previous fixture re-declared the popover's rows as static links, so it kept
 * rendering the shape R1 replaced (a gear beside an avatar, rows that navigate)
 * and reviewed a menu the product no longer had. Mounting `AccountMenu` means
 * this section cannot drift again: it is the same trigger, the same rows and the
 * same nested panels the rail shows. A signed-out fixture shows the structure
 * without a name or badge; a signed-in account fills those in.
 */
export function SettingsSurfaceFixtures() {
  return <FixtureSection id="settings-surface" title="Settings surface" description="Settings index, the production account menu, and appearance choices.">
    <FixtureFrame section="settings-surface" variant="normal"><SettingsIndex /></FixtureFrame>
    {/* The menu belongs to the rail's footer, so the frame gives it a rail-width
        column. Dropped into a full-width card it would be a 1000px "trigger" and
        the popover would be measured against a geometry production never has. */}
    <FixtureFrame section="settings-surface" variant="loading">
      <div style={{ width: "224px" }}><AccountMenu /></div>
    </FixtureFrame>
    {([
      ["empty", "system", "bottom"], ["error", "light", "rail"], ["long-content", "dark", "bottom"],
      ["large-text", "system", "rail"], ["dark", "dark", "rail"], ["amoled", "dark", "bottom"], ["small-width", "light", "rail"],
    ] as const).map(([variant, theme, layout]) => <FixtureFrame key={variant} section="settings-surface" variant={variant}>
      <Choices variant={variant} theme={theme} layout={layout} />
    </FixtureFrame>)}
  </FixtureSection>;
}
