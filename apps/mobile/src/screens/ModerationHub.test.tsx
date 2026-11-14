// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRole } = vi.hoisted(() => ({ fetchRole: vi.fn() }));
vi.mock("../services/roles", () => ({ fetchMyRole: fetchRole }));
import { ModerationHub } from "./ModerationHub";

afterEach(cleanup);
beforeEach(() => { fetchRole.mockReset(); });

function renderHub() {
  return render(<MemoryRouter initialEntries={["/settings/staff"]}><Routes>
    <Route path="/settings/staff" element={<ModerationHub />} />
    <Route path="/settings" element={<p>Settings destination</p>} />
  </Routes></MemoryRouter>);
}

describe("staff console", () => {
  it.each([
    ["ADMIN", true, [], ["Team & permissions", "Review reports", "Review appeals", "Review feedback"]],
    ["MODERATOR", false, ["reports_review"], ["Review reports"]],
    ["MODERATOR", false, ["appeals_review"], ["Review appeals"]],
    ["MODERATOR", false, ["feedback_read"], ["Review feedback"]],
    ["MODERATOR", false, ["reports_review", "feedback_read"], ["Review reports", "Review feedback"]],
  ])("shows only permitted rows for %s with %s admin and %j", async (role, isAdmin, capabilities, expected) => {
    fetchRole.mockResolvedValue({ role, isAdmin, capabilities });
    renderHub();
    const paths: Record<string, string> = {
      "Team & permissions": "/settings/team",
      "Review reports": "/settings/moderation/queue",
      "Review appeals": "/settings/moderation/appeals",
      "Review feedback": "/settings/moderation/feedback",
    };
    for (const [name, path] of Object.entries(paths)) {
      if (expected.includes(name)) {
        expect((await screen.findByRole("link", { name: new RegExp(name, "i") })).getAttribute("href")).toBe(path);
      } else {
        await waitFor(() => expect(fetchRole).toHaveBeenCalled());
        expect(screen.queryByRole("link", { name: new RegExp(name, "i") })).toBeNull();
      }
    }
  });

  it("shows pending state without privileged rows", () => {
    fetchRole.mockReturnValue(new Promise(() => {}));
    renderHub();
    expect(screen.getByRole("status").textContent).toBe("Checking your permissions…");
    expect(screen.queryByRole("link", { name: /Review reports/i })).toBeNull();
  });

  it("retries a failed role read", async () => {
    fetchRole.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ role: "MODERATOR", isAdmin: false, capabilities: ["feedback_read"] });
    renderHub();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Review feedback/i })).toBeTruthy();
    expect(fetchRole).toHaveBeenCalledTimes(2);
  });

  it.each([[[]], [["audit_read"]]])("redirects accounts without staff capabilities (%j)", async capabilities => {
    fetchRole.mockResolvedValue({ role: null, isAdmin: false, capabilities });
    renderHub();
    expect(await screen.findByText("Settings destination")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Review reports/i })).toBeNull();
  });
});
