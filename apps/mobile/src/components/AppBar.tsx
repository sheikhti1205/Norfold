import { useEffect, useRef, type ReactNode } from "react";
import { BackButton } from "./BackButton";
import { TopUtilities } from "./TopUtilities";
import "./appBar.css";

export interface AppBarProps {
  /** Route title. One bar per route: screens never render a second heading row. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Route-aware back destination; omit on a root surface. */
  backTo?: string;
  backLabel?: string;
  /** Route-specific actions (filter, refresh, pane toggle) trail the title. */
  actions?: ReactNode;
  /** Global search/notification utilities. Off only where the route owns them
   * inside its own row (Home) or where the surface is immersive (conversation). */
  utilities?: boolean;
  headingLevel?: 1 | 2;
  /** Focus the title on mount for settings-style routes. */
  autoFocus?: boolean;
  className?: string;
}

/**
 * The one route-aware top bar.
 *
 * Before this existed the shell rendered a global utility strip and several
 * screens rendered a second title row underneath it. Every route now renders
 * exactly one of these (or Home's brand/search row) and the shell renders none.
 */
export function AppBar({
  title,
  subtitle,
  backTo,
  backLabel = "Back",
  actions,
  utilities = true,
  headingLevel = 1,
  autoFocus = false,
  className = "",
}: AppBarProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  useEffect(() => {
    if (!autoFocus) return;
    heading.current?.focus({ preventScroll: true });
  }, [autoFocus, title]);
  return (
    <header className={`fb-app-bar ${className}`} data-testid="app-bar">
      {backTo && <BackButton fallbackTo={backTo} label={backLabel} />}
      <div className="fb-app-bar-title">
        {title != null && (
          <Heading ref={heading} tabIndex={autoFocus ? -1 : undefined}>{title}</Heading>
        )}
        {subtitle != null && <p className="fb-app-bar-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="fb-app-bar-actions">{actions}</div>}
      {utilities && <TopUtilities />}
    </header>
  );
}
