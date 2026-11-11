import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, KeyRound, MapPin, ShieldCheck, Wallet } from "lucide-react";
import { Link } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { useShouldReduceMotion, motionDurations, motionEasings, motionStaggerEditorial } from "../components/uiMotion";
import { completeOnboarding } from "../services/onboarding";
import "./Onboarding.css";

const EASE = motionEasings.editorial;

function useInViewOnce<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect(); } },
      // A section taller than the viewport may never reach a fractional threshold, hiding content at large text sizes.
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, seen] as const;
}

function MaskLine({ children, shown, reduced, delay = 0, muted = false }: {
  children: ReactNode; shown: boolean; reduced: boolean; delay?: number; muted?: boolean;
}) {
  return <span className={`fb-onboarding-mask${muted ? " fb-onboarding-mask--muted" : ""}`} aria-hidden="true">
    <motion.span initial={reduced ? false : { y: "125%" }} animate={shown || reduced ? { y: "0%" } : { y: "125%" }} transition={{ duration: motionDurations.reveal, ease: EASE, delay }}>{children}</motion.span>
  </span>;
}

function revealProps(shown: boolean, reduced: boolean, delay = 0, distance = 16) {
  return {
    initial: reduced ? (false as const) : { opacity: 0, y: distance },
    animate: shown || reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: distance },
    transition: { duration: 0.55, ease: EASE, delay },
  };
}

export interface OnboardingProps {
  onComplete?: () => void;
  embedded?: boolean;
  replay?: boolean;
}

