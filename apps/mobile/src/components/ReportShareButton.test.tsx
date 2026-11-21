// @vitest-environment jsdom
/**
 * The one share control: one tap copies the public link AND opens the platform
 * sheet. No intermediate Share/Copy menu.
 *
 * The contract is honesty: an outcome is announced as it happened, a platform
 * without a clipboard gets a selectable link instead of a fake "copied", and
 * an impossible share is reported rather than swallowed.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetNativeShare, __setNativeShare } from "../utils/shareReport";
import { ReportShareButton } from "./ReportShareButton";

const origin = "https://findbackapp.social";
const id = "5b6f7c8d-1234-4abc-8def-123456789012";
const url = `${origin}/api/share/${id}`;

function stubNavigator({ share, writeText }: { share?: unknown; writeText?: unknown } = {}) {
  vi.stubGlobal("navigator", {
    share,
    clipboard: writeText === undefined ? undefined : { writeText },
  });
}

/** The messages the control announces to the reader. */
function listenForAnnouncements(): { heard: string[]; stop: () => void } {
  const heard: string[] = [];
  const handler = (event: Event) => {
    heard.push((event as CustomEvent<string>).detail ?? "");
  };
  window.addEventListener("findback:announce", handler);
  return { heard, stop: () => window.removeEventListener("findback:announce", handler) };
}

beforeEach(() => {
  vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
});

afterEach(() => {
  cleanup();
  __resetNativeShare();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ReportShareButton", () => {
  it("is one button with no menu detour", () => {
    stubNavigator();
    render(<ReportShareButton postId={id} title="Lost keys" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Share report" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("copies and shares in the same tap", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share, writeText });
    const { heard, stop } = listenForAnnouncements();
    try {
      render(<ReportShareButton postId={id} title="Lost keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Norfold report", url }));
      expect(writeText).toHaveBeenCalledWith(url);
      await waitFor(() => expect(heard).toContain("Link copied and shared."));
      expect(screen.getByText("Link copied and shared.")).toBeTruthy();
    } finally {
      stop();
    }
  });

  it("still copies when the reader dismisses the sheet", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share, writeText });
    const { heard, stop } = listenForAnnouncements();
    try {
      render(<ReportShareButton postId={id} title="Lost keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
      await waitFor(() => expect(heard).toContain("Link copied."));
      expect(screen.getByText("Link copied.")).toBeTruthy();
    } finally {
      stop();
    }
  });

  it("copies when the platform has no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ writeText });
    const { heard, stop } = listenForAnnouncements();
    try {
      render(<ReportShareButton postId={id} title="Lost keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      await waitFor(() => expect(heard).toContain("Link copied to clipboard."));
      expect(writeText).toHaveBeenCalledWith(url);
    } finally {
      stop();
    }
  });

  it("offers the link in a selectable field when there is no clipboard", async () => {
    stubNavigator();
    const { heard, stop } = listenForAnnouncements();
    try {
      render(<ReportShareButton postId={id} title="Lost keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      const field = (await screen.findByLabelText("Report link")) as HTMLInputElement;
      expect(field.value).toBe(url);
      expect(field.readOnly).toBe(true);
      // One read-only field and a hint: the compact measure, not 44rem.
      const dialog = screen.getByRole("dialog", { name: "Copy link" });
      expect(dialog.closest(".fb-modal-panel")?.classList.contains("fb-compact-panel")).toBe(true);
      // It must never claim a copy that did not happen.
      await waitFor(() => expect(heard.join(" ")).toMatch(/isn't available/i));
      expect(heard).not.toContain("Link copied.");
    } finally {
      stop();
    }
  });

  it("opens the native system sheet on a device", async () => {
    const native = vi.fn().mockResolvedValue("shared");
    __setNativeShare(native);
    stubNavigator();
    const { heard, stop } = listenForAnnouncements();
    try {
      render(<ReportShareButton postId={id} title="Lost keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      await waitFor(() => expect(native).toHaveBeenCalledWith({ title: "Norfold report", url }));
      await waitFor(() => expect(heard).toContain("Link shared."));
    } finally {
      stop();
    }
  });
});

describe("ReportShareButton lifetime", () => {
  const first = "aaaaaaaa-1111-4111-8111-111111111111";
  const second = "bbbbbbbb-2222-4222-8222-222222222222";

  function deferred() {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  it("never shows the previous report's manual link after a pending copy crosses identity replacement", async () => {
    const pending = deferred();
    stubNavigator({ writeText: () => pending.promise });
    const { heard, stop } = listenForAnnouncements();
    try {
      const view = render(<ReportShareButton postId={first} title="A" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      view.rerender(<ReportShareButton postId={second} title="B" />);
      await act(async () => pending.reject(new Error("clipboard refused")));
      expect(screen.queryByLabelText("Report link")).toBeNull();
      expect(heard).toEqual([]);
    } finally { stop(); }
  });

  it("never announces a share that completes after its report control unmounted", async () => {
    const pending = deferred();
    stubNavigator({ share: () => pending.promise });
    const { heard, stop } = listenForAnnouncements();
    try {
      const view = render(<ReportShareButton postId={first} title="A" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      view.unmount();
      await act(async () => pending.resolve());
      expect(heard).toEqual([]);
    } finally { stop(); }
  });

  it("never announces a share that completes after the report identity changed", async () => {
    const pending = deferred();
    stubNavigator({ share: () => pending.promise });
    const { heard, stop } = listenForAnnouncements();
    try {
      const view = render(<ReportShareButton postId={first} title="A" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      view.rerender(<ReportShareButton postId={second} title="B" />);
      await act(async () => pending.resolve());
      expect(heard).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
    } finally { stop(); }
  });

  it("announces nothing when the fallback lands after unmount", async () => {
    stubNavigator();
    const { heard, stop } = listenForAnnouncements();
    try {
      const view = render(<ReportShareButton postId={first} title="A" />);
      fireEvent.click(screen.getByRole("button", { name: "Share report" }));
      view.unmount();
      await act(async () => {});
      expect(heard).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
    } finally { stop(); }
  });

  it("closes the previous report's manual-link surface when the identity changes", async () => {
    stubNavigator();
    const view = render(<ReportShareButton postId={first} title="A" />);
    fireEvent.click(screen.getByRole("button", { name: "Share report" }));
    await screen.findByLabelText("Report link");
    view.rerender(<ReportShareButton postId={second} title="B" />);
    await waitFor(() => expect(screen.queryByLabelText("Report link")).toBeNull());
  });

  it("clears a visible confirmation when the report changes", async () => {
    stubNavigator({ writeText: vi.fn().mockResolvedValue(undefined) });
    const view = render(<ReportShareButton postId={first} title="A" />);
    fireEvent.click(screen.getByRole("button", { name: "Share report" }));
    await screen.findByText("Link copied to clipboard.");
    view.rerender(<ReportShareButton postId={second} title="B" />);
    await waitFor(() => expect(screen.queryByText("Link copied to clipboard.")).toBeNull());
  });
});
