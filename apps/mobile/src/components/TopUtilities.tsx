import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Bell, Plus, Search } from "lucide-react";
import { useAuth } from "../auth";
import { NotificationPopover } from "./NotificationPopover";
import { COMPACT_MAX_PX, useViewportWidth } from "./responsive";
import { useStoredNavLayout } from "./navLayout";
import { toggleGlobalSearch, useGlobalSearchOpen } from "./globalSearch";
import { fetchUnreadCount } from "../services/notifications";
import { INBOX_CHANGED_EVENT } from "../services/notificationSignals";
import { onRealtime } from "../services/realtime";
import { PUSH_RECEIVED_EVENT } from "../services/pushNotifications";
import "./adaptiveFoundation.css";

interface TopUtilitiesProps {
  showSearch?: boolean;
  liveBadge?: boolean;
  unreadCount?: number;
  account?: ReactNode;
}

/** One notification utility and unread-count owner, shared by Shell and Home.
 * Replacement accounts never inherit a badge, request or open private layer. */
export function TopUtilities({ liveBadge = true, ...props }: TopUtilitiesProps) {
  const { user } = useAuth();
  return <AccountTopUtilities key={user?.id ?? "signed-out"} {...props} liveBadge={liveBadge && !!user} allowPreview={!!user} />;
}

function AccountTopUtilities({ showSearch = true, liveBadge, unreadCount, account, allowPreview }: TopUtilitiesProps & { allowPreview: boolean }) {
  const width = useViewportWidth();
  const rail = useStoredNavLayout() === "rail";
  const location = useLocation();
  const searchOpen = useGlobalSearchOpen();
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    if (!liveBadge) return;
    let cancelled = false;
    let request = 0;
    const pull = () => {
      const current = ++request;
      fetchUnreadCount().then(
        (count) => { if (!cancelled && current === request) setUnread(count); },
        () => { if (!cancelled && current === request) setUnread(null); },
      );
    };
    pull();
    const onFocus = () => pull();
    const onVisibility = () => { if (document.visibilityState === "visible") pull(); };
    const offInbox = onRealtime("notification:added", pull);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(PUSH_RECEIVED_EVENT, pull);
    window.addEventListener(INBOX_CHANGED_EVENT, pull);
    return () => {
      cancelled = true;
      offInbox();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(PUSH_RECEIVED_EVENT, pull);
      window.removeEventListener(INBOX_CHANGED_EVENT, pull);
    };
  }, [liveBadge]);
  const count = unreadCount ?? unread;
  const bell = <><Bell size={20} aria-hidden="true" />
    {count !== null && count > 0 && <span aria-hidden="true" data-testid="notifications-unread-badge" className="fb-notification-badge bg-error text-on-error">{count > 99 ? "99+" : count}</span>}
  </>;
  return <nav aria-label="App utilities" className="fb-top-utilities">
    {showSearch && <button type="button" aria-label="Search" aria-expanded={searchOpen}
      className="fb-icon-control" onClick={(event) => toggleGlobalSearch(event.currentTarget)}>
      <Search size={20} aria-hidden="true" />
    </button>}
    {/* The rail has no create button (owner order 2026-11-13). On that layout
        the action lives here, beside the bell, as an icon at the same weight as
        its neighbours; phones keep the floating + in the bottom bar and must
        not show a second one. */}
    {rail && <Link to="/report" aria-label="Create report" className="fb-icon-control">
      <Plus size={20} aria-hidden="true" />
    </Link>}
    {allowPreview && width >= COMPACT_MAX_PX && location.pathname !== "/notifications"
      ? <NotificationPopover key={location.key} trigger={bell} />
      : <Link to="/notifications" aria-label="Notifications" className="fb-icon-control relative">{bell}</Link>}
    {account}
  </nav>;
}
