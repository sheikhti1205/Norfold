// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Link, MemoryRouter, Route, RouterProvider, Routes, useNavigate } from "react-router";
import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { PrimaryNav, Shell } from "./Shell";
import { AppBar } from "./AppBar";
import { HoverLabelProvider } from "./HoverLabel";
import { TabTapProvider } from "./TabTap";
import { resetBackInterceptors } from "./backNavigation";
import { closeGlobalSearch, openGlobalSearch, resetGlobalSearch } from "./globalSearch";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, loadAppearance } from "../appearance";
import { COMPACT_MAX_PX } from "./responsive";
import { readFileSync } from "node:fs";

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "shell-reader" } }) }));
vi.mock("./RoleOfferNotice", () => ({ RoleOfferNotice: () => null }));
// The real window mounts the whole settings screen and its services; the
// interception contract is what these tests own, not presentation.
vi.mock("./SettingsWindow", () => ({
  SettingsWindow: ({ open, initialPath, onClose }: { open: boolean; initialPath?: string; onClose: () => void }) =>
    open ? <div data-testid="settings-window">{initialPath}<button aria-label="Close window" onClick={onClose} /></div> : null,
}));
// R19 T3 owns the shell's mount contract only. The dock itself (store, launcher,
// thread) is another writer's module, so it is mocked down to the two frozen
// props instead of running the real chat runtime inside a navigation test.
vi.mock("./ChatDock", () => ({
  ChatDock: ({ hostOccluded, bottomNavVisible }: { hostOccluded: boolean; bottomNavVisible: boolean }) => (
    <div data-testid="chat-dock" data-occluded={String(hostOccluded)} data-bottom-nav={String(bottomNavVisible)} />
  ),
}));

afterEach(() => { cleanup(); resetBackInterceptors(); document.body.style.overflow = ""; });

function renderShell(entry = "/") {
  function GoBack() {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Back</button>;
  }
  return render(
    <HoverLabelProvider>
    <MemoryRouter initialEntries={[entry]}>
      <GoBack />
      <Routes><Route element={<Shell />}>
        <Route index element={<p>Home screen</p>} />
        <Route path="/search" element={<p>Search screen</p>} />
        <Route path="/my" element={<p>My Reports screen</p>} />
        {/* An ordinary route that owns the shared top bar, so the rail's
            outside name can be observed where the app paints it. */}
        <Route path="/brand" element={<><AppBar title="Brand route" utilities={false} /><p>Brand route screen</p></>} />
        <Route path="/brand-back" element={<><AppBar title="Brand back" backTo="/" utilities={false} /><p>Brand back screen</p></>} />
        <Route path="/chats" element={<p>Chats screen</p>} />
        <Route path="/settings" element={<p>Settings screen</p>} />
        <Route path="/profile" element={<p>Profile screen</p>} />
        <Route path="/profile/edit" element={<p>Edit profile screen</p>} />
        <Route path="/chats/:id" element={<p>Chat thread</p>} />
        <Route path="/connections/:id" element={<p>Legacy chat thread</p>} />
        <Route path="/settings/appearance" element={<p>Appearance screen</p>} />
        <Route path="/settings/returns" element={<p>Recovered screen</p>} />
        <Route path="/saved" element={<p>Saved screen</p>} />
        <Route path="/reactions" element={<p>Reactions screen</p>} />
        <Route path="/my/:id/edit" element={<p>Edit report screen</p>} />
        <Route path="/notifications" element={<p>Notifications screen</p>} />
        <Route path="/report" element={<p>Report screen</p>} />
        <Route path="/ai-connection" element={<p>AI connection</p>} />
        <Route path="/help" element={<p>Help screen</p>} />
      </Route></Routes>
    </MemoryRouter>
    </HoverLabelProvider>,
  );
}

