/** User-paced editorial onboarding; persistence and routing keep their owners. */
import { forwardRef, useCallback, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { useShouldReduceMotion, motionDurations, motionEasings } from "../components/uiMotion";
import { completeOnboarding } from "../services/onboarding";
import "./Onboarding.css";

export interface OnboardingPage {
  primary: string;
  secondary: string;
  body: string;
  detail: string;
}

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  {
    primary: "Lost or found", secondary: "something?",
    body: "Create a report with what you know, including a photo, date and approximate area.",
    detail: "Keep an identifying detail private so you can ask someone to describe it later.",
  },
  {
    primary: "Search", secondary: "reports.",
    body: "Look through reports using the details you remember. Narrow your search by category, date and area.",
    detail: "A possible match is a starting point, not a guarantee.",
  },
  {
    primary: "Plan a", secondary: "safe return.",
    body: "Send a message request and check the details together before arranging a handover.",
    detail: "Meet in a public place and never share passwords or verification codes.",
  },
  {
    primary: "Ready", secondary: "to begin?",
    body: "Continue to sign in or create an account. Then you can start a report or search.",
    detail: "Take your time and share only what you are comfortable with.",
  },
] as const;

export interface OnboardingProps {
  /** Called after canonical completion is persisted; the host owns navigation. */
  onComplete?: () => void;
  initialPage?: number;
  /** Reuse approved scenes under the public navigation, without a second header. */
  publicHero?: boolean;
}

function clampPage(page: number | undefined): number {
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.trunc(page as number)), ONBOARDING_PAGES.length - 1);
}

const Scene = forwardRef<HTMLDivElement, { page: number; reduced: boolean; direction: number }>(function Scene({ page, reduced, direction }, ref) {
  const present = useIsPresent();
  const current = ONBOARDING_PAGES[page]!;
  return (
    <motion.div
      ref={ref}
      className="fb-onboarding-page"
      data-scene={page}
      aria-hidden={!present || undefined}
      initial={{ opacity: 0, transform: reduced ? "none" : `translateX(${direction * 16}px)` }}
      animate={{ opacity: 1, transform: "none" }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionDurations.standard, ease: motionEasings.out, opacity: { duration: motionDurations.fast } }}
    >
      <h1 className="fb-onboarding-title">
        <span className="fb-onboarding-mask">{current.primary}</span>{" "}
        <span className="fb-onboarding-mask fb-onboarding-secondary">{current.secondary}</span>
      </h1>
      <div className="fb-onboarding-copy">
        <p className="fb-onboarding-body">{current.body}</p>
        <p className="fb-onboarding-detail">{current.detail}</p>
      </div>
    </motion.div>
  );
});

export function Onboarding({ onComplete, initialPage = 0, publicHero = false }: OnboardingProps) {
  const reduced = useShouldReduceMotion();
  const [{ page, direction }, setPosition] = useState(() => ({ page: clampPage(initialPage), direction: 1 }));
  const finished = useRef(false);
  const last = page === ONBOARDING_PAGES.length - 1;
  const current = ONBOARDING_PAGES[page]!;
  const move = useCallback((delta: number) => {
    setPosition(p => {
      const next = clampPage(p.page + delta);
      return next === p.page ? p : { page: next, direction: delta };
    });
  }, []);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    completeOnboarding();
    onComplete?.();
  }, [onComplete]);
  return (
    <section aria-label="Onboarding" role="region" tabIndex={0}
      data-motion={reduced ? "static" : "full"} className={`fb-onboarding${publicHero ? " fb-onboarding--public" : ""}`}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
        if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
        else if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault(); if (last) finish(); else move(1);
        }
      }}
    >
      <header className="fb-onboarding-header">
        {!publicHero && <div className="fb-onboarding-brand"><BrandMark size={28} shape="tile" alt="" /><span>Norfold</span></div>}
        {!last && <button type="button" onClick={finish} className="fb-onboarding-btn fb-onboarding-btn--quiet">Skip</button>}
      </header>

      <div className="fb-onboarding-pager">
        <p className="fb-onboarding-index" aria-hidden="true">0{page + 1} / 04</p>
        <div className="fb-onboarding-drag">
          <AnimatePresence initial={false} mode="popLayout">
            <Scene key={page} page={page} direction={direction} reduced={reduced} />
          </AnimatePresence>
        </div>
      </div>

      <footer className="fb-onboarding-controls">
        <div role="progressbar" aria-label="Onboarding progress" aria-valuemin={1}
          aria-valuemax={4} aria-valuenow={page + 1} aria-valuetext={`${page + 1} of 4`}
          className="fb-onboarding-progress">
          <span className="sr-only">{page + 1} of 4</span>
          {ONBOARDING_PAGES.map((_, i) => <span key={i} className="fb-onboarding-segment" aria-hidden="true" data-filled={i <= page} />)}
        </div>
        <p role="status" aria-atomic="true" className="sr-only">{page + 1} of 4. {current.primary} {current.secondary}</p>
        <div className="fb-onboarding-controls-row">
          {page > 0 ? <button type="button" onClick={() => move(-1)} className="fb-onboarding-btn fb-onboarding-btn--quiet">Back</button>
            : <span className="fb-onboarding-btn-spacer" aria-hidden="true" />}
          <button type="button" onClick={last ? finish : () => move(1)} className="fb-onboarding-btn fb-onboarding-btn--primary">
            {last ? "Sign in or create account" : "Next"}<ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}
