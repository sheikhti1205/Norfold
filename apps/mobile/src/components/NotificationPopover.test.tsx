// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "reader" } }) }));

// The service is mocked, not the network: the real vocabulary and labels stay.
vi.mock("../services/moderation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/moderation")>();
  return { ...actual, submitReport: vi.fn() };
});

// The inbox's own data/auth/realtime owner is not what this file is about. The
// stub keeps the one report entry point the real screen renders, so the popover
// and its sheet are exercised together.
vi.mock("../screens/Notifications", async () => {
  function StubInbox({ onReport, onNavigate }: { onReport: (id: string) => void; onNavigate: () => void }) {
    return (
      <div>
        <p>Quick inbox</p>
        <button type="button" onClick={() => onReport("post-1")}>Flag a report</button>
        <button type="button" onClick={onNavigate}>Dismiss inbox</button>
      </div>
    );
  }
  return { Notifications: StubInbox };
});

import { NotificationPopover, notificationPopoverMaxHeight } from "./NotificationPopover";

/**
 * Quick-inbox cap, source contract.
 *
 * The panel height is the shared layered popover's `maxHeight` prop, so the
 * value is pinned where it is declared instead of mounted: rendering the real
 * inbox would pull auth, realtime and the notification service into a sizing
 * assertion. The preview keeps its chrome fixed and scrolls only
 * `.fb-notification-content`, which is what makes 440px mean "3-4 rows, the
 * rest reachable".
 */
// Vitest runs with `apps/mobile` as its cwd; a jsdom module has no file: URL.
const source = readFileSync("src/components/NotificationPopover.tsx", "utf8");
const css = readFileSync("src/screens/Notifications.css", "utf8");

afterEach(cleanup);

describe("notification quick inbox sizing", () => {
  it("caps the popover at a preview height, not most of the window", () => {
    // The cap is computed in JS from the live viewport (half, never above 440px)
    // and passed through the RAC maxHeight prop, which React Aria applies as the
    // inline max-height the popover renders. A bare 440 or an unopposed stylesheet
    // rule is not the mechanism, so the source is pinned rather than a rendered
    // scroll (jsdom does not lay out).
    expect(source).not.toMatch(/maxHeight=\{440\}/);
    expect(source).not.toMatch(/maxHeight=\{680\}/);
    expect(source).toMatch(/maxHeight=\{popoverMaxHeight\}/);
    expect(source).toMatch(/Math\.min\(NOTIFICATION_POPOVER_MAX_HEIGHT_PX,\s*Math\.round\(viewportHeightPx \/ 2\)\)/);
  });

  it("computes the cap as half the live viewport, never above 440px", () => {
    // 900px viewport -> min(440, 450) = 440; 390px -> min(440, 195) = 195; never
    // above half the viewport, never above the previous 440px ceiling.
    expect(notificationPopoverMaxHeight(900)).toBe(440);
    expect(notificationPopoverMaxHeight(390)).toBe(195);
    expect(notificationPopoverMaxHeight(800)).toBe(400);
  });

  it("keeps the preview scroller and fixed footer without widening the panel", () => {
    expect(css).toMatch(/\.fb-notifications--preview \.fb-notification-content\s*\{[^}]*overflow\s*:\s*auto/);
    expect(css).toMatch(/\.fb-notification-see-all\s*\{[^}]*flex\s*:\s*none/);
    // Width is unchanged by this repair.
    expect(css).toMatch(/\.fb-popover\.fb-notification-popover\s*\{[^}]*width\s*:\s*390px/);
  });

});

describe("the notification bell", () => {
  it("closes the inbox that the bell itself opened", async () => {
    render(<NotificationPopover trigger={<span aria-hidden="true" />} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(bell);
    expect(await screen.findByText("Quick inbox")).toBeTruthy();
    expect(bell.getAttribute("aria-expanded")).toBe("true");

    // Owner seq 17460: the same bell hides what it showed. A modal popover
    // makes this press impossible, which is why the surface is non-modal.
    fireEvent.click(bell);
    await waitFor(() => expect(screen.queryByText("Quick inbox")).toBeNull());
    expect(bell.getAttribute("aria-expanded")).toBe("false");
  });

  it("declares a dialog popup on the bell trigger", () => {
    render(<NotificationPopover trigger={<span aria-hidden="true" />} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
    expect(bell.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the bell operable while the inbox is open", () => {
    // jsdom has no inert implementation, so the mechanism that keeps the
    // trigger pressable is pinned where it is declared: a non-modal surface
    // with its own outside-press dismissal instead of React Aria's modal one.
    expect(source).toMatch(/isNonModal/);
    expect(source).toMatch(/addEventListener\("pointerdown", dismissOnOutsidePress, true\)/);
  });

  it.each(["Enter", " "])("toggles with the %s key and updates expanded state", async (key) => {
    render(<NotificationPopover trigger={<span aria-hidden="true" />} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    bell.focus();
    fireEvent.keyDown(bell, { key });
    fireEvent.keyUp(bell, { key });
    expect(await screen.findByText("Quick inbox")).toBeTruthy();
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(bell, { key });
    fireEvent.keyUp(bell, { key });
    await waitFor(() => expect(screen.queryByText("Quick inbox")).toBeNull());
    expect(bell.getAttribute("aria-expanded")).toBe("false");
  });

  it("lets Escape close only the report sheet and does not redirect its Tab", async () => {
    render(<NotificationPopover trigger={<span aria-hidden="true" />} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    fireEvent.click(await screen.findByRole("button", { name: "Flag a report" }));
    const sheet = await screen.findByRole("dialog", { name: /report a problem/i });
    const close = within(sheet).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(sheet.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /report a problem/i })).toBeNull());
    expect(screen.getByText("Quick inbox")).toBeTruthy();
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Quick inbox")).toBeNull());
  });

  it("keeps a report sheet open when the inbox is dismissed, then hands focus back", async () => {
    render(<NotificationPopover trigger={<span aria-hidden="true" />} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);

    const flag = await screen.findByRole("button", { name: "Flag a report" });
    fireEvent.click(flag);
    const sheet = await screen.findByRole("dialog", { name: /report a problem/i });
    expect(sheet.closest(".fb-notification-popover")).toBeNull();

    // This actually unmounts the inbox, not merely a blocked dismissal.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByText("Quick inbox")).toBeNull());
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: /report a problem/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /report a problem/i })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(bell));
    await waitFor(() => expect(document.querySelector(".fb-modal-backdrop")).toBeNull());
  });
});
