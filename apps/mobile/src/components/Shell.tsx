import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Link, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, BarChart3, Bell, Bookmark, ClipboardList, Heart, Home, MessageCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, UserRound, type LucideIcon } from "lucide-react";
import { Focusable, Tooltip, TooltipTrigger } from "react-aria-components";
import { TabTapProvider, useTabTap } from "./TabTap";
import { LiveRegion } from "./LiveRegion";
import { MEDIUM_MAX_PX, READABLE_COLUMN_CLASS, useViewportWidth, WIDE_CANVAS_CLASS } from "./responsive";
import { useNavLayout } from "./navLayout";
import { loadAppearance, saveAppearance, type NavLayout } from "../appearance";
import { RouteTransition } from "./RouteTransition";
import { requestHistorySuppression } from "./backNavigation";
import { NavigationSetup } from "./NavigationSetup";
import { RoleOfferNotice } from "./RoleOfferNotice";
import { AccountMenu } from "./AccountMenu";
import {
  fadeUpVariants,
  fadeVariants,
  motionDurations,
  motionEasings,
  motionSprings,
  pressFeedback,
} from "./uiMotion";
import "./Shell.nav.css";

/** Router link with framer press gestures (motion pass: always animated). */
const MotionLink = motion.create(Link);

/**
 * The rail's destinations, in the order `docs/design/nav/prototype.html` puts
 * them: the work you came to do first, then the secondary shelves under a
 * named group. The phone bar keeps its own four-destination list below; a
 * nine-item pill on a 320px screen would be a row of glyphs.
 */
const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/my", label: "My Reports", icon: ClipboardList },
  { to: "/search", label: "Search", icon: Search },
  { to: "/chats", label: "Chats", icon: MessageCircle },
  { to: "/notifications", label: "Activity", icon: Bell },
  { to: "/insights", label: "Insights", icon: BarChart3 },
] as const;

/** The prototype's `Others` group. Every row lands on a surface that exists. */
const NAV_OTHERS = [
  { to: "/search?scope=people", label: "Connect", icon: UserRound },
  { to: "/reactions", label: "Liked / Disliked", icon: Heart },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/settings/returns", label: "Recovered", icon: Archive },
] as const;

/**
 * The bottom bar stays four destinations plus the create action, which is what
 * the same prototype draws for a phone. Send and Settings both open from the
 * account control or the route header, so the bar stays scannable.
 */
const BAR_NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/my", label: "My Reports", icon: ClipboardList },
  { to: "/chats", label: "Chats", icon: MessageCircle },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

const HIDE_NAV = ["/help", "/posts/", "/ai-connection", "/connections/", "/chats/"];

/**
 * Surfaces designed for a wide canvas (packet `09` §1/§2/§21).
 *
 * The shell used to clamp every screen to a 448px phone column. The feed
 * surfaces now use the canvas and grow more masonry columns; every other route
 * keeps the readable column so a tablet does not stretch paragraphs. A route
 * joins this set when it has actually been laid out for wide viewports — no
 * screen ever gets a wide layout nobody designed.
 */
const WIDE_CANVAS = ["/", "/search", "/chats", "/connections", "/my"];