describe("Shell floating primary navigation", () => {
  it("offers four destinations and a separate create action", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ ...DEFAULT_APPEARANCE, navLayout: "bottom", navLayoutChosen: true }));
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("link").map((t) => t.getAttribute("href"))).toEqual([
      "/", "/my", "/chats", "/settings", "/report",
    ]);
    expect(within(nav).getByRole("link", { name: "Create report" })).toBeTruthy();
    expect(screen.queryByTestId("assistant-entry")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open assistant" })).toBeNull();
    localStorage.clear();
  });

  it("opens an in-app settings link inside the window instead of replacing the page", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route element={<Shell />}>
          <Route index element={<Link to="/settings/notifications">Notification preferences</Link>} />
          <Route path="/settings/notifications" element={<p>Notification page</p>} />
        </Route></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Notification preferences" }));
    // The section opens over the current screen, at that exact section.
    expect(screen.getByTestId("settings-window").textContent).toBe("/settings/notifications");
    expect(screen.getByRole("link", { name: "Notification preferences" })).toBeTruthy();
    expect(screen.queryByText("Notification page")).toBeNull();
  });

  it("intercepts programmatic push and replace without changing the page behind the window", () => {
    function Home() {
      const navigate = useNavigate();
      return <><p>Home screen</p>
        <button onClick={() => navigate("/settings/notifications?tab=push")}>Open notifications</button>
        <button onClick={() => navigate("/settings/appearance", { replace: true })}>Open appearance</button>
      </>;
    }
    render(<MemoryRouter initialEntries={["/"]}>
      <Routes><Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="/settings/*" element={<p>Settings page (must not render)</p>} />
      </Route></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    expect(screen.getByTestId("settings-window").textContent).toContain("/settings/notifications?tab=push");
    fireEvent.click(screen.getByRole("button", { name: "Open appearance" }));
    expect(screen.getByTestId("settings-window").textContent).toContain("/settings/appearance");
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(screen.getByText("Home screen")).toBeTruthy();
    expect(screen.queryByText("Settings page (must not render)")).toBeNull();
  });

  it("opens a redirected settings destination in the window and settles on Home", async () => {
    // The app route redirects a retired `/settings...` address to Home with
    // the exact destination as state; Shell opens it and clears the state.
    const router = createMemoryRouter([{ path: "*", element: <Routes>
      <Route element={<Shell />}>
        <Route index element={<p>Home screen</p>} />
      </Route>
    </Routes> }], { initialEntries: [{ pathname: "/", state: { settingsWindowPath: "/settings/help" } }] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByTestId("settings-window").textContent).toContain("/settings/help"));
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.state).toBeNull();
    expect(screen.getByText("Home screen")).toBeTruthy();
  });

  it("intercepts effect navigation under the app's data-router route tree", async () => {
    function Home() {
      const navigate = useNavigate();
      useEffect(() => { navigate("/settings/help", { replace: true }); }, [navigate]);
      return <p>Home screen</p>;
    }
    const router = createMemoryRouter([{ path: "*", element: <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="/settings/help" element={<p>Settings page (must not render)</p>} />
      </Route>
    </Routes> }], { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByTestId("settings-window").textContent).toContain("/settings/help"));
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByText("Home screen")).toBeTruthy();
  });

  it("opens the phone bottom bar's Settings destination in the window", async () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ ...DEFAULT_APPEARANCE, navLayout: "bottom", navLayoutChosen: true }));
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route element={<Shell />}>
          <Route index element={<p>Home screen</p>} />
          <Route path="/settings" element={<p>Settings screen</p>} />
        </Route></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
    expect(screen.getByTestId("settings-window").textContent).toBe("/settings");
    expect(screen.queryByText("Settings screen")).toBeNull();
    expect(screen.getByText("Home screen")).toBeTruthy();
  });

  it.each([
    ["/", "Home"],
    ["/my", "My Reports"],
    ["/chats", "Chats"], ["/settings", "Settings"], ["/profile", "Settings"],
    ["/profile/edit", "Settings"],
    ["/settings/appearance", "Settings"], ["/my/report/edit", "My Reports"],
  ])("selects only %s's destination with a visible label", (path, label) => {
    renderShell(path);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.getAttribute("aria-label") ?? link.textContent)).toEqual([label]);
    expect(within(nav).getByText(label).getAttribute("aria-hidden")).not.toBe("true");
    expect(links.slice(0, 4).filter((link) => link.textContent?.trim()).map((link) => link.textContent?.trim())).toEqual([label]);
  });

  it.each(["/chats/thread", "/connections/thread"])("selects Chats when a thread rail is rendered at %s", (path) => {
    render(<MemoryRouter initialEntries={[path]}><TabTapProvider><PrimaryNav layout="rail" /></TabTapProvider></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Chats" }).getAttribute("aria-current")).toBe("page");
  });
  it("keeps wide thread navigation and canvas, but removes primary nav on compact threads", () => {
    const previous=window.innerWidth;
    try {
      Object.defineProperty(window,"innerWidth",{value:1200,configurable:true});
      const mount=renderShell("/chats/thread");
      expect(screen.getByRole("navigation",{name:"Primary"})).toBeTruthy();
      expect(screen.getByRole("main").className).not.toContain("max-w-[44rem]");
      mount.unmount();Object.defineProperty(window,"innerWidth",{value:393,configurable:true});
      renderShell("/chats/thread");expect(screen.queryByRole("navigation",{name:"Primary"})).toBeNull();
    } finally { Object.defineProperty(window,"innerWidth",{value:previous,configurable:true}); }
  });

  it("tracks URL after navigation and Back rather than a stale local selection", () => {
    renderShell("/my");
    fireEvent.click(screen.getByRole("link", { name: "Chats" }));
    expect(screen.getByRole("link", { name: "Chats" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("link", { name: "My Reports" }).getAttribute("aria-current")).toBe("page");
  });

  it("leaves all tabs unselected on /report while keeping the create action available", () => {
    renderShell("/report");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("link").every((link) => !link.hasAttribute("aria-current"))).toBe(true);
    expect(within(nav).getByRole("link", { name: "Create report" }).getAttribute("href")).toBe("/report");
  });

  it("does not expose a scrolling-hide action and keeps the primary links named", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.className).not.toContain("translate-y-full");
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("aria-label") ?? link.textContent)).toEqual([
      "Home", "My Reports", "Chats", "Settings", "Create report",
    ]);
  });

  it.each([320, 360, 393, 420])("retains all five named actions at %ipx", (width) => {
    const previous = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    try {
      renderShell("/chats");
      expect(within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole("link")).toHaveLength(5);
      expect(screen.getByRole("link", { name: "Chats" }).textContent).toBe("Chats");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previous });
    }
  });

  it("hides navigation when the visual viewport is occupied by the keyboard", () => {
    const previous = window.visualViewport;
    const viewport = new EventTarget();
    Object.defineProperty(viewport, "height", { configurable: true, value: window.innerHeight });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    try {
      renderShell();
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
      Object.defineProperty(viewport, "height", { configurable: true, value: window.innerHeight - 240 });
      act(() => viewport.dispatchEvent(new Event("resize")));
      expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
      Object.defineProperty(viewport, "height", { configurable: true, value: window.innerHeight });
      act(() => viewport.dispatchEvent(new Event("resize")));
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    } finally {
      cleanup();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: previous });
    }
  });

  it("keeps a visible label and animated selection pill on press (always animated)", () => {
    // Production always animates: no MotionConfig reducedMotion wrapper.
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const create = within(nav).getByRole("link", { name: "Create report" });
    fireEvent.pointerDown(create);
    // The selected destination renders the animated active pill + label.
    expect(nav.querySelector(".fb-nav-active-bg")).toBeTruthy();
    expect(nav.querySelector(".fb-nav-label")).toBeTruthy();
    expect(within(nav).getByText("Home")).toBeTruthy();
  });

  it("hides the bottom nav on AI connection and shows no assistant UI", () => {
    renderShell("/ai-connection");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByTestId("assistant-entry")).toBeNull();
  });

  it.each(["/help", "/posts/example"])('keeps chrome hidden on %s', (path) => {
    renderShell(path);
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
  });

  it("removes nav during fullscreen and restores it on exit", () => {
    renderShell();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.body });
    try {
      act(() => document.dispatchEvent(new Event("fullscreenchange")));
      expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    } finally {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      act(() => document.dispatchEvent(new Event("fullscreenchange")));
    }
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
  });
});

