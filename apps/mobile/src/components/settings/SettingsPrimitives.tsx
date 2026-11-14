import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { NavLink, type To } from "react-router";
import { Check, ChevronRight, Search, X, type LucideIcon } from "lucide-react";
import { ACCENT_OPTIONS, type AccentId } from "../../appearance";
import type { Theme } from "../../theme";
import { density } from "../../design/density";
import { colorTokensFor } from "../../design/colorSystem";
import { BackButton } from "../BackButton";
import { useReportSettingsWindowTitle, useSettingsWindowHosted } from "../settingsWindowHost";
import "./settings.css";

// Legacy category/tone names are accepted at the boundary but render neutral.
// Only an explicit meaningful status may color a settings glyph.
export type SettingIconTone = "neutral" | "brand" | "success" | "warning" | "danger"
  | "account" | "appearance" | "accessibility" | "media" | "notifications" | "ai" | "privacy" | "help" | "about"
  | "blue" | "lavender" | "teal" | "amber" | "coral" | "violet" | "green" | "sky";

export interface SettingIconTileProps {
  icon: LucideIcon;
  tone?: SettingIconTone;
  className?: string;
}
/** Decorative category glyph; its row title carries the accessible meaning. */
export function SettingIconTile({ icon: Icon, tone = "neutral", className = "" }: SettingIconTileProps) {
  const color = tone === "brand" || tone === "success" || tone === "warning" || tone === "danger" ? tone : "neutral";
  return <span aria-hidden="true" data-tone={color} className={`fb-setting-icon ${className}`}><Icon size={density.iconSize} aria-hidden="true" /></span>;
}

export interface SettingsPageProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Uses the shared history-aware BackButton; omit for a root settings page. */
  backTo?: string;
  backState?: Record<string, unknown>;
  backLabel?: string;
  className?: string;
  headingLevel?: 1 | 2;
  autoFocus?: boolean;
}
/**
 * Content only: Shell remains the sole viewport/safe-area/scroll owner.
 *
 * The bar holds the escape control and the title, nothing else. Settings search
 * is owned by the floating window's top search, so a second global search icon
 * and a notification bell never appear here (owner order 2026-11-13).
 */
export function SettingsPage({ title, description, children, backTo, backState, backLabel = "Back to Settings", className = "", headingLevel = 1, autoFocus = true }: SettingsPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  // Inside the floating window the chrome already names the page. The heading
  // stays for focus and announcement, but is not painted a second time; the
  // page's own back control is dropped because the window owns that affordance.
  const hosted = useSettingsWindowHosted();
  const clip = hosted ? " fb-settings-clip" : "";
  useReportSettingsWindowTitle(title);
  useEffect(() => {
    if (!autoFocus) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      // Focus return: leaving the page restores the invoker so keyboard and
      // screen-reader users do not lose their place.
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [title, autoFocus]);
  return <section className={`fb-settings-page ${className}`}>
    <div className={`fb-settings-sticky${clip}`}>
      {!hosted && backTo && <BackButton fallbackTo={backTo} fallbackState={backState} label={backLabel} />}
      <Heading ref={heading} tabIndex={-1}>{title}</Heading>
    </div>
    {description && <p className={`fb-settings-page-description${clip}`}>{description}</p>}
    <div className="fb-settings-page-content">{children}</div>
  </section>;
}

export interface SettingsGroupProps {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}
export function SettingsGroup({ title, description, children, className = "" }: SettingsGroupProps) {
  const id = useId();
  return <section aria-labelledby={title ? `${id}-title` : undefined} aria-describedby={description ? `${id}-description` : undefined} className={`fb-settings-group ${className}`}>
    {(title || description) && <header className="fb-settings-group-header">
      {title && <h2 id={`${id}-title`}>{title}</h2>}
      {description && <p id={`${id}-description`}>{description}</p>}
    </header>}
    <div className="fb-settings-group-card">{children}</div>
  </section>;
}

export interface SettingsRowContentProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  iconTone?: SettingIconTone;
  /** Display-only content; never put an interactive control inside a row. */
  value?: ReactNode;
  badge?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  className?: string;
}
export type SettingsRowProps = SettingsRowContentProps & (
  | { route: To; onClick?: never }
  | { route?: never; onClick?: () => void }
);

