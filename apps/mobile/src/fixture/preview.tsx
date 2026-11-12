import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../auth";
import { ThemeProvider } from "../theme";
import { FixtureRoute } from "./FixtureRoute";

/**
 * L-FIXTURE static preflight mount (see ./README.md).
 *
 * The fixture route renders production components against fixed data, so it
 * must not depend on a session or a backend. Mounting it through the full app
 * shell would gate it behind the boot restore, which never settles without
 * Supabase config — the reviewer would get a blank page. This mount keeps the
 * two providers the components genuinely read (theme tokens, auth shape) and
 * starts auth in its no-session state, so nothing touches the network.
 */
export function mountFixturePreview(host: HTMLElement, initialEntry = "/"): void {
  createRoot(host).render(
    <StrictMode>
      <ThemeProvider>
        <AuthProvider boot={false}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <FixtureRoute />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
