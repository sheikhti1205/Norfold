import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { SettingIconTile, type SettingIconTone } from "../../components/settings";

type NestedPage = { title: string; children: ReactNode; trigger: HTMLElement | null };
const NestedPagesContext = createContext<((page: NestedPage) => void) | null>(null);

export function SettingsNestedPages({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<NestedPage[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const back = () => {
    const page = pages[pages.length - 1];
    setPages(current => current.slice(0, -1));
    requestAnimationFrame(() => page?.trigger?.focus());
  };
  useEffect(() => {
    if (!pages.length) return;
    heading.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); back(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pages]);
  const page = pages[pages.length - 1];
  return <NestedPagesContext.Provider value={next => setPages(current => [...current, next])}>
    <div hidden={!!page}>{children}</div>
    {page && <section className="fb-settings-nested-page">
      <header className="fb-settings-nested-page-header">
        <button type="button" onClick={back} aria-label="Back to settings"><ArrowLeft size={20} aria-hidden="true" /></button>
        <h2 ref={heading} tabIndex={-1}>{page.title}</h2>
      </header>
      <div className="fb-settings-group-card">{page.children}</div>
    </section>}
  </NestedPagesContext.Provider>;
}

export interface SettingsNestedGroupProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  iconTone?: SettingIconTone;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Disclosure subgroup for the Settings root (Advanced, Help & about).
 * Native <details>/<summary>: keyboard-focusable, exposes expanded state to
 * assistive tech, needs no JS. Links live in the body — never nested inside
 * the summary control.
 */
export function SettingsNestedGroup({
  title,
  description,
  icon,
  iconTone,
  children,
  defaultOpen = false,
  className = "",
}: SettingsNestedGroupProps) {
  const openPage = useContext(NestedPagesContext);
  if (openPage) return <button type="button" className={`fb-settings-row fb-settings-nested-summary ${className}`}
    onClick={event => openPage({ title, children, trigger: event.currentTarget })}>
    {icon && <SettingIconTile icon={icon} tone={iconTone} />}
    <span className="fb-settings-row-copy"><span className="fb-settings-row-title">{title}</span>
      {description && <span className="fb-settings-row-description">{description}</span>}
    </span>
    <ChevronRight size={18} aria-hidden="true" className="fb-settings-chevron" />
  </button>;
  return (
    <details className={`fb-settings-nested ${className}`} open={defaultOpen || undefined}>
      <summary className="fb-settings-row fb-settings-nested-summary">
        {icon && <SettingIconTile icon={icon} tone={iconTone} />}
        <span className="fb-settings-row-copy">
          <span className="fb-settings-row-title">{title}</span>
          {description && (
            <span className="fb-settings-row-description">{description}</span>
          )}
        </span>
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="fb-settings-chevron fb-settings-nested-chevron"
        />
      </summary>
      <div className="fb-settings-nested-body">{children}</div>
    </details>
  );
}
