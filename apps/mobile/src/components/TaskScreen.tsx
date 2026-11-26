import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useHoverLabel } from "./HoverLabel";
import "./TaskScreen.css";

export interface TaskScreenProps {
  /** The screen's visible `<h1>`; it also names the region. */
  title: string;
  description?: string;
  onBack: () => void;
  /** Right-aligned header controls. Disabled as a group while `busy`. */
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}

/**
 * A full-screen task: a real route, not a dialog.
 *
 * The composer used to live in a `ModalOverlay`, which inerts everything
 * outside itself — its own nested portals (the description editor, the block
 * menu, the live region) included. A takeover is a screen, so this renders in
 * place inside the route's `<main>`: no portal, no scrim, no focus trap and no
 * scroll lock. Blocking confirmations still mount their own dialog on top.
 *
 * The header is the description editor's takeover bar — back, centred title,
 * right-hand action — kept sticky so the way out never scrolls away.
 */
export function TaskScreen({ title, description, onBack, actions, busy = false, children }: TaskScreenProps) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { hoverLabel } = useHoverLabel();

  // Arrive at the headline, never in a field: focusing the first input would
  // summon the keyboard before the person has read the screen.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="fb-task-screen" aria-labelledby={titleId} aria-busy={busy || undefined}>
      <header className="fb-task-screen-header">
        <div className="fb-task-screen-bar">
          <button
            type="button"
            className="fb-task-screen-back min-h-[48px] min-w-[48px]"
            aria-label="Back"
            disabled={busy}
            onClick={onBack}
            {...hoverLabel("Back")}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <h1 id={titleId} ref={heading} tabIndex={-1} className="fb-task-screen-title">{title}</h1>
          {actions ? (
            <fieldset className="fb-task-screen-actions" disabled={busy}>{actions}</fieldset>
          ) : (
            <div className="fb-task-screen-actions" aria-hidden="true" />
          )}
        </div>
      </header>
      <div className="fb-task-screen-body">
        {description ? <p className="fb-task-screen-description">{description}</p> : null}
        {children}
      </div>
    </section>
  );
}
