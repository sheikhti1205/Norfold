// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LongPressArea } from "./LongPressArea";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("reports the target when the keyboard opens the surface too", () => {
  const onOpen = vi.fn();
  render(<LongPressArea label="Options for your message" onOpen={onOpen}>
    {({ open }) => <button type="button">{open ? "menu open" : "closed"}</button>}
  </LongPressArea>);
  fireEvent.keyDown(screen.getByRole("group", { name: /Options for your message/ }), { key: "F10", shiftKey: true });
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.getByText("menu open")).toBeTruthy();
});

it("reports the message a hold opened the surface for exactly once", () => {
  vi.useFakeTimers();
  const onOpen = vi.fn();
  render(<LongPressArea label="Options for your message" onOpen={onOpen}>
    {({ open }) => <button type="button">{open ? "menu open" : "closed"}</button>}
  </LongPressArea>);
  const surface = screen.getByRole("group", { name: /Options for your message/ });
  fireEvent.pointerDown(surface, { pointerType: "touch", clientX: 4, clientY: 4 });
  act(() => { vi.advanceTimersByTime(450); });
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.getByText("menu open")).toBeTruthy();
});
