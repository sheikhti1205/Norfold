import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { Link, UNSAFE_NavigationContext, useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, BarChart3, Bell, Bookmark, ClipboardList, Heart, Home, Menu, MessageCircle, Plus, Search, Settings as SettingsIcon, UserRound, X, type LucideIcon } from "lucide-react";
import { Focusable, Tooltip, TooltipTrigger } from "react-aria-components";
import { TabTapProvider, useTabTap } from "./TabTap";
import { LiveRegion } from "./LiveRegion";
import { MEDIUM_MAX_PX, READABLE_COLUMN_CLASS, useViewportWidth, useWideViewport, WIDE_CANVAS_CLASS } from "./responsive";
import { InlineRailProvider, useNavLayout } from "./navLayout";
import { clampRailWidth, loadAppearance, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN, RAIL_WIDTH_STEP, saveAppearance, type NavLayout } from "../appearance";
import { RouteTransition } from "./RouteTransition";
import { requestHistorySuppression } from "./backNavigation";
import { NavigationSetup } from "./NavigationSetup";
import { RoleOfferNotice } from "./RoleOfferNotice";
import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./BrandMark";
import { useHoverLabel } from "./HoverLabel";
import { SettingsWindow } from "./SettingsWindow";
import { GlobalSearchOverlay } from "./GlobalSearchOverlay";
import { openGlobalSearch, toggleGlobalSearch, useGlobalSearchOpen } from "./globalSearch";
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
/**
 * One row that opens the shared search overlay instead of navigating: search
 * is not a destination (SPEC §1), while `/search` survives as a deep link.
 */
type NavRow =
  | { to: string; label: string; icon: LucideIcon; search?: false }
  | { label: string; icon: LucideIcon; search: true };

const NAV: readonly NavRow[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/my", label: "My Reports", icon: ClipboardList },
  { label: "Search", icon: Search, search: true },
  { to: "/chats", label: "Chats", icon: MessageCircle },
  { to: "/notifications", label: "Activity", icon: Bell },
  { to: "/insights", label: "Insights", icon: BarChart3 },
];

