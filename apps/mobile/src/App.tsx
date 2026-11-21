import { createHashRouter, Navigate, Route, RouterProvider, Routes, useLocation, useNavigate, useNavigationType, type Location } from "react-router";
import { MotionConfig } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { AuthProvider } from "./auth";
import { ThemeProvider } from "./theme";
import { motionConfigValueFor, useAppearance } from "./appearance";
import { GuestOnly, OnboardingRoute, RequireAuth } from "./components/Guards";
import { Shell } from "./components/Shell";
import { HoverLabelProvider } from "./components/HoverLabel";
import { BackButtonHandler } from "./components/BackButtonHandler";
import { AccountDeletionFeedback } from "./components/AccountDeletionFeedback";
import { ReportDeletionFeedbackProvider } from "./components/ReportDeletionFeedback";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Splash } from "./screens/Splash";
import { AuthGateway } from "./screens/AuthGateway";
import { CompleteProfileRoute } from "./screens/CompleteProfile";
import { SignIn } from "./screens/SignIn";
import { Register } from "./screens/Register";
import { Verify } from "./screens/Verify";
import { ForgotPassword } from "./screens/ForgotPassword";
import { Recovery } from "./screens/Recovery";
import { CreatePassword } from "./screens/CreatePassword";
import { Home } from "./screens/Home";
import { SearchScreen } from "./screens/SearchScreen";
import { CreateReport } from "./screens/CreateReport";
import { PostDetail } from "./screens/PostDetail";
import { Profile } from "./screens/Profile";
import { ProfileEdit } from "./screens/ProfileEdit";
import { PublicProfile } from "./screens/PublicProfile";
import { About } from "./screens/About";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { DesktopNotifications } from "./components/DesktopNotifications";
import { NativeUpdateLifecycle } from "./services/updates/nativeRuntime";
import { MyPosts } from "./screens/MyPosts";
import { EditReport } from "./screens/EditReport";
import { SavedReports } from "./screens/SavedReports";
import { Insights } from "./screens/Insights";
import { Reactions } from "./screens/Reactions";
import { Help } from "./screens/Help";
import { AiConnection } from "./screens/AiConnection";
import { Notifications } from "./screens/Notifications";
import { CommunityGuidelines, PrivacyPolicy, Terms } from "./screens/Legal";
import { ReportLinkHandler } from "./components/ReportLinkHandler";
import { ChatPushLinkHandler } from "./components/ChatPushLinkHandler";
import { AuthLinkBootstrap } from "./components/AuthLinkBootstrap";
import { SharedReport } from "./screens/SharedReport";
// L-FIXTURE additive-only: deterministic visual preflight route (static,
// network-free). No guards changed; the route mounts no data-bound screens.
import { FixtureRoute } from "./fixture/FixtureRoute";
import { useAuth } from "./auth";
import { SavedReportsProvider } from "./hooks/useSavedReports";
import { Connections, LegacyChatsRedirect, MessagingThread } from "./screens/Messaging";
import { MessagingLifecycle } from "./components/MessagingLifecycle";
import { PostNavigationProvider, postBackgroundLocation } from "./components/PostNavigation";
import { PostModal } from "./components/PostModal";
import { VideoPlayerProvider } from "./components/media/VideoPlayerProvider";
import { SignedOutEntry } from "./screens/RememberedAccounts";
import { clearAuthReturnTo, getAuthReturnRoute, peekAuthReturnTo } from "./utils/authReturnTo";

/** `/posts/<id>` is the one address that is always a report surface. */
const REPORT_PATH = /^\/posts\/[^/]+$/;
/** Pages the popup may float over without borrowing another account's state. */
const BACKGROUND_PATHS = ["/", "/search", "/my", "/saved", "/notifications"];
function isBackgroundPath(pathname: string): boolean {
  return BACKGROUND_PATHS.includes(pathname) || /^\/u\/[A-Za-z0-9_]+$/.test(pathname);
}
/**
 * The feed is the one page the app can always rebuild, so it is what a report
 * opened from a bare URL floats over. No viewer id, no key from another
 * session: just the route the popup's Close returns to.
 */
const FEED_BACKGROUND = { pathname: "/", search: "", hash: "", key: "direct-report-feed", state: null } as const;
function StartScreen() {
  const { user, booting, bootError, needsProfile } = useAuth();
  const location = useLocation();
  if (booting || (bootError && !user)) return <Splash />;
  if (user) return <Shell />;
  if (needsProfile) return <Navigate to="/complete-profile" replace />;
  // An explicit "show me Home" is a presentation choice, not auth authority: it
  // is settled ahead of a protected destination so a signed-out reader can read
  // the public page without losing where they were headed. Only a successful
  // sign-in consumes that destination.
  const showPublic = (location.state as { showPublic?: unknown } | null)?.showPublic === true;
  if (!showPublic && getAuthReturnRoute() !== "/") return <Navigate to="/auth" replace />;
  return <SignedOutEntry />;
}