/** The document never scrolls: routes own the bounded viewport scroller. */
export function Shell() {
  const { pathname } = useLocation();
  const width = useViewportWidth();
  const chatThread = pathname.startsWith("/chats/") || pathname.startsWith("/connections/");
  const showNav = chatThread ? width >= MEDIUM_MAX_PX : !HIDE_NAV.some((p) => pathname.startsWith(p));
  const settingsRoute = pathname === "/settings" || pathname.startsWith("/settings/");
  const wideCanvas = WIDE_CANVAS.includes(pathname) || chatThread || settingsRoute;
  const ownsInternalScroll =
    settingsRoute || pathname === "/" || pathname === "/search" || pathname.startsWith("/help") || pathname.startsWith("/connections") || pathname.startsWith("/chats");
  // Owner ruling 4(e): the stored preference only becomes a side rail at the
  // compact breakpoint and up. The rail is an in-flow sibling of the content,
  // so it takes layout space and never covers what the reader is reading.
  const navLayout = useNavLayout();
  const rail = navLayout === "rail";
  const column = wideCanvas ? WIDE_CANVAS_CLASS : READABLE_COLUMN_CLASS;

  // A breakpoint flip replaces the whole navigation. The element that had focus
  // unmounts, so focus would otherwise fall to <body> and the next Tab would
  // restart at the top of the page; remember the focused destination and hand
  // focus to the same destination in the new layout.
  const focusedNavHref = useRef<string | null>(null);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const link = (event.target as Element | null)?.closest?.(
        'nav[aria-label="Primary"] a[href]',
      );
      focusedNavHref.current = link ? link.getAttribute("href") : null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  useEffect(() => {
    const href = focusedNavHref.current;
    // Only when the flip actually dropped focus (the old nav is gone).
    if (!href || document.activeElement !== document.body) return;
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const target = Array.from(
      nav?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
    ).find((link) => link.getAttribute("href") === href);
    target?.focus();
  }, [navLayout]);

  return (
    <TabTapProvider>
      <div
        className={`fb-app-viewport flex w-full bg-surface text-on-surface ${
          rail ? "flex-row" : `mx-auto flex-col ${column}`
        }`}
      >
        {/* Wave A: route-driven nav hide/show slides+fades (short, transform/
            opacity only) instead of an instant unmount. AnimatePresence keeps
            the exiting nav in flow until its exit finishes, so route content
            does not jump mid-animation; once exited the nav is unmounted and
            therefore non-focusable / absent from the accessibility tree.

            A layout flip is NOT an exit: the two layouts are children of
            opposite flex contexts (row before <main>, column after it), so an
            exiting nav would stay in flow inside the *new* direction — a
            104×320px column above the content, or <main> squeezed to ~300px.
            Keying each boundary on the resolved layout remounts it on the
            flip, which drops the old nav in the same commit that flips the
            container: one paint, one nav, no intermediate geometry. Route
            hide/show inside a layout still animates because that key is
            stable. */}
        <AnimatePresence key={`fb-rail-boundary-${navLayout}`} initial={false}>
          {showNav && rail && <PrimaryNav key="fb-rail-nav" layout="rail" />}
        </AnimatePresence>
        <main
          className={`relative min-h-0 flex-1 ${rail ? `min-w-0 ${column}` : ""} ${
            ownsInternalScroll ? "overflow-hidden" : "overflow-y-auto"
          }`}
        >
          <div className="flex h-full min-h-0 flex-col">
            {showNav && <NavigationSetup />}
            {showNav && <RoleOfferNotice />}
            {/* One top bar per route: the route owns it (AppBar / HomeTopBar /
                SettingsPage / the conversation header). The shell never stacks
                a second global utility strip above it. */}
            <div className="min-h-0 flex-1"><RouteTransition /></div>
          </div>
        </main>
        <AnimatePresence key={`fb-bottom-boundary-${navLayout}`} initial={false}>
          {showNav && !rail && <PrimaryNav key="fb-bottom-nav" layout="bottom" />}
        </AnimatePresence>
        <LiveRegion />
      </div>
    </TabTapProvider>
  );
}

/**
 * The one primary navigation, rendered as a bottom bar or a side rail.
 *
 * Both layouts share destinations, selection and create action. Notifications
 * belong to TopUtilities, never this list. `activePath` allows a deterministic
 * visual fixture; normal navigation is router-owned.
 */
