// @vitest-environment jsdom
/**
 * QA L app-level route matrix: every settings backTo destination mounts under
 * the real <App/> instead of dying on a splash or error screen.
 *
 * Kept in its own file: each settings redirect unmounts and remounts the app
 * shell, and this matrix alone retains enough jsdom/router state to approach the
 * 4 GB fork cap. A separate file starts with a fresh worker heap; the content
 * audits live in QaLSettingsRoutes.test.tsx.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@norfold/shared";

const auth = vi.hoisted(() => ({
  user: null as PublicUser | null,
  booting: false,
  bootError: null as string | null,
  retryBoot: vi.fn(),
}));
const aiCreds = vi.hoisted(() => ({
  get: vi.fn(async () => null as string | null),
  hasSaved: vi.fn(async () => false),
  hasCredential: vi.fn(async () => false),
}));
vi.mock("../auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ ...auth, logout: vi.fn(async () => {}) }),
}));
vi.mock("../theme", async (importOriginal) => ({
  ...await importOriginal<typeof import("../theme")>(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));
vi.mock("../appearance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../appearance")>();
  return {
    ...actual,
    useAppearance: () => ({
      settings: { accent: "emerald", textScale: "standard", reduceMotion: "system", highQualityPhoto: false },
      update: vi.fn(),
    }),
  };
});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/app", () => ({
  App: { getLaunchUrl: async () => undefined, addListener: () => Promise.resolve({ remove: () => {} }) },
}));
vi.mock("./Onboarding", () => ({ Onboarding: () => <p>Onboarding screen</p>, ONBOARDING_PAGES: [] }));
// This suite audits route reachability. Settings opens over Home, so mock the
// backdrop feed: mounting the real feed per route only pads the worker heap.
vi.mock("./Home", () => ({ Home: () => <p>Home screen</p> }));
vi.mock("../services/aiCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/aiCredentials")>();
  return { ...actual, aiCredentials: { ...aiCreds, credentialHandle: actual.aiCredentials.credentialHandle } };
});
vi.mock("../services/notificationPreferences", () => ({
  fetchNotificationPreferences: async () => ({ pushEnabled: true }),
}));
vi.mock("../services/pushRuntime", () => ({
  pushController: () => ({ permission: async () => "unsupported" as const }),
  CHAT_PUSH_BOUND_EVENT: "findback:chat-push-bound",
  takeChatPushTap: async () => null,
  listenForChatPushTap: async () => () => {},
  acknowledgeChatPushTap: async () => {},
  reportActiveRoute: async () => {},
}));

import { App, createAppRouter } from "../App";
let router: ReturnType<typeof createAppRouter> | undefined;

function renderAt(hash: string) {
  window.history.replaceState(null, "", `/#${hash}`);
  router?.dispose();
  router = createAppRouter();
  return render(<App router={router} />);
}

beforeEach(() => {
  auth.user = { id: "u1", username: "tester", email: "tester@example.test", phone: "+10000000000", avatarUrl: null, emailVerified: true, phoneVerified: false, createdAt: "2026-01-01T00:00:00Z" };
  auth.booting = false;
  auth.bootError = null;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  router?.dispose();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

/** Every backTo/fallbackTo used by settings screens, plus every row target. */
const BACK_TO_ROUTES = [
  "/settings",
  "/settings/ai",
  "/settings/account",
  "/settings/devices",
  "/settings/backup",
  "/profile",
  "/",
  "/settings/appearance",
  "/settings/accessibility",
  "/settings/feed-layout",
  "/settings/media",
  "/settings/notifications",
  "/settings/privacy",
  "/settings/help",
  "/settings/about",
  "/settings/diagnostics",
  "/settings/ai/models",
  "/settings/ai/connections",
  "/settings/local-intelligence",
  "/settings/local-intelligence/downloads",
  "/onboarding?replay=1",
  "/verify",
  "/my",
  "/search",
  "/report",
  "/notifications",
  "/help",
  "/ai-connection",
  "/ai-models",
  "/profile/edit",
  "/settings/terms",
  "/settings/privacy-policy",
  "/settings/community-guidelines",
] as const;

/**
 * Mounting the full App once per route kept ~90 MB of worker heap per mount and
 * drove the fork into its 4 GB cap. These are route-reachability checks, not
 * isolation checks: a few real app instances navigating through every route
 * prove the same thing. A route that fails still names itself in its assertion
 * message.
 */
const ROUTE_GROUPS = Array.from({ length: Math.ceil(BACK_TO_ROUTES.length / 6) }, (_, index) =>
  [index, BACK_TO_ROUTES.slice(index * 6, index * 6 + 6)] as const);

describe("QA L: every settings backTo lands on a mounted route", () => {
  it.each(ROUTE_GROUPS)("routes %i render content (no splash redirect)", async (_index, routes) => {
    renderAt("/");
    for (const route of routes) {
      await act(async () => { await router!.navigate(route); });
      await waitFor(() => {
        expect(document.body.textContent!.length, route).toBeGreaterThan(0);
      });
      expect(screen.queryByText("Loading Norfold…"), route).toBeNull();
      expect(screen.queryByRole("heading", { name: "Something went wrong" }), route).toBeNull();
    }
  }, 120_000);
});