describe("Shell P1 viewport (screenshots 08/11/12)", () => {
  function renderShellAt(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route element={<Shell />}>
          <Route index element={<p>Home screen</p>} />
          <Route path="/search" element={<p>Search screen</p>} />
          <Route path="/help" element={<p>Assistant screen</p>} />
          <Route path="/ai-connection" element={<p>AI connection</p>} />
        </Route></Routes>
      </MemoryRouter>,
    );
  }

  it("owns one app viewport with no phantom bottom padding on /help", () => {
    renderShellAt("/help");
    // Full-screen Assistant takes the whole viewport: no tab bar, no tab pad.
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    const viewport = document.querySelector(".fb-app-viewport");
    expect(viewport).toBeTruthy();
    const main = screen.getByRole("main");
    expect(main.className).not.toMatch(/pb-20/);
    expect(main.className).toMatch(/min-h-0/);
    expect(main.className).toMatch(/flex-1/);
    // Route stage: the positioning context for popLayout-exited routes, so
    // exiting/entering route wrappers share one stage instead of stacking.
    expect(main.className).toMatch(/relative/);
  });

  it("keeps the bottom nav in normal flex flow, not a fixed overlay", () => {
    renderShellAt("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.className).not.toMatch(/fixed/);
  });
});

describe("Shell nav hide/show with focusability (Wave A)", () => {
  function renderShellWithDetail(entry: string) {
    function GoDetail() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/posts/p1")}>open detail</button>;
    }
    function GoHome() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/")}>go home</button>;
    }
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route element={<Shell />}>
          <Route index element={<p>Home screen<GoDetail /></p>} />
          <Route path="/posts/:id" element={<p>Detail screen<GoHome /></p>} />
          <Route path="/help" element={<p>Help screen<GoHome /></p>} />
        </Route></Routes>
      </MemoryRouter>,
    );
  }

  it("detail route shows content with no focusable nav chrome", async () => {
    renderShellWithDetail("/posts/p1");
    expect(screen.getByText(/Detail screen/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull());
    // Hidden nav unmounts: no tab stops or labelled links leak.
    expect(document.querySelector(".fb-nav-slot")).toBeNull();
    expect(screen.queryByRole("link", { name: "Create report" })).toBeNull();
  });

  it("navigating detail → home restores the nav without losing content", async () => {
    renderShellWithDetail("/posts/p1");
    fireEvent.click(screen.getByRole("button", { name: "go home" }));
    // Navigation is immediate: new content renders at once...
    expect(screen.getByText(/Home screen/)).toBeTruthy();
    // ...and the nav returns to the tab order.
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create report" })).toBeTruthy();
  });

  it("navigating home → detail swaps content immediately and the nav exits", async () => {
    renderShellWithDetail("/");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "open detail" }));
    // Motion only accompanies navigation: the new screen is there at once.
    expect(screen.getByText(/Detail screen/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull());
  });

  it("labels still appear under forced reduced motion", () => {
    render(
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={["/"]}>
          <Routes><Route element={<Shell />}>
            <Route index element={<p>Home screen</p>} />
          </Route></Routes>
        </MemoryRouter>
      </MotionConfig>,
    );
    // The pill may snap, but the selected label must still render.
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
  });
});

