// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(), exitApp: vi.fn() } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));

import { App as CapacitorApp } from "@capacitor/app";
import { BackButtonHandler } from "./BackButtonHandler";
import {
  registerBackInterceptor,
  resetBackInterceptors,
  resetHistorySuppression,
} from "./backNavigation";

afterEach(() => {
  cleanup();
  resetHistorySuppression();
  resetBackInterceptors();
  vi.mocked(CapacitorApp.addListener).mockReset();
  window.history.replaceState(null, "");
});

function PathProbe() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

/**
 * Renders the real handler at a route with a real history entry behind it, and
 * returns the callback Capacitor would invoke for a hardware back press.
 */
async function mountAt(pathname: string, { behind = true } = {}) {
  let press: (() => void) | undefined;
  vi.mocked(CapacitorApp.addListener).mockImplementation(((...args: unknown[]) => {
    press = args[1] as () => void;
    return Promise.resolve({ remove: vi.fn() });
  }) as unknown as typeof CapacitorApp.addListener);
  // The WebView's own history position; the in-app stack is React Router's.
  window.history.replaceState({ idx: behind ? 4 : 0 }, "");
  render(
    <MemoryRouter initialEntries={behind ? ["/profile", pathname] : [pathname]} initialIndex={behind ? 1 : 0}>
      <BackButtonHandler />
      <Routes>
        <Route path="/profile" element={<PathProbe />} />
        <Route path="/chats" element={<PathProbe />} />
        <Route path="/chats/:conversationId" element={<PathProbe />} />
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(press).toBeInstanceOf(Function));
  return () => press!();
}

describe("Android Back handler", () => {
  it("leaves a conversation for the chat list even with history behind it", async () => {
    const pressBack = await mountAt("/chats/conversation");
    expect(screen.getByTestId("path").textContent).toBe("/chats/conversation");
    act(() => pressBack());
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/chats"));
  });

  it("leaves a cold-linked conversation for the chat list", async () => {
    const pressBack = await mountAt("/chats/conversation", { behind: false });
    act(() => pressBack());
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/chats"));
  });

  it("lets an open overlay consume the press before the conversation leaves", async () => {
    const release = registerBackInterceptor(() => true);
    try {
      const pressBack = await mountAt("/chats/conversation");
      act(() => pressBack());
      expect(screen.getByTestId("path").textContent).toBe("/chats/conversation");
      release();
      act(() => pressBack());
      await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/chats"));
    } finally {
      release();
    }
  });

  it("keeps history behaviour on other screens", async () => {
    const pressBack = await mountAt("/help");
    act(() => pressBack());
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/profile"));
  });

  it("keeps history behaviour on the chat list itself", async () => {
    const pressBack = await mountAt("/chats");
    act(() => pressBack());
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/profile"));
  });
});
