import { fireEvent, screen } from "@testing-library/react";

/**
 * The rail's trailing slot owns the actions a writer does not press while
 * composing: history replay, block-level insertion, clipboard, cleanup and the
 * full-screen mode. Tests open that one menu and pick a row by its label.
 */
export function openRailMore(): HTMLElement {
  const more = screen.getByRole("button", { name: "More" });
  if (more.getAttribute("aria-expanded") !== "true") fireEvent.click(more);
  return screen.getByRole("listbox", { name: "More formatting actions" });
}

/** Opens the trailing menu and activates the row with `name`. */
export function pickRailMore(name: string): void {
  openRailMore();
  fireEvent.click(screen.getByRole("option", { name }));
}
