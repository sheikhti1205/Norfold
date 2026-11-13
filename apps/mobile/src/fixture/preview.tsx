import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../auth";
import { ThemeProvider } from "../theme";
import { FixtureRoute } from "./FixtureRoute";
import { ChromeFixtureRoute } from "./ChromeFixtureRoute";

/**
 * L-FIXTURE static preflight mount (see ./README.md).
 *
 * The fixture route renders production components against fixed data, so it
 * must not depend on a session or a backend. Mounting it through the full app
 * shell would gate it behind the boot restore, which never settles without
 * Supabase config — the reviewer would get a blank page. This mount keeps the
 * two providers the components genuinely read (theme tokens, auth shape) and
 * starts auth in its no-session state, so nothing touches the network.
 *
 * `main.tsx` sends every `#/__fixture*` hash here, so the route table mirrors
 * the fixture surfaces: the section catalogue at `/__fixture`, and the
 * full-viewport chrome stage at `/__fixture/chrome` for surfaces that are
 * `position: fixed` and cannot be reviewed inside a frame.
 */
export function mountFixturePreview(host: HTMLElement, initialEntry = "/"): void {
  createRoot(host).render(
    <StrictMode>
      <ThemeProvider>
        <AuthProvider boot={false}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/__fixture" element={<FixtureRoute />} />
              <Route path="/__fixture/chrome" element={<ChromeFixtureRoute />} />
              {/* Any other reviewer flag keeps the catalogue, as before. */}
              <Route path="*" element={<FixtureRoute />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