export function PrimaryNav({
  layout = "bottom",
  activePath,
  layoutScope = "shell",
}: {
  layout?: NavLayout;
  activePath?: string;
  /**
   * Identity for the selected-pill `layoutId`. Framer treats one `layoutId` as
   * ONE shared element, so several `PrimaryNav` copies on one page (the visual
   * fixture renders five) steal the pill from each other and the fill goes
   * missing. The app has a single nav, so the default is one scope; the fixture
   * gives each demo its own.
   */
  layoutScope?: string;
}) {
  const { notifyTabTap } = useTabTap();
  const { pathname, search } = useLocation();
  // The pin is read once and written on press rather than through
  // `useAppearance`: that hook re-applies the whole stored appearance on every
  // appearance event, which would fight the fixture's page-wide text scale.
  const [railPinnedState, setRailPinnedState] = useState(() => loadAppearance().railPinned);
  const toggleRailPin = () => {
    const next = !railPinnedState;
    setRailPinnedState(next);
    saveAppearance({ ...loadAppearance(), railPinned: next });
  };
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const isEditable = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !el.isContentEditable) return false;
      return !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled;
    };
    const update = () => {
      // The visual viewport shrinks when the on-screen keyboard opens. Keep
      // the bottom bar out of its way; do not infer keyboard state from scroll.
      // Android's WebView resizes the layout viewport instead (adjustResize),
      // so visualViewport never differs from innerHeight there and the bar sat
      // on top of the focused field. A focused editable field is the reliable
      // keyboard signal on that platform.
      const viewportShrank = !!window.visualViewport &&
        window.innerHeight - window.visualViewport.height > 120;
      // Same tolerant read as applicationAi: a host without the platform id
      // is simply not Android, never a crash in the shell's keyboard probe.
      const androidKeyboard = Capacitor.getPlatform?.() === "android" && isEditable();
      setKeyboardOpen(viewportShrank || androidKeyboard);
      setFullscreen(!!document.fullscreenElement);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  const rail = layout === "rail";
  // The bottom bar sits where the keyboard appears, so it yields that space.
  // The rail is a column beside the content: the keyboard cannot cover it, and
  // hiding it would widen <main> by 6.5rem and pull it back, so it stays.
  if (fullscreen || (keyboardOpen && !rail)) return null;

  const belongsTo = (root: string) => pathname === root || pathname.startsWith(`${root}/`);
  // Search and Connect share one route and differ by scope, so the selection
  // cannot be read from the pathname alone. Recovered is a Settings child but a
  // first-class rail destination, so it is claimed before the Settings fallback.
  const peopleScope = new URLSearchParams(search).get("scope") === "people";
  const selectedPath = activePath ?? (belongsTo("/chats") || belongsTo("/connections") ? "/chats"
    : pathname === "/settings/returns" ? "/settings/returns"
    : belongsTo("/settings") || belongsTo("/profile") ? "/settings"
    : belongsTo("/my") ? "/my" : belongsTo("/insights") ? "/insights" : belongsTo("/reactions") ? "/reactions"
    : belongsTo("/saved") ? "/saved" : belongsTo("/notifications") ? "/notifications"
    : pathname === "/search" ? (peopleScope ? "/search?scope=people" : "/search") : pathname);

  const createAction = (
    <Link to="/report" aria-label="Create report" className="fb-nav-create bg-primary text-on-primary">
      <Plus size={26} aria-hidden="true" />
    </Link>
  );

  const railPinned = rail && railPinnedState;
  const renderDestination = ({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) => {
    const selected = selectedPath === to;
    const link = (
      <MotionLink
        key={to}
        to={to}
        aria-label={selected ? undefined : label}
        aria-current={selected ? "page" : undefined}
        onClick={() => {
          if (selected) {
            notifyTabTap();
            if (to === "/") requestHistorySuppression("/");
          }
        }}
        whileTap={pressFeedback.iconButton}
        transition={{ duration: motionDurations.instant }}
        className={`fb-nav-link ${selected ? "fb-nav-link-active text-on-primary-container" : "text-on-surface-variant"}`}
      >
        {selected && (
          <motion.span
            // One layout id per layout AND per mounted nav: a rail and a bar
            // briefly coexist at the breakpoint, and repeated fixture demos
            // would otherwise share (and lose) the pill.
            layoutId={`fb-nav-active-${layout}-${layoutScope}`}
            className="fb-nav-active-bg bg-primary-container"
            transition={motionSprings.snappy}
            aria-hidden="true"
          />
        )}
        <Icon
          size={22}
          strokeWidth={selected ? 2.5 : 2}
          className="fb-nav-icon"
          aria-hidden="true"
        />
        {rail && !railPinned ? (
          // Compact icon rail: accessible name always present; React Aria
          // exposes the same name visually on hover AND keyboard focus.
          <span className="fb-nav-label sr-only">{label}</span>
        ) : railPinned ? (
          // Pinned panel: every destination is named in place, selected or not.
          <span className="fb-nav-label">{label}</span>
        ) : (
          <AnimatePresence initial={false}>
            {selected && (
              <motion.span
                key="fb-nav-label"
                className="fb-nav-label"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: motionDurations.fast }}
                style={{ overflow: "hidden", whiteSpace: "nowrap" }}
              >{label}</motion.span>
            )}
          </AnimatePresence>
        )}
      </MotionLink>
    );
    // A pinned panel names every row in place, so a hover tooltip would repeat
    // what is already on screen.
    if (railPinned) return link;
    return <TooltipTrigger key={to} delay={350}>
      <Focusable>{link}</Focusable><Tooltip placement={rail ? "right" : "top"} className="fb-nav-tooltip">{label}</Tooltip>
    </TooltipTrigger>;
  };

  const railPrimary = NAV.map(renderDestination);
  const railOthers = NAV_OTHERS.map(renderDestination);
  const barItems = BAR_NAV.map(renderDestination);

  if (rail) {
    return (
      <motion.nav
        aria-label="Primary"
        data-layout="rail"
        data-pinned={railPinned ? "true" : "false"}
        className="fb-nav-rail shrink-0"
        variants={fadeVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
      >
        <div className="fb-nav-rail-head">
          {railPinned && <span className="fb-nav-wordmark">Norfold</span>}
          <button type="button" className="fb-nav-pin" aria-pressed={railPinned}
            aria-label={railPinned ? "Collapse navigation" : "Expand navigation"}
            onClick={toggleRailPin}>
            {railPinned ? <PanelLeftClose size={20} aria-hidden="true" /> : <PanelLeftOpen size={20} aria-hidden="true" />}
          </button>
        </div>
        <motion.div className="fb-nav-create-wrap" whileTap={pressFeedback.iconButton}>
          {createAction}
        </motion.div>
        {/* The rail scrolls, the identity control never does: Settings lives
            inside that control (R1), so it has to stay reachable however many
            destinations the rail carries. */}
        <div className="fb-nav-rail-scroll">
          <div className="fb-nav-rail-list">{railPrimary}</div>
          <div className="fb-nav-rail-group">
            {railPinned && <span className="fb-nav-rail-section">Others</span>}
            <div className="fb-nav-rail-list">{railOthers}</div>
          </div>
        </div>
        <AccountMenu />
      </motion.nav>
    );
  }

  return (
    <motion.nav
      aria-label="Primary"
      data-layout="bottom"
      className="fb-nav-slot shrink-0"
      variants={fadeUpVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
    >
      <div className="fb-nav-row">
        <div className="fb-nav-pill">{barItems}</div>
        <motion.div className="fb-nav-create-wrap" whileTap={pressFeedback.iconButton}>
          {createAction}
        </motion.div>
      </div>
    </motion.nav>
  );
}
