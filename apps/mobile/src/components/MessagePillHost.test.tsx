// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { MessagePillHost } from "./MessagePillHost";

/**
 * The live unread shortcut belongs to `ChatDock`'s launcher. This retired host
 * must stay invisible everywhere so a second corner control, a live-region
 * duplicate or the old placeholder identity cannot come back beside it.
 */

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><MessagePillHost /></MemoryRouter>);
}

afterEach(cleanup);

describe("MessagePillHost", () => {
  it("renders no legacy pill on ordinary, list and thread routes", () => {
    for (const path of ["/", "/search", "/chats", "/chats/a", "/connections", "/connections/a", "/privacy"]) {
      const { container } = mount(path);
      expect(container.innerHTML).toBe("");
      expect(container.querySelector('[role="status"]')).toBeNull();
      cleanup();
    }
  });

  it("never paints the old placeholder identity", () => {
    const { container } = mount("/search");
    expect(container.textContent).not.toContain("Member");
  });
});
