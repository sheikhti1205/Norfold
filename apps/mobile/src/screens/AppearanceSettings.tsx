import { BadgeCheck, MapPin, MessageCircle, Search, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { ACCENT_OPTIONS, REACTION_APPEARANCE_OPTIONS, useAppearance, useSystemColorsSupported } from "../appearance";
import { useTheme, type Theme } from "../theme";
import {
  AccentSwatch,
  NavLayoutCard,
  PreferenceRadioRow,
  PreferenceSwitchRow,
  SettingsGroup,
  SettingsPage,
  ThemeCard,
} from "../components/settings";
import "./AppearanceSettings.css";

const THEMES: readonly Theme[] = ["system", "light", "dark"];
const THEME_LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Settings → Appearance (`/settings/appearance`): theme, accent, navigation
 * layout, reaction appearance and a live preview. Everything applies and
 * persists through `useTheme()` / `useAppearance()` the moment it is picked;
 * there is no Save step. The true-black toggle is a modifier that only surfaces
 * when the resolved mode can be dark; picking Dark never forces true black on
 * its own. Navigation and reaction choices are stored even when the current
 * screen resolves them differently, so they take effect as soon as the room or
 * state allows.
 */
export function AppearanceSettings() {
  const { theme, trueBlackDark, setTheme, setTrueBlackDark } = useTheme();
  const { settings, update } = useAppearance();
  const systemColorsSupported = useSystemColorsSupported();
  const accentLabel = settings.accentSource === "system"
    ? systemColorsSupported ? "System colors" : "Blue"
    : ACCENT_OPTIONS.find((option) => option.id === settings.accent)?.label ?? ACCENT_OPTIONS[0]!.label;
  // Light can never resolve dark, so the modifier is irrelevant (and hidden).
  const trueBlackRelevant = theme !== "light";
  const previewLabel = trueBlackRelevant && trueBlackDark ? "True black" : THEME_LABELS[theme];
  const reactionLabel = REACTION_APPEARANCE_OPTIONS.find(option => option.value === settings.reactionAppearance)?.label ?? "Adaptive";
  const navigationLabel = settings.navLayout === "auto" ? "Automatic" : settings.navLayout === "rail" ? "Side rail" : "Bottom bar";

  return (
    <SettingsPage
      title="Appearance"
      description="Make Norfold look yours. Changes apply right away."
      backTo="/settings"
    >
      <SettingsGroup
        title="Theme"
        description="System follows your device."
      >
        <fieldset className="fb-choice-fieldset">
          <legend className="sr-only">Theme</legend>
          <div className="fb-preview-grid fb-preview-grid-theme">
            {THEMES.map((value) => (
              <ThemeCard
                key={value}
                name="appearance-theme"
                value={value}
                checked={theme === value}
                onChange={setTheme}
              />
            ))}
          </div>
        </fieldset>
      </SettingsGroup>

      {trueBlackRelevant && (
        <SettingsGroup
          title="True black"
          description="Only applies while dark mode is active."
        >
          <PreferenceSwitchRow
            title="True black background"
            description="Saves power on OLED screens."
            checked={trueBlackDark}
            onChange={setTrueBlackDark}
          />
        </SettingsGroup>
      )}

      <SettingsGroup
        title="Accent"
        description={`Used for buttons, selections, and highlights. Status colors, reactions, and mention links keep their own meaning and never follow the accent.${systemColorsSupported ? "" : " System colors are available on supported Android 12+ devices."}`}
      >
        {systemColorsSupported ? (
          <PreferenceSwitchRow
            title="System colors"
            description="Follow your device’s wallpaper colors. Choose a color below to use a preset instead."
            checked={settings.accentSource === "system"}
            onChange={(checked) => update({ accentSource: checked ? "system" : "preset" })}
          />
        ) : null}
        <fieldset className="fb-choice-fieldset">
          <legend className="sr-only">Accent</legend>
          <div className="fb-accent-grid">
            {ACCENT_OPTIONS.map((option) => (
              <AccentSwatch
                key={option.id}
                name="appearance-accent"
                accent={option.id}
                checked={settings.accentSource === "preset" && settings.accent === option.id}
                onChange={(accent) => update({ accent, accentSource: "preset" })}
              />
            ))}
          </div>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup
        title="Navigation"
        description="Automatic uses the side rail when there is room and the bottom bar on phones. Choosing Bottom bar keeps the floating bar even on a wide screen."
      >
        <fieldset className="fb-choice-fieldset">
          {/* The group already announces "Navigation" from the section title;
              naming the fieldset "Layout" avoids announcing it twice. */}
          <legend className="sr-only">Layout</legend>
          <div className="fb-preview-grid fb-preview-grid-nav fb-appearance-nav-grid">
            {(["auto", "bottom", "rail"] as const).map(value => (
              <NavLayoutCard
                key={value}
                name="appearance-nav-layout"
                value={value}
                checked={settings.navLayout === value}
                onChange={(next) => update({ navLayout: next, navLayoutChosen: true })}
              />
            ))}
          </div>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup
        title="Reactions"
        description="Choose how much color the like and dislike controls use. Their meaning never depends on color alone."
      >
        <fieldset className="fb-choice-fieldset">
          <legend className="sr-only">Reaction appearance</legend>
          <div className="fb-choice-list">
            {REACTION_APPEARANCE_OPTIONS.map(option => (
              <PreferenceRadioRow
                key={option.value}
                name="appearance-reactions"
                value={option.value}
                title={option.label}
                description={option.description}
                checked={settings.reactionAppearance === option.value}
                onChange={() => update({ reactionAppearance: option.value })}
              />
            ))}
          </div>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup
        title="Preview"
        description="A sample report in your current look."
      >
        <div
          role="img"
          aria-label={`Preview of ${previewLabel} theme, ${accentLabel} accent, ${reactionLabel} reactions and ${navigationLabel} navigation`}
          data-theme={theme}
          data-true-black={trueBlackDark ? "true" : undefined}
          data-accent={settings.accentSource === "system" ? "system" : settings.accent}
          data-reaction-appearance={settings.reactionAppearance}
          className="fb-appearance-preview"
        >
          <div aria-hidden="true" className="fb-appearance-report">
            <div className="fb-appearance-report-head">
              <span className="fb-appearance-avatar">SA</span>
              <span className="fb-appearance-report-identity">
                <span className="fb-appearance-report-name">Samira <BadgeCheck size={13} /></span>
                <span className="fb-appearance-report-time">2h</span>
              </span>
            </div>
            <div className="fb-appearance-report-title-row">
              <p className="fb-appearance-report-title">Black canvas backpack</p>
              <span className="fb-appearance-report-status">Lost</span>
            </div>
            <p className="fb-appearance-report-place"><MapPin size={13} /> Central Library</p>
            <div className="fb-appearance-report-actions">
              <span className="fb-appearance-preview-action" data-kind="like" data-selected="true"><ThumbsUp size={15} fill="currentColor" /> 8</span>
              <span className="fb-appearance-preview-action" data-kind="dislike"><ThumbsDown size={15} /></span>
              <span className="fb-appearance-preview-action" data-kind="comment"><MessageCircle size={15} /> 3</span>
              <span className="fb-appearance-preview-action" data-kind="share"><Share2 size={15} /></span>
            </div>
          </div>
          <div aria-hidden="true" className="fb-appearance-preview-row">
            <span className="fb-appearance-preview-button">Message</span>
            <span className="fb-appearance-preview-chip">Found near you</span>
            <span className="fb-appearance-preview-link">View report details</span>
            <span className="fb-appearance-preview-focus"><Search size={13} aria-hidden="true" /> Find a report</span>
          </div>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
