import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, sdk } = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
  sdk: { fails: false },
}));

let authHandler: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
let authSubscriptions = 0;

auth.onAuthStateChange.mockImplementation(
  (callback: (event: string, session: { user: { id: string } } | null) => void) => {
    authSubscriptions += 1;
    authHandler = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
);

vi.mock("./supabaseClient", () => ({
  getSupabase: () => {
    if (sdk.fails) throw new Error("Supabase is not configured");
    return { auth };
  },
}));

import {
  LINK_PREVIEW_ENDPOINT,
  LINK_PREVIEW_MAX_URL_LENGTH,
  LINK_PREVIEW_TIMEOUT_MS,
  fetchLinkPreview,
  isAllowedPreviewImage,
  isPreviewableLink,
  normalizePreviewUrl,
  safeLinkHref,
} from "./linkPreview";

const session = (id: string, token = `token-${id}`) => ({
  data: { session: { user: { id }, access_token: token } },
  error: null,
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface FetchCall {
  init: RequestInit | undefined;
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
}

/** A fetch that stays pending until the test resolves it or its signal aborts. */
function pendingFetch() {
  const calls: FetchCall[] = [];
  const mock = vi.fn((_input: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ init, resolve, reject });
      init?.signal?.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        { once: true },
      );
    }));
  return { mock, calls };
}

async function flushMicrotasks(times = 16): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.unstubAllGlobals();
  sdk.fails = false;
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue(session("acct-a", "token-a"));
  // The module keeps a process-wide cache. A sign-out event is the production
  // fence, so using it here purges the previous case without exposing a reset
  // hook that production code does not need.
  authHandler?.("SIGNED_OUT", null);
});

describe("frozen transport contract", () => {
  it("pins the endpoint and the client budget the backend was sized against", () => {
    expect(LINK_PREVIEW_ENDPOINT).toBe("https://findbackapp.social/api/link-preview");
    expect(LINK_PREVIEW_MAX_URL_LENGTH).toBe(2048);
    expect(LINK_PREVIEW_TIMEOUT_MS).toBe(8_000);
  });
});