export function Onboarding({ onComplete, embedded = false, replay = false }: OnboardingProps) {
  const reduced = useShouldReduceMotion();
  const finished = useRef(false);
  const [stepsRef, stepsSeen] = useInViewOnce<HTMLElement>();
  const [safetyRef, safetySeen] = useInViewOnce<HTMLElement>();
  const [aboutRef, aboutSeen] = useInViewOnce<HTMLElement>();
  const [closingRef, closingSeen] = useInViewOnce<HTMLElement>();
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    completeOnboarding();
    onComplete?.();
  }, [onComplete]);
  const action = replay ? "Back to settings" : "Sign in or create account";
  const routeMotion = {
    initial: reduced ? (false as const) : { scaleX: 0, scaleY: 0 },
    animate: stepsSeen || reduced ? { scaleX: 1, scaleY: 1 } : { scaleX: 0, scaleY: 0 },
    transition: { duration: 1.1, ease: EASE, delay: 0.05 },
  };
  const markerMotion = (delay: number) => ({
    initial: reduced ? (false as const) : { scale: 0.72, opacity: 0 },
    animate: stepsSeen || reduced ? { scale: 1, opacity: 1 } : { scale: 0.72, opacity: 0 },
    transition: { duration: 0.45, ease: EASE, delay },
  });

  return <div className="fb-onboarding" data-motion={reduced ? "static" : "full"}>
    {!embedded && <header className="fb-onboarding-header">
      <Link className="fb-onboarding-brand-link" to="/" state={{ showPublic: true }} aria-label="Norfold home">
      <motion.div className="fb-onboarding-brand" {...revealProps(true, reduced, 0, -6)} transition={{ duration: 0.5, ease: EASE }}><BrandMark size={28} shape="tile" alt="" /><span>Norfold</span></motion.div>
      </Link>
      {!replay && <motion.button type="button" className="fb-onboarding-quiet" onClick={finish} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}>Skip to sign in</motion.button>}
    </header>}
    <section className="fb-onboarding-intro fb-onboarding-inner" aria-labelledby="onboarding-title" data-reveal="shown">
      <h1 id="onboarding-title" tabIndex={-1} aria-label="Lost or found something?"><MaskLine shown reduced={reduced}>Lost or found</MaskLine><MaskLine shown reduced={reduced} muted delay={motionStaggerEditorial}>something?</MaskLine></h1>
      <motion.p {...revealProps(true, reduced, 0.3, 14)} transition={{ duration: 0.5, ease: EASE, delay: 0.3 }}>Report what you lost, search what others found, and arrange a safe return.</motion.p>
      <motion.div className="fb-onboarding-actions" {...revealProps(true, reduced, 0.4, 12)} transition={{ duration: 0.45, ease: EASE, delay: 0.4 }}>
        <button type="button" className="fb-onboarding-primary" onClick={finish}>{action}<ArrowRight size={18} aria-hidden="true" /></button>
        <a className="fb-onboarding-quiet" href="#how-it-works" onClick={event => {
          event.preventDefault();
          const heading = document.getElementById("how-it-works-heading");
          heading?.scrollIntoView({ block: "start" });
          heading?.focus({ preventScroll: true });
        }}>See how it works</a>
      </motion.div>
      {!replay && <motion.p className="fb-onboarding-note" {...revealProps(true, reduced, 0.48, 10)} transition={{ duration: 0.4, ease: EASE, delay: 0.48 }}>An account is needed to report an item or search reports.</motion.p>}
      <motion.span className="fb-onboarding-rule" aria-hidden="true" initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.34 }} />
    </section>
    <section ref={stepsRef} id="how-it-works" className="fb-onboarding-inner fb-onboarding-section" aria-labelledby="how-it-works-heading" data-reveal={stepsSeen || reduced ? "shown" : "pending"}>
      <h2 id="how-it-works-heading" tabIndex={-1} aria-label="How it works"><MaskLine shown={stepsSeen} reduced={reduced}>How it works</MaskLine></h2>
      <div className="fb-onboarding-route-wrap">
        <motion.span className="fb-onboarding-route fb-onboarding-route--v" aria-hidden="true" {...routeMotion} />
        <motion.span className="fb-onboarding-route fb-onboarding-route--h" aria-hidden="true" {...routeMotion} />
        <ol className="fb-onboarding-steps">
        <motion.li {...revealProps(stepsSeen, reduced, 0.2, 18)}><motion.span aria-hidden="true" {...markerMotion(0.2)}>01</motion.span><div><h3>Report what you know.</h3><p>Add a photo, the date and an approximate area. Keep one identifying detail private so you can check that the right person has the item.</p></div></motion.li>
        <motion.li {...revealProps(stepsSeen, reduced, 0.32, 18)}><motion.span aria-hidden="true" {...markerMotion(0.32)}>02</motion.span><div><h3>Search what you remember.</h3><p>Look through reports by category, date and area. A possible match is a starting point, not proof of ownership.</p></div></motion.li>
        <motion.li {...revealProps(stepsSeen, reduced, 0.44, 18)}><motion.span aria-hidden="true" {...markerMotion(0.44)}>03</motion.span><div><h3>Arrange a safe return.</h3><p>Start with a message request. Agree the details together, meet in a public place, then mark the return when it happens.</p></div></motion.li>
        </ol>
      </div>
    </section>
    <motion.section ref={safetyRef} id="safety" className="fb-onboarding-safety" aria-labelledby="safety-heading" data-reveal={safetySeen || reduced ? "shown" : "pending"}>
      <motion.span className="fb-onboarding-safety-wash" aria-hidden="true" initial={reduced ? false : { scaleX: 0 }} animate={safetySeen || reduced ? { scaleX: 1 } : { scaleX: 0 }} transition={{ duration: 0.75, ease: EASE }} />
      <div className="fb-onboarding-inner fb-onboarding-section">
        <h2 id="safety-heading" tabIndex={-1} aria-label="A safer return starts with care."><MaskLine shown={safetySeen} reduced={reduced} delay={0.12}>A safer return starts with care.</MaskLine></h2>
        <ul>
          <motion.li {...revealProps(safetySeen, reduced, 0.22)}><MapPin size={19} aria-hidden="true" />Meet in a public place.</motion.li>
          <motion.li {...revealProps(safetySeen, reduced, 0.3)}><Wallet size={19} aria-hidden="true" />Never send money to prove ownership.</motion.li>
          <motion.li {...revealProps(safetySeen, reduced, 0.38)}><KeyRound size={19} aria-hidden="true" />Never share passwords or verification codes.</motion.li>
          <motion.li {...revealProps(safetySeen, reduced, 0.46)}><ShieldCheck size={19} aria-hidden="true" />Keep identifying details private. Your exact location is yours to share.</motion.li>
        </ul>
        <motion.p {...revealProps(safetySeen, reduced, 0.54)}>Norfold is in beta. A match, a response or a return is not guaranteed.</motion.p>
        <motion.div {...revealProps(safetySeen, reduced, 0.6)}><Link className="fb-onboarding-guidelines" to="/community-guidelines">Read the community guidelines <ArrowRight size={16} aria-hidden="true" /></Link></motion.div>
      </div>
    </motion.section>
    <section ref={aboutRef} id="about-norfold" className="fb-onboarding-inner fb-onboarding-section" aria-labelledby="about-norfold-heading" data-reveal={aboutSeen || reduced ? "shown" : "pending"}>
      <h2 id="about-norfold-heading" tabIndex={-1} aria-label="A place to begin looking."><MaskLine shown={aboutSeen} reduced={reduced}>A place to begin looking.</MaskLine></h2>
      <motion.p {...revealProps(aboutSeen, reduced, 0.12)}>Norfold is a lost-and-found network for reporting, matching and recovering items. Reports are visible to signed-in readers, and Norfold does not decide who owns an item or handle payment between people.</motion.p>
    </section>
    <section ref={closingRef} className="fb-onboarding-inner fb-onboarding-section fb-onboarding-closing" aria-labelledby="onboarding-closing" data-reveal={closingSeen || reduced ? "shown" : "pending"}>
      <h2 id="onboarding-closing" tabIndex={-1} aria-label="Let’s find a way back."><MaskLine shown={closingSeen} reduced={reduced}>Let’s find a way back.</MaskLine></h2>
      <motion.p {...revealProps(closingSeen, reduced, 0.14)}>Create an account or sign in to report an item or search reports.</motion.p>
      <motion.button type="button" className="fb-onboarding-primary" onClick={finish} {...revealProps(closingSeen, reduced, 0.24)}>{action}<ArrowRight size={18} aria-hidden="true" /></motion.button>
      {!embedded && <motion.nav className="fb-onboarding-legal" aria-label="Legal" {...revealProps(closingSeen, reduced, 0.32)}><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/community-guidelines">Community guidelines</Link></motion.nav>}
    </section>
  </div>;
}
