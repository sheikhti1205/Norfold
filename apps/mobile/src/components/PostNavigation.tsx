import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";
import { Link, useLocation, useNavigate, type LinkProps, type Location } from "react-router";

/** UI navigation only; the auth provider and route guards remain authoritative. */
const PostNavigationContext = createContext<string | null>(null);
export const PostNavigationProvider = PostNavigationContext.Provider;

function isBackgroundPath(path: string): boolean {
  return ["/", "/search", "/my", "/saved", "/notifications"].includes(path) || /^\/u\/[A-Za-z0-9_]+$/.test(path);
}

function isReportPath(path: string): boolean {
  return /^\/posts\/[^/]+$/.test(path);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** History state is untrusted, and may belong to a previous signed-in account. */
export function postBackgroundLocation(location: Location, viewerId: string | null): Location | null {
  if (!viewerId || !isReportPath(location.pathname) || !record(location.state)) return null;
  const background = location.state.postBackground;
  if (!record(background) || background.viewerId !== viewerId || !record(background.location)) return null;
  const source = background.location;
  if (typeof source.pathname !== "string" || !isBackgroundPath(source.pathname) ||
    typeof source.search !== "string" || typeof source.hash !== "string" || typeof source.key !== "string") return null;
  return source as unknown as Location;
}

/**
 * The page a report opens over.
 *
 * `PostLink` describes that page in history state. A plain link or an
 * imperative navigate cannot, and without a background the router renders the
 * standalone detail page, so the same report looked different depending on
 * which surface linked to it. On a wide viewport the viewer therefore falls
 * back to the last app page the reader was on. Report routes are never used as
 * a background (that would stack two viewers), a cold entry has no page to
 * float over, and phones keep the standalone page exactly like `PostLink`.
 */
export function useReportViewerBackground(location: Location, viewerId: string | null): Location | null {
  const lastPage = useRef<Location | null>(null);
  const report = isReportPath(location.pathname);
  // Recorded after the page commits, never during render: a render React
  // throws away must not become the background of a later report.
  useLayoutEffect(() => {
    if (!report) lastPage.current = location;
  }, [location, report]);
  const stated = postBackgroundLocation(location, viewerId);
  if (stated) return stated;
  if (!viewerId || !report || window.innerWidth < 768) return null;
  return lastPage.current;
}

/**
 * Same contextual destination as the title link, for tap targets that cannot
 * be links (a photo region that also owns a horizontal swipe gesture).
 * Returns the report URL so the caller keeps the label/route ownership.
 */
export function useReportNavigation(): (to: string) => void {
  const location = useLocation();
  const navigate = useNavigate();
  const viewerId = useContext(PostNavigationContext);
  return useCallback((to: string) => {
    if (viewerId && window.innerWidth >= 768) {
      const background = postBackgroundLocation(location, viewerId) ?? (isBackgroundPath(location.pathname) ? location : null);
      if (background) {
        void navigate(to, { preventScrollReset: true,
          state: { postBackground: { location: background, viewerId } } });
        return;
      }
    }
    void navigate(to);
  }, [location, navigate, viewerId]);
}

/** Normal links/new tabs remain real report URLs; only same-tab wide navigation is contextual. */export function PostLink({ onClick, ...props }: LinkProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const viewerId = useContext(PostNavigationContext);
  return <Link {...props} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      props.reloadDocument || props.download || (props.target && props.target !== "_self") || !viewerId || window.innerWidth < 768) return;
    const background = postBackgroundLocation(location, viewerId) ?? (isBackgroundPath(location.pathname) ? location : null);
    if (!background) return;
    event.preventDefault();
    void navigate(props.to, { replace: props.replace, relative: props.relative, preventScrollReset: true,
      state: { ...(record(props.state) ? props.state : {}), postBackground: { location: background, viewerId } },
    });
  }} />;
}