/** The prototype's `Others` group. Every row lands on a surface that exists. */
const NAV_OTHERS = [
  { to: "/search?scope=people", label: "People", icon: UserRound },
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
 * The floating settings window's path for a rendered link, or null.
 *
 * The app is a hash router, so React Router renders `href="#/settings/..."`,
 * while hand-written anchors use the plain path. Both have to resolve to the
 * same window entry. The owner's profile is part of that surface: a `/profile`
 * link opens the window instead of replacing the page behind it.
 */
function settingsPathFromHref(href: string | null): string | null {
  if (!href) return null;
  let path = href;
  if (path.startsWith("#")) path = path.slice(1);
  else if (/^[a-z]+:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.origin !== window.location.origin) return null;
      path = url.hash ? url.hash.slice(1) : url.pathname;
    } catch {
      return null;
    }
  }
  if (path === "/settings" || path.startsWith("/settings/") || path.startsWith("/settings?")) return path;
  // Profile is part of the same floating surface (owner order 2026-11-13).
  if (path === "/profile" || path.startsWith("/profile/") || path.startsWith("/profile?")) return path;
  return null;
}

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
  const { pathname, state: locationState } = useLocation();
  const width = useViewportWidth();
  const chatThread = pathname.startsWith("/chats/") || pathname.startsWith("/connections/");
  const showNav = chatThread ? width >= MEDIUM_MAX_PX : !HIDE_NAV.some((p) => pathname.startsWith(p));
  const wideCanvas = WIDE_CANVAS.includes(pathname) || chatThread;
  const ownsInternalScroll =
    pathname === "/" || pathname === "/search" || pathname.startsWith("/help") || pathname.startsWith("/connections") || pathname.startsWith("/chats");
  // Owner ruling 4(e): the stored preference is the reader's navigation style.
  // `auto` turns into the rail only where a side column fits. A chosen rail is
  // honoured on a phone too, where `Shell` renders it as a temporary overlay
  // drawer instead of a permanently open column.
  const navLayout = useNavLayout();
  const wideViewport = useWideViewport();
  const rail = navLayout === "rail";
  const railDrawer = rail && !wideViewport;
  const inlineRail = rail && !railDrawer;
  const [railOpen, setRailOpen] = useState(false);
  const railTrigger = useRef<HTMLButtonElement>(null);
  const closeRail = useCallback((restoreFocus = true) => {
    setRailOpen(false);
    if (restoreFocus) railTrigger.current?.focus({ preventScroll: true });
  }, []);
  // A temporary drawer is open for one decision, not for a session: following a
  // destination, changing route, Escape or a backdrop press closes it.
  useEffect(() => { setRailOpen(false); }, [pathname]);
  useEffect(() => {
    if (!railOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRail();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [railOpen, closeRail]);
  useEffect(() => {
    if (!railOpen) return;
    const first = document.querySelector<HTMLElement>("[data-nav-drawer-close]");
    first?.focus({ preventScroll: true });
  }, [railOpen]);
  const column = wideCanvas ? WIDE_CANVAS_CLASS : READABLE_COLUMN_CLASS;
  const navigate = useNavigate();
  // `null` = closed. A string is the settings section the window opens at, so a
  // menu row or an in-app link lands inside the window rather than swapping the
  // page behind it.
  const [settingsWindow, setSettingsWindow] = useState<{ path: string; id: number } | null>(null);
  const settingsWindowId = useRef(0);
  const openSettingsWindow = useCallback((path = "/settings") => {
    setSettingsWindow({ path, id: ++settingsWindowId.current });
  }, []);
  const navigationContext = useContext(UNSAFE_NavigationContext);
  const windowNavigation = useMemo(() => {
    const navigator = navigationContext.navigator;
    const intercept = (to: Parameters<typeof navigator.push>[0]) => {
      const path = typeof to === "string" ? to : `${to.pathname ?? ""}${to.search ?? ""}${to.hash ?? ""}`;
      if (!(path === "/settings" || path.startsWith("/settings/") || path.startsWith("/settings?") || path.startsWith("/settings#"))) return false;
      openSettingsWindow(path);
      return true;
    };
    return {
      ...navigationContext,
      navigator: {
        ...navigator,
        push: (...args: Parameters<typeof navigator.push>) => {
          if (!intercept(args[0])) navigator.push(...args);
        },
        replace: (...args: Parameters<typeof navigator.replace>) => {
          if (!intercept(args[0])) navigator.replace(...args);
        },
      },
    };
  }, [navigationContext, openSettingsWindow]);
  const searchOpen = useGlobalSearchOpen();

  // Typing anywhere that is not a field opens the one search surface with that
  // first character, so search never needs the reader to aim at an icon first.
  // A report surface takes the keystroke for its comment box before this runs
  // (its capture handler calls preventDefault), and an open layer keeps its own
  // typing.
  useEffect(() => {
    if (searchOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key === "Process") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1 || event.key === " ") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      openGlobalSearch(document.activeElement, event.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

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

  // Settings is a window, not a page swap: an in-app link to any settings
  // destination, or to the owner's profile, opens the window over what the
  // reader is looking at instead of replacing it. This is the one interception
  // point, so a link added anywhere in the app cannot regress into a separate
  // settings page. Links inside the window are excluded (they use its own
  // router).
  useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || anchor.closest(".fb-settings-window")) return;
      const path = settingsPathFromHref(anchor.getAttribute("href"));
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      openSettingsWindow(path);
    };
    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [openSettingsWindow]);

  // Owner order 2026-11-14: settings is a window, never a page. A retired
  // `/settings...` address is redirected to Home by the app route, which hands
  // the exact destination over as navigation state; the window opens here and
  // the state is cleared, so the address settles on plain Home.
  const settingsDeepLink = (locationState as { settingsWindowPath?: unknown } | null)?.settingsWindowPath;
  useLayoutEffect(() => {
    if (typeof settingsDeepLink !== "string") return;
    openSettingsWindow(settingsDeepLink);
    navigate("/", { replace: true, state: null });
  }, [settingsDeepLink, navigate, openSettingsWindow]);

  return (
    <InlineRailProvider show={inlineRail && showNav}>
    <UNSAFE_NavigationContext.Provider value={windowNavigation}>
    <TabTapProvider>
      <div
        data-global-search={searchOpen ? "true" : undefined}
        className={`fb-app-viewport flex w-full bg-surface text-on-surface ${
          inlineRail ? "flex-row" : `mx-auto flex-col ${column}`
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
          {showNav && inlineRail && <PrimaryNav key="fb-rail-nav" layout="rail" onOpenSettings={openSettingsWindow} />}
        </AnimatePresence>
        <main
          className={`relative min-h-0 flex-1 ${inlineRail ? `min-w-0 ${column}` : ""} ${
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
        {/* A chosen side rail on a phone is a temporary drawer, never a column
            that steals width from a 320px screen. The trigger stays available
            at the bottom edge (where the bottom bar would sit) and the panel
            closes on a destination, Escape, the backdrop or a route change. */}
        {showNav && railDrawer && (
          <>
            <button
              ref={railTrigger}
              type="button"
              className="fb-nav-drawer-trigger"
              aria-label="Open navigation"
              aria-haspopup="dialog"
              aria-expanded={railOpen}
              onClick={() => setRailOpen(true)}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
            <AnimatePresence>
              {railOpen && (
                <motion.div
                  key="fb-rail-drawer"
                  className="fb-nav-drawer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: motionDurations.fast }}
                >
                  <div className="fb-nav-drawer-backdrop" aria-hidden="true" onClick={() => closeRail()} />
                  <motion.div
                    className="fb-nav-drawer-panel"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Navigation"
                    initial={{ x: "-100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "-100%" }}
                    transition={{ duration: motionDurations.standard, ease: motionEasings.out }}
                  >
                    <PrimaryNav layout="rail" drawer onCloseDrawer={() => closeRail()}
                      onOpenSettings={openSettingsWindow} />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <AnimatePresence key={`fb-bottom-boundary-${navLayout}`} initial={false}>
          {showNav && !rail && <PrimaryNav key="fb-bottom-nav" layout="bottom" onOpenSettings={openSettingsWindow} />}
        </AnimatePresence>
        <LiveRegion />
        <SettingsWindow key={settingsWindow?.id} open={settingsWindow !== null} initialPath={settingsWindow?.path ?? "/settings"}
          onClose={() => setSettingsWindow(null)}
          onExit={(path) => { setSettingsWindow(null); navigate(path); }} />
        <GlobalSearchOverlay />
      </div>
    </TabTapProvider>
    </UNSAFE_NavigationContext.Provider>
    </InlineRailProvider>
  );
}

/**
 * The one primary navigation, rendered as a bottom bar or a side rail.
 *
 * Both layouts share destinations and selection. The rail no longer carries the
 * large create button: it moved beside the bell in TopUtilities, so the phone
 * bar keeps its floating + and the rail head is the app mark that pins the
 * column. Notifications belong to TopUtilities, never this list. `activePath`
 * allows a deterministic visual fixture; normal navigation is router-owned.
 */
export function PrimaryNav({
  layout = "bottom",
  activePath,
  layoutScope = "shell",
  drawer = false,
  onOpenSettings,
  onCloseDrawer,
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
  /** Narrow-viewport overlay: named rows, a close control and no resize grip. */
  drawer?: boolean;
  /** Opens the floating settings window from the account menu, at `path`. */
  onOpenSettings?: (path?: string) => void;
  /** Closes the temporary drawer; the shell owns focus restoration. */
  onCloseDrawer?: () => void;
}) {
  const { notifyTabTap } = useTabTap();
  const { pathname, search } = useLocation();
  const searchOpen = useGlobalSearchOpen();
  // One pointer-only naming gesture for the rail and the phone bar's create
  // action. The panel still expands after two seconds; the shared pill only
  // answers "what is this icon?" and hides the moment the panel names rows in
  // place. Keyboard focus keeps the in-place expansion, so assistive tech never
  // waits on a hover.
  const { hoverLabel, dismissHoverLabel } = useHoverLabel();
  // The pin is read once and written on press rather than through
  // `useAppearance`: that hook re-applies the whole stored appearance on every
  // appearance event, which would fight the fixture's page-wide text scale.
  const [railPinnedState, setRailPinnedState] = useState(() => loadAppearance().railPinned);
  const toggleRailPin = () => {
    const next = !railPinnedState;
    setRailPinnedState(next);
    saveAppearance({ ...loadAppearance(), railPinned: next });
  };
  // Owner order 2026-11-13: the pinned sidebar is resizable. The width lives in
  // the same device-local appearance store as the pin, so it survives reloads
  // and never syncs to the account. The account menu reads it from the root CSS
  // variable because its popover is portalled out of the rail's subtree.
  const [railWidthState, setRailWidthState] = useState(() => loadAppearance().railWidth);
  const railWidthRef = useRef(railWidthState);
  railWidthRef.current = railWidthState;
  const railDrag = useRef<{ startX: number; startWidth: number } | null>(null);
  const commitRailWidth = (next: number) => {
    const clamped = clampRailWidth(next);
    setRailWidthState(clamped);
    saveAppearance({ ...loadAppearance(), railWidth: clamped });
  };
  useEffect(() => {
    document.documentElement.style.setProperty("--fb-rail-w", `${railWidthState}px`);
  }, [railWidthState]);
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    railDrag.current = { startX: event.clientX, startWidth: railWidthRef.current };
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = railDrag.current;
    if (!start) return;
    setRailWidthState(clampRailWidth(start.startWidth + event.clientX - start.startX));
  };
  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = railDrag.current;
    if (!start) return;
    railDrag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    commitRailWidth(start.startWidth + event.clientX - start.startX);
  };
  const onResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? RAIL_WIDTH_STEP * 2 : RAIL_WIDTH_STEP;
    if (event.key === "ArrowLeft") { event.preventDefault(); commitRailWidth(railWidthRef.current - step); }
    else if (event.key === "ArrowRight") { event.preventDefault(); commitRailWidth(railWidthRef.current + step); }
    else if (event.key === "Home") { event.preventDefault(); commitRailWidth(RAIL_WIDTH_MIN); }
    else if (event.key === "End") { event.preventDefault(); commitRailWidth(RAIL_WIDTH_MAX); }
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
  // (This early return sits AFTER every hook in this component: a conditional
  // return above the hover-intent state changed the hook order the moment the
  // keyboard or fullscreen flipped.)

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
    <Link to="/report" aria-label="Create report" className="fb-nav-create bg-primary text-on-primary" {...hoverLabel("Create report")}>
      <Plus size={26} aria-hidden="true" />
    </Link>
  );

  const railPinned = rail && (drawer || railPinnedState);
  // Owner order 2026-11-13: hovering the icon rail must not open the named
  // panel instantly. A press is usually navigation, not a request to see the
  // overlay expanded, so the pointer has to rest for two seconds before the
  // panel opens. Any press inside the rail cancels the pending expansion.
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHoverExpand = useCallback(() => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverExpanded(false);
  }, []);
  const scheduleHoverExpand = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || railPinned || hoverTimer.current !== null) return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      setHoverExpanded(true);
    }, 2000);
  };
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
  }, []);
  useEffect(() => { if (railPinned) cancelHoverExpand(); }, [railPinned, cancelHoverExpand]);
  useEffect(() => {
    if (railPinned || hoverExpanded) dismissHoverLabel();
  }, [railPinned, hoverExpanded, dismissHoverLabel]);
  if (fullscreen || (keyboardOpen && !rail)) return null;
  const renderDestination = (destination: NavRow) => {
    const { label, icon: Icon } = destination;
    const isSearch = destination.search === true;
    const selected = !isSearch && selectedPath === destination.to;
    const body = <>
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
    </>;
    // Search opens the floating overlay; it is a button, not a destination, so
    // no route is ever current for it.
    const trigger = isSearch ? (
      <motion.button
        key={label}
        type="button"
        aria-label={label}
        aria-expanded={searchOpen}
        onClick={(event) => toggleGlobalSearch(event.currentTarget)}
        {...(rail ? hoverLabel(label, "right") : {})}
        whileTap={pressFeedback.iconButton}
        transition={{ duration: motionDurations.instant }}
        className="fb-nav-link text-on-surface-variant"
      >
        {body}
      </motion.button>
    ) : (
      <MotionLink
        key={destination.to}
        to={destination.to}
        aria-label={selected ? undefined : label}
        aria-current={selected ? "page" : undefined}
        {...(rail ? hoverLabel(label, "right") : {})}
        onClick={() => {
          if (selected) {
            notifyTabTap();
            if (destination.to === "/") requestHistorySuppression("/");
          }
        }}
        whileTap={pressFeedback.iconButton}
        transition={{ duration: motionDurations.instant }}
        className={`fb-nav-link ${selected ? "fb-nav-link-active text-on-primary-container" : "text-on-surface-variant"}`}
      >
        {body}
      </MotionLink>
    );
    // The rail names its destinations itself: the fixed hover label above for
    // pointer dwell, and the in-place expansion on hover/focus (plus every
    // pinned row), so a second tooltip would repeat a name that is already on
    // screen. The bottom bar keeps its tooltip: only the selected label there
    // is painted.
    if (rail) return trigger;
    return <TooltipTrigger key={label} delay={350}>
      <Focusable>{trigger}</Focusable><Tooltip placement={rail ? "right" : "top"} className="fb-nav-tooltip">{label}</Tooltip>
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
        data-drawer={drawer ? "true" : undefined}
        data-pinned={railPinned ? "true" : "false"}
        data-hover-expanded={hoverExpanded ? "true" : "false"}
        className="fb-nav-rail shrink-0"
        style={railPinned && !drawer ? { width: railWidthState } : undefined}
        onPointerEnter={scheduleHoverExpand}
        onPointerLeave={() => { cancelHoverExpand(); dismissHoverLabel(); }}
        onPointerDown={() => { cancelHoverExpand(); dismissHoverLabel(); }}
        variants={fadeVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
      >
        <div className="fb-nav-rail-head">
          {drawer ? <>
            {/* A temporary drawer is already named: its head identifies the app
                and offers the one control it needs, a close button. */}
            <span className="fb-nav-brand fb-nav-brand-static">
              <BrandMark size={28} shape="tile" alt="" className="fb-nav-brand-mark" />
              <span className="fb-nav-wordmark">Norfold</span>
            </span>
            <button type="button" className="fb-nav-drawer-close" data-nav-drawer-close
              aria-label="Close navigation" onClick={onCloseDrawer}>
              <X size={20} aria-hidden="true" />
            </button>
          </> : <>
            {/* The app mark is the expand/collapse control (owner order 2026-11-13)
                and sits in the head at every width. The wordmark joins it only
                when the panel is named; collapsed, the app name reads outside
                the rail through `NavOutsideBrand` in the route's own top row
                (Home's feed row, the shared app bar, the Notifications and Saved
                reports headers, owner direction 2026-11-18).
                aria-pressed keeps the control a stateful toggle for assistive
                tech and existing tests. */}
            <button
              type="button"
              className="fb-nav-brand"
              aria-pressed={railPinned}
              aria-label={railPinned ? "Collapse navigation" : "Expand navigation"}
              onClick={toggleRailPin}
            >
              <BrandMark size={28} shape="tile" alt="" className="fb-nav-brand-mark" />
              <span className="fb-nav-wordmark">Norfold</span>
            </button>
          </>}
        </div>
        {/* The rail scrolls, the identity control never does: Settings lives
            inside that control (R1), so it has to stay reachable however many
            destinations the rail carries. */}
        <div className="fb-nav-rail-scroll">
          <div className="fb-nav-rail-list">{railPrimary}</div>
          <div className="fb-nav-rail-group">
            <span className="fb-nav-rail-section">Others</span>
            <div className="fb-nav-rail-list">{railOthers}</div>
          </div>
        </div>
        <AccountMenu onOpenSettings={onOpenSettings} />
        {railPinned && !drawer && <div role="separator" aria-orientation="vertical" aria-label="Resize navigation"
          aria-valuenow={railWidthState} aria-valuemin={RAIL_WIDTH_MIN} aria-valuemax={RAIL_WIDTH_MAX}
          aria-valuetext={`${railWidthState} pixels`} tabIndex={0} className="fb-nav-rail-resize"
          onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd} onKeyDown={onResizeKey} />}
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