export function SettingsRow({ title, description, icon, iconTone, value, badge, route, onClick, destructive = false, disabled = false, className = "" }: SettingsRowProps) {
  const id = useId();
  const describedBy = [description && `${id}-description`, value != null && `${id}-value`, badge != null && `${id}-badge`].filter(Boolean).join(" ") || undefined;
  const content = <>
    {icon && <SettingIconTile icon={icon} tone={destructive ? "danger" : iconTone} />}
    <span className="fb-settings-row-copy">
      <span id={`${id}-title`} className="fb-settings-row-title">{title}</span>
      {description && <span id={`${id}-description`} className="fb-settings-row-description">{description}</span>}
    </span>
    {badge != null && <span id={`${id}-badge`} className="fb-settings-row-badge">{badge}</span>}
    {value != null && <span id={`${id}-value`} className="fb-settings-row-value" data-text={typeof value === "string" ? "" : undefined}>{value}</span>}
    {route && <ChevronRight size={18} aria-hidden="true" className="fb-settings-chevron" />}
  </>;
  const common = {
    className: `fb-settings-row ${className}`,
    "data-destructive": destructive || undefined,
    "aria-labelledby": `${id}-title`,
    "aria-describedby": describedBy,
  };
  if (route && !disabled) return <NavLink {...common} to={route}>{content}</NavLink>;
  if (onClick) return <button {...common} type="button" onClick={onClick} disabled={disabled}>{content}</button>;
  return <div {...common} aria-disabled={disabled || undefined}>{content}</div>;
}

export interface PreferenceSwitchRowProps extends Omit<SettingsRowContentProps, "value" | "badge" | "destructive"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}
/** One native button target. Space/Enter toggle; assistive tech announces state. */
export function PreferenceSwitchRow({ title, description, icon, iconTone, checked, onChange, disabled = false, className = "" }: PreferenceSwitchRowProps) {
  const id = useId();
  return <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} disabled={disabled} onClick={() => onChange(!checked)} className={`fb-settings-row ${className}`}>
    {icon && <SettingIconTile icon={icon} tone={iconTone} />}
    <span className="fb-settings-row-copy">
      <span id={`${id}-title`} className="fb-settings-row-title">{title}</span>
      {description && <span id={`${id}-description`} className="fb-settings-row-description">{description}</span>}
    </span>
    <span aria-hidden="true" className="fb-switch-track" data-checked={checked}>
      <span className="fb-switch-thumb">{checked && <Check size={14} strokeWidth={3} />}</span>
    </span>
  </button>;
}

export interface SettingsSearchResult extends Omit<SettingsRowContentProps, "value" | "badge" | "destructive" | "disabled" | "className"> {
  id: string;
  route: To;
}
export interface SettingsSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Caller owns filtering; results are ordinary links, not a combobox. */
  results?: readonly SettingsSearchResult[];
  label?: string;
  placeholder?: string;
  className?: string;
}
export function SettingsSearch({ query, onQueryChange, results, label = "Search settings", placeholder = "Search settings", className = "" }: SettingsSearchProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0 && results !== undefined;
  return <div className={`fb-settings-search ${className}`}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <div className="fb-settings-search-field">
      <Search size={20} aria-hidden="true" />
      <input ref={input} id={id} type="search" value={query} placeholder={placeholder} onChange={(event) => onQueryChange(event.target.value)} />
      {query && <button type="button" aria-label="Clear search" onClick={() => { onQueryChange(""); input.current?.focus(); }}><X size={18} aria-hidden="true" /></button>}
    </div>
    {searching && <>
      <p role="status" className="fb-settings-search-status">{results.length ? `${results.length} ${results.length === 1 ? "setting" : "settings"} found` : "No settings found. Try a different word."}</p>
      {results.length > 0 && <ul className="fb-settings-results" aria-label="Settings search results">
        {results.map(({ id: key, ...row }) => <li key={key}><SettingsRow {...row} /></li>)}
      </ul>}
    </>}
  </div>;
}

const THEME_LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
export interface ThemeCardProps {
  name: string;
  value: Theme;
  checked: boolean;
  onChange: (theme: Theme) => void;
  disabled?: boolean;
  description?: string;
}
/** Use inside a fieldset+legend; shared name supplies native arrow-key behavior. */
export function ThemeCard({ name, value, checked, onChange, disabled = false }: ThemeCardProps) {
  const id = useId();
  const modes = value === "system" ? ["light", "dark"] as const : [value];
  return <label className="fb-preview-choice" data-checked={checked} data-disabled={disabled}>
    <input className="fb-choice-input" type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} aria-labelledby={`${id}-label`} />
    <span className="fb-preview-frame fb-theme-window" aria-hidden="true">{modes.map(mode => <span className="fb-theme-window-half" key={mode} style={colorTokensFor(mode) as CSSProperties}><span /><span /><span /></span>)}</span>
    <span className="fb-preview-label" id={`${id}-label`}>{THEME_LABELS[value]}</span>
  </label>;
}

