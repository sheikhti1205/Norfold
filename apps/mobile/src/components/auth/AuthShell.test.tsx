// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthShell } from "./AuthShell";
import { ThemeProvider } from "../../theme";
import { MemoryRouter } from "react-router";
import { getAuthReturnRoute, peekAuthReturnTo, rememberAuthReturnTo } from "../../utils/authReturnTo";
import { getPendingReportRoute, rememberReportLink } from "../../utils/pendingReportLink";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); sessionStorage.clear(); });

describe("shared auth branding", () => {
  it("opens public Home without destroying the pending destination", () => {
    sessionStorage.clear();
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", "https://findbackapp.social");
    rememberAuthReturnTo("/chats/c1");
    rememberReportLink("https://findbackapp.social/r/00000000-0000-4000-8000-000000000001");
    expect(getAuthReturnRoute()).toBe("/posts/00000000-0000-4000-8000-000000000001");
    render(<MemoryRouter initialEntries={["/auth"]}><AuthShell title="Welcome"><p>Form</p></AuthShell></MemoryRouter>);

    // Browsing Home is a presentation choice, not a cancellation: both the brand
    // mark and the explicit Home link keep the protected and shared intent.
    const home = screen.getAllByRole("link").filter(link => link.getAttribute("href") === "/");
    expect(home).toHaveLength(2);
    for (const link of home) fireEvent.click(link);
    expect(getAuthReturnRoute()).toBe("/posts/00000000-0000-4000-8000-000000000001");
    expect(peekAuthReturnTo()).toBe("/chats/c1");
    expect(getPendingReportRoute()).toBe("/posts/00000000-0000-4000-8000-000000000001");
  });
  it.each([false, true])("uses only the canonical mark with illustration=%s", illustration => {
    const { container } = render(<MemoryRouter><ThemeProvider><AuthShell title="Welcome to Norfold" illustration={illustration}><p>Form content</p></AuthShell></ThemeProvider></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Welcome to Norfold" })).toBeTruthy();
    const marks = [...container.querySelectorAll("header img")];
    expect(marks).toHaveLength(illustration ? 2 : 1);
    for (const mark of marks) {
      expect(mark.getAttribute("src")).toMatch(/brand-(tile|mark)-(light|dark)/);
      expect(mark.getAttribute("alt")).toBe("");
    }
    expect(container.querySelector(".lucide-radar")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Norfold" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  });
  it("keeps every shell link on a 48px hit area", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const local = join(process.cwd(), "src/components/auth/AuthShell.css");
    const css = readFileSync(existsSync(local) ? local : join(process.cwd(), "apps/mobile/src/components/auth/AuthShell.css"), "utf8");
    const footerRule = /\.fb-auth-shell footer a \{[^}]*\}/s.exec(css)?.[0];
    expect(footerRule).toMatch(/min-inline-size:\s*48px/);
    expect(footerRule).toMatch(/min-block-size:\s*48px/);

    render(<MemoryRouter><AuthShell title="Welcome"><p>Form</p></AuthShell></MemoryRouter>);
    for (const name of ["Norfold", "Back to Norfold", "Privacy", "Terms", "Community Guidelines"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-12");
    }
  });
});