/**
 * H1-motion: MotionConfig follows the ONE effective motion preference —
 * reduce→always, full→never, system→user (defers to the OS). Reactive via
 * useAppearance, so Quick Appearance changes apply without reload. Gesture
 * tracking stays enabled; only travel/animation degrades.
 */
function AppMotionConfig({ children }: { children: ReactNode }) {
  const { settings } = useAppearance();
  return (
    <MotionConfig reducedMotion={motionConfigValueFor(settings.reduceMotion)}>
      {children}
    </MotionConfig>
  );
}

/**
 * Owner order 2026-11-14: settings is a window, never a page. An old
 * `/settings...` address (typed, refreshed, bookmarked, or restored from a
 * return-to after sign-in) hands its exact destination to Home as navigation
 * state, where Shell opens it in the floating window. The redirect replaces
 * the entry so Back never returns to the retired standalone page.
 *
 * `destination` covers the two legacy AI aliases: they are redirect-only routes
 * too, and leaving them inside Shell left a blank background behind the window.
 */
function SettingsDeepLink({ destination }: { destination?: string } = {}) {
  const { pathname, search, hash } = useLocation();
  return <Navigate to="/" replace state={{ settingsWindowPath: destination ?? `${pathname}${search}${hash}` }} />;
}

// Created once by the entrypoint, outside StrictMode's render cycle. Keep the
// existing descendant route tree; a data router enables supported blockers
// for every navigation source (links, imperative navigation and history POP).
export function createAppRouter() {
  // Direct public links work on the existing hash-routed web/native app.
  // Deliberately do not reinterpret provider callbacks, share paths or queries.
  if (!window.location.hash && ["/privacy", "/terms", "/community-guidelines"].includes(window.location.pathname)) {
    window.history.replaceState(window.history.state, "", `/${window.location.search}#${window.location.pathname}`);
  }
  return createHashRouter([{ path: "*", element: <AppRouteTree /> }]);
}