/**
 * One navigation choice as a picture, never as a row with a tick.
 *
 * Owner direction `docs/design/APPEARANCE-CHOOSERS.md` §4: two tiles side by
 * side at 4 by 3, the bottom bar holding five destinations and the rail holding
 * four, so the two pictures differ in shape as well as orientation. Selection is
 * the shared ring state (§D-A2), and the label under the tile is the tile's only
 * text.
 *
 * The content pane carries three bars rather than a flat block: a blank
 * rectangle read as an unfinished placeholder next to the theme tiles, which
 * already use bars (§3).
 */
const NAV_TILE_DOTS = { bottom: 5, rail: 4 } as const;

export function NavLayoutCard({ name, value, checked, onChange }: { name: string; value: "bottom" | "rail"; checked: boolean; onChange: (value: "bottom" | "rail") => void }) {
  return <label className="fb-preview-choice" data-checked={checked}>
    <input className="fb-choice-input" type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
    <span className="fb-preview-frame fb-nav-preview" data-layout={value} aria-hidden="true">
      <span className="fb-nav-preview-content"><i /><i /><i /></span>
      <span className="fb-nav-preview-bar">{Array.from({ length: NAV_TILE_DOTS[value] }, (_, index) => <i key={index} />)}</span>
    </span>
    <span className="fb-preview-label">{value === "bottom" ? "Bottom bar" : "Side rail"}</span>
  </label>;
}

export interface PreferenceRadioRowProps {
  name: string;
  value: string;
  title: string;
  description?: ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}
/**
 * One native radio in a choice list.
 *
 * Use inside `fieldset.fb-choice-fieldset` + `div.fb-choice-list`; every row in
 * one group shares `name`, so the browser's own arrow-key behaviour moves
 * between options and the list draws its hairline separators. `aria-checked`,
 * focus ring and 48px target come from the settings foundation.
 */
export function PreferenceRadioRow({ name, value, title, description, checked, onChange, disabled = false, className = "" }: PreferenceRadioRowProps) {
  const id = useId();
  return <label className={`fb-choice ${className}`} data-checked={checked} data-disabled={disabled}>
    <input className="fb-choice-input" type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange()} aria-labelledby={`${id}-label`} aria-describedby={description ? `${id}-description` : undefined} />
    <span className="fb-choice-title" id={`${id}-label`}>{title}{checked && <Check size={16} aria-hidden="true" />}</span>
    {description && <span className="fb-choice-description" id={`${id}-description`}>{description}</span>}
  </label>;
}

export interface AccentSwatchProps {
  name: string;
  accent: AccentId;
  checked: boolean;
  onChange: (accent: AccentId) => void;
  disabled?: boolean;
}
export function AccentSwatch({ name, accent, checked, onChange, disabled = false }: AccentSwatchProps) {
  const option = ACCENT_OPTIONS.find((a) => a.id === accent) ?? ACCENT_OPTIONS[0]!;
  const id = useId();
  const style = {
    "--fb-swatch-light": option.swatch, "--fb-swatch-dark": option.darkSwatch,
    "--fb-swatch-on-light": option.onAccent, "--fb-swatch-on-dark": option.darkOnAccent,
  } as CSSProperties;
  return <label className="fb-choice fb-accent-swatch" style={style} data-checked={checked} data-disabled={disabled}>
    <input className="fb-choice-input" type="radio" name={name} value={option.id} checked={checked} disabled={disabled} onChange={() => onChange(option.id)} aria-labelledby={id} />
    <span className="fb-accent-dot" aria-hidden="true">{checked && <Check size={20} strokeWidth={3} />}</span>
    <span id={id} className="fb-choice-title">{option.label}</span>
  </label>;
}

export interface StatusPillProps {
  tone?: "success" | "warning" | "error" | "neutral" | "accent";
  children: ReactNode;
}
/** Display status only; caller owns live announcements for async changes. */
export function StatusPill({ tone = "neutral", children }: StatusPillProps) {
  return <span className="fb-status-pill" data-tone={tone}>{children}</span>;
}

export interface AdvancedDisclosureProps {
  title?: string;
  children: ReactNode;
}
export function AdvancedDisclosure({ title = "Technical details", children }: AdvancedDisclosureProps) {
  return <details className="fb-advanced-disclosure"><summary>{title}</summary><div>{children}</div></details>;
}