describe("Shell adaptive navigation (owner ruling 4(e))", () => {
  const initialWidth = window.innerWidth;

  function storeNavLayout(navLayout: "auto" | "bottom" | "rail") {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APPEARANCE, navLayout, navLayoutChosen: true }),
    );
  }

  function setWidth(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  }

  /** A controllable `matchMedia`, so the width gate is exercised the way production uses it. */
  function stubMatchMedia(initialWide: boolean) {
    let matches = initialWide;
    const listeners = new Set<() => void>();
    const query = {
      get matches() {
        return matches;
      },
      media: "",
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => query));
    return (wide: boolean) => {
      matches = wide;
      for (const listener of listeners) listener();
    };
  }

  function navLayouts(): string[] {
    return screen
      .queryAllByRole("navigation", { name: "Primary" })
      .map((nav) => nav.getAttribute("data-layout") ?? "unknown");
  }

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: initialWidth });
  });

  it("first wide navigation choice closes setup, updates the one nav and preserves keyboard focus", async () => {
    localStorage.clear(); setWidth(1200); stubMatchMedia(true);
    renderShell("/");
    const choice = screen.getByRole("radio", { name: "Side rail" });
    choice.focus(); fireEvent.click(choice);
    expect(screen.queryByRole("dialog", { name: "Choose your navigation" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-layout")).toBe("rail");
    await waitFor(() => expect(document.activeElement).toBe(within(nav).getByRole("link", { name: "Home" })));
  });

  it.each([320, 500, COMPACT_MAX_PX - 1])(
    "keeps a chosen rail on %ipx as a temporary drawer, not an always-open column",
    (width) => {
      setWidth(width);
      storeNavLayout("rail");
      renderShell("/");
      // Nothing navigational is painted until the reader asks for it.
      expect(navLayouts()).toEqual([]);
      expect(document.querySelector(".fb-nav-rail")).toBeNull();
      expect(document.querySelector(".fb-nav-slot")).toBeNull();
      expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
    },
  );

  it("opens a chosen rail as a modal drawer and closes it when a destination is followed", async () => {
    setWidth(390);
    storeNavLayout("rail");
    renderShell("/");
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("button", { name: "Close navigation" })).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "My Reports" })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("link", { name: "My Reports" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
    expect(screen.getByText("My Reports screen")).toBeTruthy();
  });

  it("closes the phone drawer on Escape without changing the route", async () => {
    setWidth(390);
    storeNavLayout("rail");
    renderShell("/");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
    expect(screen.getByText("Home screen")).toBeTruthy();
  });

  it("renders the stored rail at the breakpoint", () => {
    setWidth(COMPACT_MAX_PX);
    storeNavLayout("rail");
    renderShell("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-layout")).toBe("rail");
    expect(document.querySelector(".fb-nav-slot")).toBeNull();
  });

  it("renders the stored bottom bar at the breakpoint", () => {
    setWidth(COMPACT_MAX_PX);
    storeNavLayout("bottom");
    renderShell("/");
    expect(navLayouts()).toEqual(["bottom"]);
  });

  it("follows a width change without a reload", async () => {
    setWidth(COMPACT_MAX_PX);
    const setWide = stubMatchMedia(false);
    storeNavLayout("auto");
    renderShell("/");
    expect(navLayouts()).toEqual(["bottom"]);

    act(() => setWide(true));
    await waitFor(() => expect(navLayouts()).toEqual(["rail"]));

    act(() => setWide(false));
    await waitFor(() => expect(navLayouts()).toEqual(["bottom"]));
  });

  it("flips rail↔bottom atomically: one nav, in its own flex context, from the first commit", () => {
    setWidth(800);
    storeNavLayout("auto");
    const setWide = stubMatchMedia(true);
    renderShell("/");
    expect(navLayouts()).toEqual(["rail"]);

    // Rail → bottom (rotation, or leaving a wide window). An exiting rail in
    // the new column container would paint a 104×320px column above <main>.
    act(() => setWide(false));
    expect(navLayouts()).toEqual(["bottom"]);
    expect(document.querySelector(".fb-nav-rail")).toBeNull();
    let main = screen.getByRole("main");
    let nav = screen.getByRole("navigation", { name: "Primary" });
    expect(main.parentElement?.className).toContain("flex-col");
    // In a column the bar is after <main>, so <main> owns the full width.
    expect(
      main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(main.className).toContain("flex-1");

    // Bottom → rail. An exiting bar in the new row container would be a
    // ~300px max-content sibling and squeeze <main> for 150ms.
    act(() => setWide(true));
    expect(navLayouts()).toEqual(["rail"]);
    expect(document.querySelector(".fb-nav-slot")).toBeNull();
    main = screen.getByRole("main");
    nav = screen.getByRole("navigation", { name: "Primary" });
    expect(main.parentElement?.className).toContain("flex-row");
    expect(main.className).toContain("min-w-0");
    expect(
      nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the rail mounted while the keyboard is open, and hides only the bar", () => {
    setWidth(800);
    storeNavLayout("rail");
    const previous = window.visualViewport;
    const viewport = new EventTarget();
    Object.defineProperty(viewport, "height", {
      configurable: true,
      value: window.innerHeight,
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    try {
      renderShell("/");
      expect(navLayouts()).toEqual(["rail"]);
      Object.defineProperty(viewport, "height", {
        configurable: true,
        value: window.innerHeight - 240,
      });
      act(() => viewport.dispatchEvent(new Event("resize")));
      // The rail is beside the content, so the keyboard cannot cover it and
      // hiding it would only widen <main> by 6.5rem and back.
      expect(navLayouts()).toEqual(["rail"]);
    } finally {
      cleanup();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: previous });
    }
  });

  it("hands focus to the same destination when the layout flips", () => {
    setWidth(800);
    storeNavLayout("auto");
    const setWide = stubMatchMedia(true);
    renderShell("/");
    const before = within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
      "link",
      { name: "Chats" },
    );
    before.focus();
    expect(document.activeElement).toBe(before);

    act(() => setWide(false));
    const after = within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
      "link",
      { name: "Chats" },
    );
    // The old node unmounted; focus must not be left on <body>.
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect((document.activeElement as HTMLElement).getAttribute("href")).toBe("/chats");
  });

  // The rail carries destinations the phone bar deliberately does not. Search
  // and Connect share a route, and Recovered is a Settings child, so these
  // selections cannot be inferred from the pathname alone.
  it.each<[string, string[]]>([
    // Search is an overlay button now, so `/search` highlights no rail row.
    ["/search", []],
    ["/search?scope=people", ["People"]],
    ["/saved", ["Saved"]],
    ["/settings/returns", ["Recovered"]],
    ["/reactions", ["Liked / Disliked"]],
    ["/notifications", ["Activity"]],
  ])("selects only the rail destination for %s", (path, label) => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell(path);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(nav)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.getAttribute("aria-label") ?? link.textContent),
    ).toEqual(label);
  });

  it("keeps the rail's destinations, order, targets, names and active treatment", () => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell("/my");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    // Top-to-bottom DOM order is also the visual and keyboard order. The
    // primary six come first, then the prototype's "Others" shelf. Search is
    // the one primary row that is a button (it opens the overlay).
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/", "/my", "/chats", "/notifications", "/insights",
      "/search?scope=people", "/reactions", "/saved", "/settings/returns",
    ]);
    expect(
      links.map((link) => link.getAttribute("aria-label") ?? link.textContent?.trim()),
    ).toEqual([
      "Home", "My Reports", "Chats", "Activity", "Insights",
      "People", "Liked / Disliked", "Saved", "Recovered",
    ]);
    const searchRow = within(nav).getByRole("button", { name: "Search" });
    expect(searchRow.getAttribute("aria-expanded")).toBe("false");
    expect(searchRow.hasAttribute("aria-current")).toBe(false);
    const account = within(nav).getByRole("button", { name: /^Account/ });
    expect(account.getAttribute("aria-expanded")).toBe("false");
    expect(account.hasAttribute("aria-current")).toBe(false);
    // One identity control in the footer: no sibling settings glyph (R1).
    const pin = within(nav).getByRole("button", { name: "Expand navigation" });
    expect([...nav.querySelectorAll("a, button")]).toEqual([
      pin, links[0], links[1], searchRow, ...links.slice(2), account,
    ]);
    expect(
      links
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.textContent?.trim()),
    ).toEqual(["My Reports"]);
    // Same selected-pill treatment as the bar.
    expect(nav.querySelector(".fb-nav-active-bg")).toBeTruthy();
    expect(nav.querySelector(".fb-nav-label")).toBeTruthy();
    // The pin control is the app mark itself (owner order 2026-11-13): one
    // brand button holding the wordmark, with no separate pin glyph beside it.
    const brand = nav.querySelector(".fb-nav-brand");
    expect(brand?.querySelector(".fb-nav-wordmark")?.textContent).toBe("Norfold");
    expect(nav.querySelector(".fb-nav-pin")).toBeNull();
  });

  it("pins the rail into a labelled panel and remembers the choice", () => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-pinned")).toBe("false");
    fireEvent.click(within(nav).getByRole("button", { name: "Expand navigation" }));
    const pinned = screen.getByRole("navigation", { name: "Primary" });
    expect(pinned.getAttribute("data-pinned")).toBe("true");
    expect(loadAppearance().railPinned).toBe(true);
    // Every destination is named in place, and the pin now collapses it again.
    for (const label of ["Home", "My Reports", "Search", "Chats", "Activity", "Insights", "Others", "People", "Liked / Disliked", "Saved", "Recovered"]) {
      expect(within(pinned).getByText(label)).toBeTruthy();
    }
    fireEvent.click(within(pinned).getByRole("button", { name: "Collapse navigation" }));
    expect(screen.getByRole("navigation", { name: "Primary" }).getAttribute("data-pinned")).toBe("false");
    expect(loadAppearance().railPinned).toBe(false);
  });

  it("names a rail destination on pointer dwell without widening the column", () => {
    vi.useFakeTimers();
    try {
      setWidth(800);
      storeNavLayout("rail");
      renderShell("/");
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(nav.getAttribute("data-pinned")).toBe("false");
      const link = within(nav).getByRole("link", { name: "My Reports" });
      fireEvent.pointerEnter(link, { pointerType: "mouse" });
      // Nothing appears on the way in; the dwell is the notification timing.
      expect(document.querySelector(".fb-hover-label")).toBeNull();
      act(() => { vi.advanceTimersByTime(180); });
      const label = document.querySelector(".fb-hover-label");
      expect(label?.textContent).toBe("My Reports");
      // The pill is a visual duplicate of the row's accessible name, never a
      // second announcement.
      expect(label?.getAttribute("aria-hidden")).toBe("true");
      fireEvent.pointerLeave(link, { pointerType: "mouse" });
      expect(document.querySelector(".fb-hover-label")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes layout space beside the content instead of overlaying it", () => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const main = screen.getByRole("main");
    expect(nav.className).not.toMatch(/fixed|absolute/);
    // The rail and the shell-owned name share one anchor box, and that box is
    // the rail's flex item: the name takes no column of its own and no height.
    const anchor = nav.parentElement;
    expect(anchor?.className).toContain("fb-rail-anchor");
    expect(anchor?.parentElement?.className).toContain("flex-row");
    expect(anchor?.nextElementSibling).toBe(main);
    expect(main.getAttribute("data-canvas")).toBe("wide");
    // Rail first, content after it: the DOM order matches the visual order.
    expect(
      nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(main.className).toContain("min-w-0");
    expect(main.className).toContain("flex-1");
  });

  it("sizes the pinned rail from the stored column, not an inline width", () => {
    setWidth(800);
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_APPEARANCE, navLayout: "rail", navLayoutChosen: true, railPinned: true, railWidth: 208,
      }),
    );
    renderShell("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-pinned")).toBe("true");
    // One CSS owner: the stored width is the column's width. An inline width on
    // the rail would paint the stored width inside the column's 4px frame and
    // cover the 8px band to the list.
    expect(document.documentElement.style.getPropertyValue("--fb-rail-w")).toBe("208px");
    expect(nav.style.width).toBe("");
    expect(nav.getAttribute("style") ?? "").not.toMatch(/width/);
    // The drag/keyboard handle still reports the stored column width.
    const grip = screen.getByRole("separator", { name: "Resize navigation" });
    expect(grip.getAttribute("aria-valuenow")).toBe("208");
    expect(grip.getAttribute("aria-valuetext")).toBe("208 pixels");
  });

  it.each([320, 500])("honours a chosen bottom bar on a phone instead of forcing a rail", (width) => {
    setWidth(width);
    storeNavLayout("bottom");
    renderShell("/");
    expect(navLayouts()).toEqual(expect.arrayContaining(["bottom"]));
    expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
  });

  it("anchors the app name to the rail head instead of a route's own top row", () => {
    setWidth(800);
    stubMatchMedia(true);
    storeNavLayout("rail");
    renderShell("/brand");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const anchor = document.querySelector(".fb-rail-anchor");
    const brand = document.querySelector(".fb-nav-outside-brand");
    expect(anchor).not.toBeNull();
    expect(brand?.textContent).toBe("Norfold");
    // One physical owner: the name is the rail's sibling inside the shell's
    // anchor, not a copy a route header positions with its own padding.
    expect(anchor!.querySelector(".fb-nav-rail")).toBe(nav);
    expect(anchor!.contains(brand)).toBe(true);
    expect(screen.getByRole("main").contains(brand)).toBe(false);
    // The route still owns its one top row, and that row carries no copy.
    const bar = screen.getByTestId("app-bar");
    expect(bar.querySelector(".fb-nav-outside-brand")).toBeNull();
    expect(within(bar).getByRole("heading", { name: "Brand route" })).toBeTruthy();
  });

  it("keeps the same name node through a route change", () => {
    // 900px keeps the rail on a chat thread too (`showNav` needs the medium
    // breakpoint there), so the chat state is observable without a drawer.
    setWidth(900);
    stubMatchMedia(true);
    storeNavLayout("rail");
    render(
      <HoverLabelProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes><Route element={<Shell />}>
            <Route index element={<Link to="/brand">Open brand route</Link>} />
            <Route path="/brand" element={<><AppBar title="Brand route" utilities={false} /><Link to="/chats/c-1">Open thread</Link></>} />
            {/* A matched chat route keeps the shell layout mounted, so the
                name's node identity can be observed across both screens. */}
            <Route path="/chats/:id" element={<p>Chat thread</p>} />
          </Route></Routes>
        </MemoryRouter>
      </HoverLabelProvider>,
    );
    const brand = document.querySelector(".fb-nav-outside-brand");
    expect(brand?.textContent).toBe("Norfold");
    fireEvent.click(screen.getByRole("link", { name: "Open brand route" }));
    // The shell anchor is outside the routed tree, so navigation cannot move,
    // remount or duplicate the name.
    expect(document.querySelector(".fb-nav-outside-brand")).toBe(brand);
    expect(document.querySelectorAll(".fb-nav-outside-brand")).toHaveLength(1);
    // The chat routes keep that same one name; only their secondary chrome
    // reserves the band.
    fireEvent.click(screen.getByRole("link", { name: "Open thread" }));
    expect(document.querySelector(".fb-nav-outside-brand")).toBe(brand);
    expect(document.querySelectorAll(".fb-nav-outside-brand")).toHaveLength(1);
  });

  it("renders no outside name without an in-flow rail", () => {
    setWidth(800);
    stubMatchMedia(true);
    storeNavLayout("bottom");
    renderShell("/");
    expect(document.querySelector(".fb-nav-outside-brand")).toBeNull();
  });

  it("never duplicates the name in a phone drawer", () => {
    setWidth(390);
    stubMatchMedia(false);
    storeNavLayout("rail");
    renderShell("/brand");
    expect(document.querySelector(".fb-nav-outside-brand")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    // The drawer's own head names the app; the shell anchor stays empty.
    expect(within(drawer).getByText("Norfold")).toBeTruthy();
    expect(document.querySelector(".fb-nav-outside-brand")).toBeNull();
    expect(screen.getByTestId("app-bar").textContent).not.toContain("Norfold");
  });

  it("hides the rail on chrome-free routes", () => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell("/help");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
  });

  it("hides the rail during fullscreen and restores it on exit", () => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell("/");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.body });
    try {
      act(() => document.dispatchEvent(new Event("fullscreenchange")));
      expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    } finally {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      act(() => document.dispatchEvent(new Event("fullscreenchange")));
    }
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
  });

  it("keeps every rail label under forced reduced motion", () => {
    setWidth(800);
    storeNavLayout("rail");
    render(
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={["/"]}>
          <Routes><Route element={<Shell />}>
            <Route index element={<p>Home screen</p>} />
          </Route></Routes>
        </MemoryRouter>
      </MotionConfig>,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("data-layout")).toBe("rail");
    for (const label of ["Home", "My Reports", "Chats"]) {
      expect(within(nav).getByText(label)).toBeTruthy();
    }
    // The footer is one identity control, so there is no Settings label to keep.
    expect(within(nav).getByRole("button", { name: /^Account/ })).toBeTruthy();
  });

  it("pins the rail's geometry with computed styles, not source text", () => {
    // The stylesheet is injected into the test document so `getComputedStyle`
    // runs the real cascade: a later rule that overrode the width, the column
    // direction or the flex basis would change these values. (In the app,
    // Vite loads the same file; jsdom does not import CSS on its own.)
    const style = document.createElement("style");
    style.textContent = readFileSync("src/components/Shell.nav.css", "utf8");
    document.head.appendChild(style);
    try {
      setWidth(800);
      storeNavLayout("rail");
      renderShell("/");
      const nav = screen.getByRole("navigation", { name: "Primary" });
      const rail = getComputedStyle(nav);
      expect(rail.display).toBe("flex");
      expect(rail.flexDirection).toBe("column");
      expect(rail.flexGrow).toBe("0");
      expect(rail.flexShrink).toBe("0");
      // Collapsed rail width lives in a token so the hover expansion can
      // compute the exact negative margin that keeps <main> from reflowing.
      expect(rail.width).toBe("var(--fb-rail-collapsed)");
      expect(rail.getPropertyValue("--fb-rail-collapsed").trim()).toBe("64px");
      expect(rail.getPropertyValue("--fb-rail-expanded").trim()).toBe("196px");
      // The head keeps the app mark at every width. Collapsed, the name is not
      // squeezed into the icon column: it is painted outside the rail instead.
      const collapsedWordmark = nav.querySelector(".fb-nav-wordmark");
      const collapsedMark = nav.querySelector(".fb-nav-brand-mark");
      expect(collapsedWordmark).toBeTruthy();
      expect(collapsedMark).toBeTruthy();
      expect(getComputedStyle(collapsedWordmark as HTMLElement).display).toBe("none");
      expect(getComputedStyle(collapsedMark as HTMLElement).display).not.toBe("none");
      // The outside name reads its vertical anchor from the same head geometry:
      // 8px rail padding plus half of the 40px head, declared once.
      expect(rail.getPropertyValue("--fb-rail-head-center").trim()).toBe("28px");
      // Positioned only so the resize handle can anchor to the rail's inner
      // edge. It stays an in-flow flex column (never fixed/absolute), which is
      // what keeps it from covering the content.
      expect(rail.position).toBe("relative");
      const item = getComputedStyle(
        within(nav).getByRole("link", { name: "My Reports" }),
      );
      // Compact rows: ten destinations plus the identity control fit a
      // 640px-tall window without the rail becoming a scroller.
      expect(item.minHeight).toBe("38px");
      expect(item.flexDirection).toBe("column");
      // Pinned, the same head names the app beside the mark, so the outside
      // copy is free to yield and the name never appears twice.
      fireEvent.click(within(nav).getByRole("button", { name: "Expand navigation" }));
      const pinned = screen.getByRole("navigation", { name: "Primary" });
      expect(getComputedStyle(pinned.querySelector(".fb-nav-wordmark") as HTMLElement).display).not.toBe("none");
      expect(getComputedStyle(pinned.querySelector(".fb-nav-brand-mark") as HTMLElement).display).not.toBe("none");
    } finally {
      style.remove();
    }
  });
});

