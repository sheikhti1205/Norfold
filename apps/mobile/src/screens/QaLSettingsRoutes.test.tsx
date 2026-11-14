// @vitest-environment jsdom
/**
 * QA L content audit: Diagnostics renders no secret-shaped strings with fixture
 * data, and consumer-tier AI screens render no raw technical terms
 * (checksum/SHA/revision/TTFT/model-enum).
 *
 * These are content checks, not routing checks: the screens are mounted
 * directly. The app-route matrix (every settings backTo under the real <App/>)
 * lives in QaLSettingsRouteMatrix.test.tsx so this file stays light and cannot
 * push the worker into its 4 GB heap cap.
 */
import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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
vi.mock("../services/aiCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/aiCredentials")>();
  return { ...actual, aiCredentials: { ...aiCreds, credentialHandle: actual.aiCredentials.credentialHandle } };
});
vi.mock("../services/notificationPreferences", () => ({
  fetchNotificationPreferences: async () => ({ pushEnabled: true }),
}));

import { ApplicationAiService } from "../services/ai/applicationAi";
import { AiConnection } from "./AiConnection";
import { AiSettings } from "./AiSettings";
import { CloudModels } from "./CloudModels";
import { Diagnostics } from "./Diagnostics";
import { DownloadedModels } from "./DownloadedModels";
import { CommunityGuidelines, PrivacyPolicy, Terms } from "./Legal";
import { LocalIntelligence } from "./LocalIntelligence";

/** One offline service; the web build has no on-device model store. */
let offlineAi: ApplicationAiService | undefined;
function offlineService() {
  return (offlineAi ??= new ApplicationAiService({ android: false }));
}

function renderScreen(element: ReactElement, route = "/") {
  return render(<MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>);
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
  vi.clearAllMocks();
});

it.each(["/settings/ai/connections", "/ai-connection"])(
  "provider route %s finishes loading the key form rather than an error page", async (route) => {
    renderScreen(<AiConnection />, route);
    expect(await screen.findByRole("heading", { level: 1, name: "Providers" })).not.toBeNull();
    expect(await screen.findByText("No key saved")).not.toBeNull();
    expect(screen.getByLabelText("OpenRouter API key")).not.toBeNull();
    expect(screen.queryByText("Checking saved key…")).toBeNull();
  },
);

describe("QA L: the legal documents are reachable and say what they are", () => {
  it.each([
    ["Terms of use", Terms],
    ["Privacy policy", PrivacyPolicy],
    ["Community guidelines", CommunityGuidelines],
  ] as const)("%s renders its own document", async (heading, Screen) => {
    renderScreen(<Screen />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: heading })).not.toBeNull();
    });
    // A legal document is not a placeholder: it carries text.
    expect((document.body.textContent ?? "").length).toBeGreaterThan(200);
  });
});

const SECRET_SHAPED =
  /sk-(?:or-v1|proj|live)-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[bap]-[A-Za-z0-9-]{8,}|gh[oprsu]_[A-Za-z0-9]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i;

describe("QA L: Diagnostics renders no secret-shaped strings", () => {
  it("fixture render carries no keys, tokens, or key material", async () => {
    renderScreen(<Diagnostics />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Diagnostics" })).not.toBeNull();
    });
    expect(document.body.textContent ?? "").not.toMatch(SECRET_SHAPED);
  });
});

const CONSUMER_FORBIDDEN =
  /sha-?256|\bsha\b|checksum|catalogue pin|revision|ttft|tokens\/s|\.gguf|\.onnx|quantiz|unknown model \S+/i;

/**
 * The consumer-facing AI screens, by the address each one serves. The two
 * on-device screens are rendered even though the web build redirects them:
 * the wording audit is about their copy, not about platform reachability.
 */
const AI_SCREENS: ReadonlyArray<readonly [string, () => ReactElement]> = [
  ["/settings/ai", () => <AiSettings />],
  ["/settings/ai/chat-models", () => <CloudModels />],
  ["/settings/ai/connections", () => <AiConnection />],
  ["/settings/local-intelligence", () => <LocalIntelligence service={offlineService()} />],
  ["/settings/local-intelligence/downloads", () => <DownloadedModels service={offlineService()} />],
];

describe("QA L: consumer-tier AI screens render no raw technical terms", () => {
  it.each(AI_SCREENS)(
    "screen %s stays consumer-worded",
    async (_route, make) => {
      renderScreen(make());
      await waitFor(() => {
        expect(document.body.textContent!.length).toBeGreaterThan(0);
      });
      expect(document.body.textContent ?? "").not.toMatch(CONSUMER_FORBIDDEN);
    },
  );

  it("no consumer route reaches a benchmark or CPU/GPU screen any more", async () => {
    // Owner direction 2026-10-25: the benchmark/CPU-GPU surface is not a
    // consumer surface at all, so the route must not exist and no consumer
    // screen may link to it.
    for (const [route, make] of AI_SCREENS) {
      cleanup();
      renderScreen(make());
      await waitFor(() => {
        expect(document.body.textContent!.length).toBeGreaterThan(0);
      });
      expect(screen.queryByRole("heading", { name: "Advanced" }), route).toBeNull();
      expect(screen.queryByText(/measure performance|run speed tests/i), route).toBeNull();
      expect(screen.queryByRole("link", { name: /advanced/i }), route).toBeNull();
    }
  });
});
