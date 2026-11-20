// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
const source = readFileSync(new URL("./NotificationPopover.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../screens/Notifications.css", import.meta.url), "utf8");

describe("notification quick inbox sizing", () => {
  it("caps the popover at a preview height, not most of the window", () => {
    expect(source).toMatch(/maxHeight=\{440\}/);
    expect(source).not.toMatch(/maxHeight=\{680\}/);
  });

  it("keeps the preview scroller and fixed footer without widening the panel", () => {
    expect(css).toMatch(/\.fb-notifications--preview \.fb-notification-content\s*\{[^}]*overflow\s*:\s*auto/);
    expect(css).toMatch(/\.fb-notification-see-all\s*\{[^}]*flex\s*:\s*none/);
    // Width is unchanged by this repair.
    expect(css).toMatch(/\.fb-popover\.fb-notification-popover\s*\{[^}]*width\s*:\s*390px/);
  });
});
