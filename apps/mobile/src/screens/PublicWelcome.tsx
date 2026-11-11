import { useRef } from "react";
import { Link, useNavigate } from "react-router";
import { BrandMark } from "../components/BrandMark";
import { PRODUCT_NAME, WEBSITE_TRANSITION_NOTE } from "../brand";
import { Onboarding } from "./Onboarding";
import "./PublicWelcome.css";

/** Public product explanation, not a fabricated feed or an authentication gate. */
export function PublicWelcome() {
  const navigate = useNavigate();
  const menu = useRef<HTMLDetailsElement>(null);

  function chapter(id: string) {
    if (menu.current) menu.current.open = false;
    const heading = document.getElementById(`${id}-heading`);
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }

  return <div className="nf-public">
    <a className="nf-public-skip" href="#how-it-works" onClick={event => { event.preventDefault(); chapter("how-it-works"); }}>Skip to how it works</a>
    <header className="nf-public-nav">
      <Link className="nf-public-brand" to="/" state={{ showPublic: true }}><BrandMark size={28} alt="" /><span>{PRODUCT_NAME}</span></Link>
      <nav aria-label="Public navigation">
        <span className="nf-public-desktop-links">
          <button onClick={() => chapter("how-it-works")}>How it works</button>
          <button onClick={() => chapter("safety")}>Safety</button>
          <button onClick={() => chapter("about-norfold")}>About</button>
        </span>
        <Link to="/auth">Sign in</Link>
        <details ref={menu} className="nf-public-menu"><summary>Explore</summary><div>
          <button onClick={() => chapter("how-it-works")}>How it works</button>
          <button onClick={() => chapter("safety")}>Safety</button>
          <button onClick={() => chapter("about-norfold")}>About</button>
        </div></details>
      </nav>
    </header>
    <main>
      <Onboarding embedded onComplete={() => navigate("/auth")} />
    </main>
    <footer className="nf-public-footer">
      <span>{PRODUCT_NAME}</span>
      <nav aria-label="Legal and information">
        <Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/community-guidelines">Community Guidelines</Link>
        <button onClick={() => chapter("safety")}>Safety</button><button onClick={() => chapter("about-norfold")}>About</button>
      </nav>
      <p>{WEBSITE_TRANSITION_NOTE}</p>
    </footer>
  </div>;
}
