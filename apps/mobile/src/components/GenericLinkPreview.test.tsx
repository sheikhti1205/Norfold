// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkPreview } from "../services/linkPreview";

const { fetchPreviewMock } = vi.hoisted(() => ({ fetchPreviewMock: vi.fn() }));

vi.mock("../services/linkPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/linkPreview")>();
  return { ...actual, fetchLinkPreview: fetchPreviewMock };
});

import { GenericLinkPreview } from "./GenericLinkPreview";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: number[] = [];
  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe() { return undefined; }
  unobserve() { return undefined; }
  disconnect() { return undefined; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function intersect(): Promise<void> {
  const instance = FakeObserver.instances.at(-1);
  if (!instance) throw new Error("No observer was created");
  return act(async () => {
    instance.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      instance as unknown as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  fetchPreviewMock.mockReset();
  fetchPreviewMock.mockResolvedValue(null);
  FakeObserver.instances = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GenericLinkPreview", () => {
  it("renders nothing at all for an address it must not preview", () => {
    for (const href of [
      "javascript:alert(1)",
      "http://example.com/a",
      "https://localhost/a",
      "https://10.0.0.1/a",
      "https://service.internal/a",
    ]) {
      const { container, unmount } = render(<GenericLinkPreview href={href} />);
      expect(container.firstChild).toBeNull();
      unmount();
    }
    expect(fetchPreviewMock).not.toHaveBeenCalled();
  });

  it("anchors the host while loading, then swaps in validated metadata", async () => {
    const pending = deferred<LinkPreview | null>();
    fetchPreviewMock.mockReturnValue(pending.promise);
    const { container } = render(<GenericLinkPreview href="https://news.example.org/story?id=7#top" />);

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://news.example.org/story?id=7");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("aria-busy")).toBe("true");
    // Loading paints no extra row: the only text is the destination host.
    expect(container.textContent).toBe("news.example.org");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
    expect(fetchPreviewMock).toHaveBeenCalledWith(
      "https://news.example.org/story?id=7",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchPreviewMock.mock.calls[0]![1]).not.toHaveProperty("force");

    await act(async () => {
      pending.resolve({
        url: "https://news.example.org/story?id=7",
        title: "A real story",
        description: "The description",
        imageDataUrl: "data:image/png;base64,AAAA",
      });
    });

    expect(screen.getByText("A real story")).toBeTruthy();
    expect(screen.getByText("The description")).toBeTruthy();
    expect(container.querySelector(".fb-linkp-domain")?.textContent).toBe("news.example.org");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(link?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps one navigable anchor and no control when metadata is unavailable", async () => {
    const pending = deferred<LinkPreview | null>();
    fetchPreviewMock.mockReturnValue(pending.promise);
    const { container } = render(<GenericLinkPreview href="https://broken.example.com/a?q=1" />);

    await act(async () => {
      pending.resolve(null);
    });

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://broken.example.com/a?q=1");
    expect(link?.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toBe("broken.example.com");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("never requests a remote image even if a caller hands one over", async () => {
    fetchPreviewMock.mockResolvedValue({
      url: "https://images.example.com/a",
      title: "No image",
      imageDataUrl: "https://evil.test/pixel.png",
    });
    const { container } = render(<GenericLinkPreview href="https://images.example.com/a" />);

    await waitFor(() => expect(screen.getByText("No image")).toBeTruthy());
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders provider markup as escaped text, never as HTML", async () => {
    const markup = `<img src=x onerror="alert(1)">`;
    fetchPreviewMock.mockResolvedValue({ url: "https://markup.example.com/a", title: markup });
    const { container } = render(<GenericLinkPreview href="https://markup.example.com/a" />);

    await waitFor(() => expect(screen.getByText(markup)).toBeTruthy());
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not refetch on focus or visibility churn once it has a result", async () => {
    fetchPreviewMock.mockResolvedValue({ url: "https://stable.example.com/a", title: "Stable" });
    render(<GenericLinkPreview href="https://stable.example.com/a" />);

    await waitFor(() => expect(screen.getByText("Stable")).toBeTruthy());
    expect(fetchPreviewMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("cancels its own consumer when it unmounts", async () => {
    const pending = deferred<LinkPreview | null>();
    fetchPreviewMock.mockReturnValue(pending.promise);
    const { unmount } = render(<GenericLinkPreview href="https://unmount.example.com/a" />);

    await waitFor(() => expect(fetchPreviewMock).toHaveBeenCalledTimes(1));
    const init = fetchPreviewMock.mock.calls[0]![1] as { signal: AbortSignal };
    expect(init.signal.aborted).toBe(false);

    unmount();
    expect(init.signal.aborted).toBe(true);
  });

  it("never paints the previous link's metadata after a rerender", async () => {
    const first = deferred<LinkPreview | null>();
    fetchPreviewMock.mockReturnValueOnce(first.promise);
    const { container, rerender } = render(<GenericLinkPreview href="https://a.example.com/a" />);
    await waitFor(() => expect(fetchPreviewMock).toHaveBeenCalledTimes(1));

    const second = deferred<LinkPreview | null>();
    fetchPreviewMock.mockReturnValueOnce(second.promise);
    rerender(<GenericLinkPreview href="https://b.example.com/b" />);

    expect(screen.queryByText("Title A")).toBeNull();
    expect(container.querySelector("a")?.textContent).toContain("b.example.com");

    await act(async () => {
      first.resolve({ url: "https://a.example.com/a", title: "Title A" });
    });
    expect(screen.queryByText("Title A")).toBeNull();

    await act(async () => {
      second.resolve({ url: "https://b.example.com/b", title: "Title B" });
    });
    expect(screen.getByText("Title B")).toBeTruthy();
  });

  it("waits for intersection before contacting the service", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    fetchPreviewMock.mockResolvedValue({ url: "https://gate.example.com/a", title: "Gated" });
    render(<GenericLinkPreview href="https://gate.example.com/a" />);

    expect(fetchPreviewMock).not.toHaveBeenCalled();
    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0]!.options?.rootMargin).toBe("100px");

    await intersect();
    expect(fetchPreviewMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Gated")).toBeTruthy();
  });

  it("does not contact the service while the document is hidden", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    let visible: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visible,
    });

    try {
      fetchPreviewMock.mockResolvedValue({ url: "https://hidden.example.com/a", title: "Shown" });
      render(<GenericLinkPreview href="https://hidden.example.com/a" />);

      await intersect();
      expect(fetchPreviewMock).not.toHaveBeenCalled();

      visible = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(fetchPreviewMock).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });
});

describe("GenericLinkPreview surface contract", () => {
  it("paints no nested surface, caps its width and keeps a 44px anchor", () => {
    const css = readFileSync(new URL("./GenericLinkPreview.css", import.meta.url), "utf8");

    const wrapper = /\.fb-linkp\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(wrapper).toContain("width: min(320px, 100%)");
    expect(wrapper).toContain("max-width: 100%");
    expect(wrapper).not.toContain("background");
    expect(wrapper).not.toContain("border");
    expect(wrapper).not.toContain("radius");

    const link = /\.fb-linkp-link\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(link).toContain("min-height: 44px");
    expect(link).not.toContain("background");
    expect(link).not.toContain("border");

    const thumb = /\.fb-linkp-thumb\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(thumb).toContain("width: 76px");
    expect(thumb).not.toContain("background");

    // A failed lookup must not grow a status row or a retry control.
    expect(css).not.toContain(".fb-linkp-state");
    expect(css).not.toContain(".fb-linkp-retry");
  });
});