describe("link address policy", () => {
  it("normalizes HTTPS, drops the fragment and keeps the query", () => {
    expect(normalizePreviewUrl("https://news.example.org/story?id=42#section")).toBe(
      "https://news.example.org/story?id=42",
    );
    expect(normalizePreviewUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
    expect(normalizePreviewUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizePreviewUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(isPreviewableLink("https://example.com:443/a")).toBe(true);
  });

  it.each([
    "http://example.com/a",
    "https://example.com:8443/a",
    "https://user:pass@example.com/a",
    "https://localhost/a",
    "https://foo.local/a",
    "https://service.internal/a",
    "https://intranet/a",
    "https://127.0.0.1/a",
    "https://10.1.2.3/a",
    "https://172.20.1.1/a",
    "https://192.168.0.1/a",
    "https://169.254.1.1/a",
    "https://[::1]/a",
    "https://[fd00::1]/a",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "",
  ])("does not preview %s", (href) => {
    expect(isPreviewableLink(href)).toBe(false);
    expect(normalizePreviewUrl(href)).toBeNull();
  });

  it("rejects an address beyond the maximum length and anything with whitespace", () => {
    expect(isPreviewableLink(`https://example.com/${"a".repeat(2048)}`)).toBe(false);
    expect(isPreviewableLink("https://example.com/a b")).toBe(false);
    expect(safeLinkHref("  https://example.com/a  ")).toBe("https://example.com/a");
  });
});

describe("fetchLinkPreview", () => {
  it("never contacts the service or auth for an unsupported address", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    await expect(fetchLinkPreview("http://example.com/a")).resolves.toBeNull();
    await expect(fetchLinkPreview("https://10.0.0.1/a")).resolves.toBeNull();
    await expect(fetchLinkPreview("javascript:alert(1)")).resolves.toBeNull();

    expect(mock).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("fails closed without a session, a token, or a configured SDK", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(fetchLinkPreview("https://session.example.com/a")).resolves.toBeNull();

    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "acct-a" } } }, error: null });
    await expect(fetchLinkPreview("https://session.example.com/b")).resolves.toBeNull();

    sdk.fails = true;
    await expect(fetchLinkPreview("https://session.example.com/c")).resolves.toBeNull();

    expect(mock).not.toHaveBeenCalled();
  });

  it("POSTs the normalized URL with the custom bearer header and returns validated metadata", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const target = "https://news.example.org/story?id=42";
    mock.mockResolvedValue(jsonResponse({
      url: target,
      title: "A real story",
      description: "The description",
      siteName: "News",
      imageDataUrl: "data:image/png;base64,AAAA",
    }));

    await expect(fetchLinkPreview("https://news.example.org/story?id=42#top")).resolves.toEqual({
      url: target,
      title: "A real story",
      description: "The description",
      siteName: "News",
      imageDataUrl: "data:image/png;base64,AAAA",
    });

    expect(mock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = mock.mock.calls[0]!;
    expect(endpoint).toBe(LINK_PREVIEW_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json",
      "x-norfold-authorization": "Bearer token-a",
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect("authorization" in headers).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({ url: target });
  });

  it("treats a null title, a mismatched url echo and a malformed answer as unavailable", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const first = "https://unavailable.example.com/one";
    mock.mockResolvedValueOnce(jsonResponse({ url: first, title: null }));
    await expect(fetchLinkPreview(first)).resolves.toBeNull();

    const second = "https://unavailable.example.com/two";
    mock.mockResolvedValueOnce(jsonResponse({ url: "https://evil.test/", title: "Wrong host" }));
    await expect(fetchLinkPreview(second)).resolves.toBeNull();

    const third = "https://unavailable.example.com/three";
    mock.mockResolvedValueOnce(jsonResponse({ title: "No echo" }));
    await expect(fetchLinkPreview(third)).resolves.toBeNull();

    const fourth = "https://unavailable.example.com/four";
    mock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html>not json</html>",
    } as unknown as Response);
    await expect(fetchLinkPreview(fourth)).resolves.toBeNull();

    const fifth = "https://unavailable.example.com/five";
    mock.mockResolvedValueOnce(jsonResponse({ url: fifth, title: "Server error" }, 503));
    await expect(fetchLinkPreview(fifth)).resolves.toBeNull();
  });

  it("keeps provider text as text and bounds every field", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const markup = `<img src=x onerror="alert(1)">`;
    const first = "https://bounds.example.com/markup";
    mock.mockResolvedValueOnce(jsonResponse({ url: first, title: markup }));
    const preview = await fetchLinkPreview(first);
    expect(preview?.title).toBe(markup);
    expect(typeof preview?.title).toBe("string");

    const second = "https://bounds.example.com/title";
    mock.mockResolvedValueOnce(jsonResponse({ url: second, title: "t".repeat(301) }));
    await expect(fetchLinkPreview(second)).resolves.toBeNull();

    const third = "https://bounds.example.com/description";
    mock.mockResolvedValueOnce(jsonResponse({
      url: third,
      title: "Kept",
      description: "d".repeat(601),
      siteName: "s".repeat(81),
    }));
    await expect(fetchLinkPreview(third)).resolves.toEqual({
      url: third,
      title: "Kept",
      description: undefined,
      siteName: undefined,
      imageDataUrl: undefined,
    });

    const fourth = "https://bounds.example.com/body";
    mock.mockResolvedValueOnce(jsonResponse({ url: fourth, title: "x", description: "d".repeat(400_000) }));
    await expect(fetchLinkPreview(fourth)).resolves.toBeNull();
  });

  const imageCases: Array<[string, boolean]> = [
    ["data:image/jpeg;base64,/9j/AA==", true],
    ["data:image/png;base64,AAAA", true],
    ["data:image/webp;base64,AAAA", true],
    ["data:image/gif;base64,AAAA", false],
    ["data:image/svg+xml;base64,AAAA", false],
    ["https://evil.test/pixel.png", false],
    ["data:text/html;base64,AAAA", false],
    ["data:image/png;base64,", false],
  ];
  it.each(imageCases)("accepts only a strict raster data image (%s)", async (image, accepted) => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const target = `https://images.example.com/${encodeURIComponent(image)}`;
    mock.mockResolvedValue(jsonResponse({ url: target, title: "Image", imageDataUrl: image }));

    const preview = await fetchLinkPreview(target);
    expect(preview?.title).toBe("Image");
    expect(preview?.imageDataUrl).toBe(accepted ? image : undefined);
  });

  it("drops an oversized data image", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const target = "https://images.example.com/huge";
    const image = `data:image/png;base64,${"A".repeat(350_000)}`;
    expect(isAllowedPreviewImage(image)).toBe(false);
    mock.mockResolvedValue(jsonResponse({ url: target, title: "Huge", imageDataUrl: image }));

    const preview = await fetchLinkPreview(target);
    expect(preview?.imageDataUrl).toBeUndefined();
  });

  it("serves a repeated read from the account cache", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const target = "https://cache.example.com/repeated";
    mock.mockResolvedValue(jsonResponse({ url: target, title: "Cached" }));

    const first = await fetchLinkPreview(target);
    const second = await fetchLinkPreview(target);

    expect(second).toEqual(first);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("caches a negative answer, and only an explicit refresh bypasses it", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const target = "https://cache.example.com/negative";
    mock.mockResolvedValue(jsonResponse({ url: target, title: null }));

    await expect(fetchLinkPreview(target)).resolves.toBeNull();
    await expect(fetchLinkPreview(target)).resolves.toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);

    mock.mockResolvedValueOnce(jsonResponse({ url: target, title: "Recovered" }));
    await expect(fetchLinkPreview(target, { force: true })).resolves.toMatchObject({ title: "Recovered" });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("expires a negative answer after ten minutes", async () => {
    vi.useFakeTimers();
    try {
      const mock = vi.fn();
      vi.stubGlobal("fetch", mock);
      const target = "https://cache.example.com/ttl";
      mock.mockResolvedValue(jsonResponse({ url: target, title: null }));

      await expect(fetchLinkPreview(target)).resolves.toBeNull();
      await expect(fetchLinkPreview(target)).resolves.toBeNull();
      expect(mock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
      mock.mockResolvedValueOnce(jsonResponse({ url: target, title: "Later" }));
      await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "Later" });
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a positive answer for a day and then refreshes it", async () => {
    vi.useFakeTimers();
    try {
      const mock = vi.fn();
      vi.stubGlobal("fetch", mock);
      const target = "https://cache.example.com/positive-ttl";
      mock.mockResolvedValue(jsonResponse({ url: target, title: "Fresh" }));

      await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "Fresh" });
      await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "Fresh" });
      expect(mock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);
      mock.mockResolvedValueOnce(jsonResponse({ url: target, title: "Updated" }));
      await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "Updated" });
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the cache so the oldest entry is evicted", async () => {
    authHandler?.("SIGNED_OUT", null);
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    mock.mockImplementation(async (_input: string, init?: RequestInit) => {
      const target = JSON.parse(String(init?.body)).url as string;
      return jsonResponse({ url: target, title: "T" });
    });

    for (let index = 0; index < 41; index += 1) {
      await fetchLinkPreview(`https://limit.example.com/${index}`);
    }
    expect(mock).toHaveBeenCalledTimes(41);

    await fetchLinkPreview("https://limit.example.com/0");
    expect(mock).toHaveBeenCalledTimes(42);
  });

  it("shares one flight between two consumers of the same link", async () => {
    const { mock, calls } = pendingFetch();
    vi.stubGlobal("fetch", mock);
    const target = "https://dedup.example.com/shared";

    const first = fetchLinkPreview(target);
    const second = fetchLinkPreview(target);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    expect(mock).toHaveBeenCalledTimes(1);

    calls[0]!.resolve(jsonResponse({ url: target, title: "Shared" }));
    await expect(first).resolves.toMatchObject({ title: "Shared" });
    await expect(second).resolves.toMatchObject({ title: "Shared" });
  });

  it("a consumer abort does not cancel another consumer's request", async () => {
    const { mock, calls } = pendingFetch();
    vi.stubGlobal("fetch", mock);
    const target = "https://dedup.example.com/abort-one";

    const controller = new AbortController();
    const aborted = fetchLinkPreview(target, { signal: controller.signal });
    const kept = fetchLinkPreview(target);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));

    await flushMicrotasks();
    controller.abort();
    await expect(aborted).resolves.toBeNull();
    expect(calls[0]!.init?.signal?.aborted).toBe(false);

    calls[0]!.resolve(jsonResponse({ url: target, title: "Still here" }));
    await expect(kept).resolves.toMatchObject({ title: "Still here" });
  });

  it("aborts the network when the last consumer leaves", async () => {
    const { mock, calls } = pendingFetch();
    vi.stubGlobal("fetch", mock);
    const target = "https://dedup.example.com/abort-last";
    const controller = new AbortController();

    const pending = fetchLinkPreview(target, { signal: controller.signal });
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(calls[0]!.init?.signal?.aborted).toBe(true);
  });

  it("discards a late result after a sign-out and same-account sign-in", async () => {
    const { mock, calls } = pendingFetch();
    vi.stubGlobal("fetch", mock);
    const target = "https://fence.example.com/same-account";

    auth.getSession.mockResolvedValue(session("acct-a", "token-old"));
    const old = fetchLinkPreview(target);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));

    auth.getSession.mockResolvedValue(session("acct-a", "token-new"));
    authHandler?.("SIGNED_OUT", null);

    const fresh = fetchLinkPreview(target);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(calls[1]!.init?.headers).toMatchObject({ "x-norfold-authorization": "Bearer token-new" });

    calls[0]!.resolve(jsonResponse({ url: target, title: "Old" }));
    await expect(old).resolves.toBeNull();

    // The old request's `finally` must not delete the newer flight it found in
    // the map after an account fence.
    const joined = fetchLinkPreview(target);
    await flushMicrotasks();
    expect(mock).toHaveBeenCalledTimes(2);

    calls[1]!.resolve(jsonResponse({ url: target, title: "New" }));
    await expect(fresh).resolves.toMatchObject({ title: "New" });
    await expect(joined).resolves.toMatchObject({ title: "New" });
  });

  it("isolates A, B and a returning A through the same cache key", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const target = "https://fence.example.com/cross-account";

    auth.getSession.mockResolvedValue(session("acct-a", "token-a"));
    mock.mockResolvedValueOnce(jsonResponse({ url: target, title: "A first" }));
    await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "A first" });
    expect(mock).toHaveBeenCalledTimes(1);

    auth.getSession.mockResolvedValue(session("acct-b", "token-b"));
    mock.mockResolvedValueOnce(jsonResponse({ url: target, title: "B" }));
    await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "B" });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1]![1]?.headers).toMatchObject({ "x-norfold-authorization": "Bearer token-b" });

    auth.getSession.mockResolvedValue(session("acct-a", "token-a2"));
    mock.mockResolvedValueOnce(jsonResponse({ url: target, title: "A again" }));
    await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: "A again" });
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock.mock.calls[2]![1]?.headers).toMatchObject({ "x-norfold-authorization": "Bearer token-a2" });
  });

  it("times out at the client budget and records an honest unavailable", async () => {
    vi.useFakeTimers();
    try {
      const { mock, calls } = pendingFetch();
      vi.stubGlobal("fetch", mock);
      const target = "https://timeout.example.com/a";

      const pending = fetchLinkPreview(target);
      await flushMicrotasks();
      expect(mock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(LINK_PREVIEW_TIMEOUT_MS);
      await expect(pending).resolves.toBeNull();
      expect(calls[0]!.init?.signal?.aborted).toBe(true);

      // The timeout is cached as unavailable, so a later mount does not start
      // an automatic retry loop against a dead provider.
      await expect(fetchLinkPreview(target)).resolves.toBeNull();
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("observes the canonical auth SDK and never assumes a second session owner", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    mock.mockImplementation(async (_input: string, init?: RequestInit) => {
      const target = JSON.parse(String(init?.body)).url as string;
      return jsonResponse({ url: target, title: "Owned" });
    });

    await fetchLinkPreview("https://owner.example.com/a");
    await fetchLinkPreview("https://owner.example.com/b");

    expect(authSubscriptions).toBeGreaterThanOrEqual(1);
    expect(auth.getSession).toHaveBeenCalled();
  });
});