describe("Shell chat dock host (R19 T3)", () => {
  const initialWidth = window.innerWidth;
  const bottomInset = "calc(66px + env(safe-area-inset-bottom) + 8px)";
  const restingInset = "max(12px, env(safe-area-inset-bottom))";

  function setWidth(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  }

  function storeNavLayout(navLayout: "auto" | "bottom" | "rail") {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APPEARANCE, navLayout, navLayoutChosen: true }),
    );
  }

  function viewportInset() {
    return document.querySelector<HTMLElement>(".fb-app-viewport")!.style.getPropertyValue("--fb-chat-dock-bottom");
  }

  function dockState() {
    const dock = screen.getByTestId("chat-dock");
    return {
      dock,
      occluded: dock.getAttribute("data-occluded"),
      bottomNav: dock.getAttribute("data-bottom-nav"),
    };
  }

  afterEach(() => {
    localStorage.clear();
    act(() => resetGlobalSearch());
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: initialWidth });
  });

  it("mounts one host beside <main> and publishes the bottom-bar inset", () => {
    setWidth(1200);
    storeNavLayout("bottom");
    renderShell("/");
    const viewport = document.querySelector<HTMLElement>(".fb-app-viewport");
    expect(viewportInset()).toBe(bottomInset);
    const { dock, occluded, bottomNav } = dockState();
    expect(screen.getAllByTestId("chat-dock")).toHaveLength(1);
    expect(occluded).toBe("false");
    expect(bottomNav).toBe("true");
    // A shell sibling of the routed page, never part of it.
    expect(dock.parentElement).toBe(viewport);
    expect(screen.getByRole("main").contains(dock)).toBe(false);
    expect(
      screen.getByRole("main").compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the resting inset when a rail is painted instead of the bar", () => {
    setWidth(800);
    storeNavLayout("rail");
    renderShell("/");
    expect(screen.getByRole("navigation", { name: "Primary" }).getAttribute("data-layout")).toBe("rail");
    expect(viewportInset()).toBe(restingInset);
    expect(dockState().bottomNav).toBe("false");
  });

  it("reports no bottom bar and keeps the host on a chrome-free route", () => {
    setWidth(393);
    storeNavLayout("bottom");
    renderShell("/help");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(viewportInset()).toBe(restingInset);
    expect(dockState().bottomNav).toBe("false");
  });

  it("occludes the host while the settings window is open, and only then", () => {
    setWidth(1200);
    storeNavLayout("bottom");
    renderShell("/");
    expect(dockState().occluded).toBe("false");
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(dockState().occluded).toBe("true");
    // DOM order matches the z-order scale: the dock, then the window above it.
    const dock = screen.getByTestId("chat-dock");
    const settings = screen.getByTestId("settings-window");
    expect(dock.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(dockState().occluded).toBe("false");
    expect(screen.getByText("Home screen")).toBeTruthy();
  });

  it("occludes the host while global search is open", () => {
    storeNavLayout("bottom");
    renderShell("/");
    expect(dockState().occluded).toBe("false");
    act(() => openGlobalSearch(document.body));
    expect(dockState().occluded).toBe("true");
    act(() => closeGlobalSearch());
    expect(dockState().occluded).toBe("false");
  });

  it("occludes the host while the phone navigation drawer is open", () => {
    setWidth(390);
    storeNavLayout("rail");
    renderShell("/");
    expect(dockState().occluded).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(dockState().occluded).toBe("true");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Navigation" })).getByRole("button", { name: "Close navigation" }),
    );
    expect(dockState().occluded).toBe("false");
  });

  it("takes its fullscreen signal from the shell's one probe", () => {
    storeNavLayout("bottom");
    renderShell("/");
    expect(dockState().occluded).toBe("false");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.body });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    // One probe, one event: the nav and the dock agree in the same commit.
    expect(dockState().occluded).toBe("true");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(dockState().occluded).toBe("false");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
  });

  it("stays visible when the host leaves fullscreenElement undefined", () => {
    // A webview or a test document need not implement the Fullscreen API, so
    // the property can be undefined rather than null. Only a truthy element is
    // fullscreen, exactly as the nav's old probe read it; undefined must not
    // hide the nav or occlude the dock.
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: undefined });
    storeNavLayout("bottom");
    renderShell("/");
    expect(dockState().occluded).toBe("false");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(dockState().occluded).toBe("false");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
  });

  it("leaves the one host mounted across a chat route so a draft is not discarded", () => {
    setWidth(393);
    storeNavLayout("bottom");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route element={<Shell />}>
          <Route index element={<Link to="/chats/c-1">Open thread</Link>} />
          <Route path="/chats/:id" element={<><p>Chat thread</p><Link to="/">Back to home</Link></>} />
        </Route></Routes>
      </MemoryRouter>,
    );
    const first = screen.getByTestId("chat-dock");
    fireEvent.click(screen.getByRole("link", { name: "Open thread" }));
    // Route eligibility belongs to the dock; the shell never unmounts it.
    expect(screen.getByTestId("chat-dock")).toBe(first);
    expect(screen.queryAllByTestId("chat-dock")).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "Back to home" }));
    expect(screen.getByTestId("chat-dock")).toBe(first);
  });
});