export function App({ router }: { router: ReturnType<typeof createAppRouter> }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MessagingLifecycle />
        {/* The ONE owner of saved-report state. It lives inside the auth
            provider because a save belongs to an ACCOUNT, and it wraps the
            router so the feed, the detail screen and the saved-reports screen
            all read the same truth. */}
        <SavedReportsProvider>
        <AppMotionConfig>
        {/* One video player for the whole app: it owns the only <video>
            element and moves between the transcript bubble and its overlay. */}
        <VideoPlayerProvider>
        {/* One pointer-only naming pill for the whole app: the provider owns
            the single portal, so no surface grows its own tooltip. */}
        <HoverLabelProvider>
        <RouterProvider router={router} />
        </HoverLabelProvider>
        </VideoPlayerProvider>
        </AppMotionConfig>
        </SavedReportsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function AppRouteTree() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, booting, needsProfile, needsPasswordSetup, passwordSetupSettled } = useAuth();
  useEffect(() => {
    if (user && peekAuthReturnTo() === `${location.pathname}${location.search}${location.hash}`) clearAuthReturnTo();
  }, [user, location.pathname, location.search, location.hash]);
  const reportPath = REPORT_PATH.test(location.pathname);
  const lastPage = useRef<{ location: Location; viewerId: string } | null>(null);
  const previousLocation = useRef<{ location: Location; closesToFeed: boolean } | null>(null);
  const navigationType = useNavigationType();
  const priorPage = user && lastPage.current?.viewerId === user.id ? lastPage.current.location : null;
  const statedBackground = postBackgroundLocation(location, user?.id ?? null);
  const background = reportPath ? statedBackground ?? priorPage ?? FEED_BACKGROUND : null;
  // A history index survives reloads and does not identify the preceding route.
  // Back is safe only when this session observed a push from the background page.
  const historyIndex = (window.history.state as { idx?: unknown } | null)?.idx;
  const closesToFeed = reportPath && (previousLocation.current?.location.key === location.key
    ? previousLocation.current.closesToFeed
    : !(navigationType === "PUSH" && typeof historyIndex === "number" && historyIndex > 0 &&
      previousLocation.current?.location.key === background?.key));
  useLayoutEffect(() => {
    if (user && !reportPath && isBackgroundPath(location.pathname)) {
      lastPage.current = { location, viewerId: user.id };
    }
    previousLocation.current = { location, closesToFeed };
  }, [location, reportPath, user, closesToFeed]);
  if (passwordSetupSettled === false) return <Splash />;
  if (needsPasswordSetup) {
    return location.pathname === "/create-password"
      ? <CreatePassword />
      : <Navigate to="/create-password" replace />;
  }
  return (
    <>
          <AuthLinkBootstrap />
          <ReportLinkHandler />
          <ChatPushLinkHandler />
          <BackButtonHandler />
          <NativeUpdateLifecycle />
          <DesktopNotifications />
          {user && !booting && !needsProfile ? <UpdatePrompt /> : null}
          <ErrorBoundary>
            <AccountDeletionFeedback />
            <ReportDeletionFeedbackProvider>
             <PostNavigationProvider value={user?.id ?? null}>
            <Routes location={background ?? location}>
              <Route path="/shared/:id" element={<SharedReport />} />
              <Route path="/privacy" element={<main className="nf-public-document"><PrivacyPolicy publicView /></main>} />
              <Route path="/terms" element={<main className="nf-public-document"><Terms publicView /></main>} />
              <Route path="/community-guidelines" element={<main className="nf-public-document"><CommunityGuidelines publicView /></main>} />
             <Route path="/" element={<StartScreen />}>
               <Route index element={<Home />} />
             </Route>
            <Route path="/splash" element={<Splash />} />
            <Route path="/onboarding" element={<OnboardingRoute />} />
            <Route
              path="/auth"
              element={
                <GuestOnly>
                  <AuthGateway />
                </GuestOnly>
              }
            />
            <Route
              path="/signin"
              element={
                <GuestOnly>
                  <SignIn />
                </GuestOnly>
              }
            />
            <Route
              path="/register"
              element={
                <GuestOnly>
                  <Register />
                </GuestOnly>
              }
            />
            <Route path="/verify" element={<Verify />} />
            {/* L-FIXTURE additive-only: static visual preflight (no auth).
                FB-AUD-07: dev/audit-only — import.meta.env.DEV is
                statically false in production builds, so the route is
                compiled out of prod while dev + test keep working. */}
            {import.meta.env.DEV ? (
              <Route path="/__fixture" element={<FixtureRoute />} />
            ) : null}
            {/* W0-C (S3) additive-only: social profile completion. Unchanged
                guards everywhere else; the wrapper redirects to /auth when no
                seed is present. */}
            <Route path="/complete-profile" element={<CompleteProfileRoute />} />
            <Route path="/forgot" element={<ForgotPassword />} />
              <Route path="/recovery" element={<Recovery />} />
              <Route path="/create-password" element={<Navigate to="/" replace />} />
              {/* Owner order 2026-11-14: settings is a window, never a page.
                  Every retired `/settings...` address is a replace-redirect to
                  Home; Shell opens the exact destination in the floating
                  window from the state this passes. */}
              <Route path="/settings/*" element={<RequireAuth><SettingsDeepLink /></RequireAuth>} />
              <Route path="/ai-models" element={<RequireAuth><SettingsDeepLink destination="/settings/local-intelligence" /></RequireAuth>} />
              <Route path="/offline-ai" element={<RequireAuth><SettingsDeepLink destination="/settings/local-intelligence" /></RequireAuth>} />
            <Route
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            >
              <Route path="/search" element={<SearchScreen />} />
              <Route path="/report" element={<CreateReport />} />
              <Route path="/posts/:id" element={<PostDetail />} />
              <Route path="/my" element={<MyPosts />} />
              <Route path="/my/:id/edit" element={<EditReport />} />
              <Route path="/saved" element={<SavedReports />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/reactions" element={<Reactions />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/edit" element={<ProfileEdit />} />
              <Route path="/u/:username" element={<PublicProfile />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/chats" element={<Connections />}>
                <Route path=":conversationId" element={<MessagingThread />} />
              </Route>
              <Route path="/connections" element={<LegacyChatsRedirect />} />
              <Route path="/connections/:conversationId" element={<LegacyChatsRedirect />} />
              <Route path="/about" element={<About />} />
              <Route path="/help" element={<Help />} />
              <Route path="/ai-connection" element={<AiConnection />} />
            </Route>
            <Route path="*" element={<Navigate to="/splash" replace />} />
           </Routes>
            {background && <Routes location={location}>
              <Route path="/posts/:id" element={<RequireAuth>
                <PostModal onClose={() => {
                  if (!closesToFeed) { void navigate(-1); return; }
                  void navigate(
                    { pathname: background.pathname, search: background.search, hash: background.hash },
                    { replace: true, state: background.state, preventScrollReset: true },
                  );
                }} />
              </RequireAuth>} />
            </Routes>}
             </PostNavigationProvider>
            </ReportDeletionFeedbackProvider>
          </ErrorBoundary>
    </>
  );
}
