import { expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

const PLACEHOLDER = "Choose a category";
const SHEET_NAME = /choose a category/i;
/** Query the DOM, not the a11y tree: an open overlay can aria-hide a mounted dialog. */
const SHEET_SELECTOR = '[role="dialog"][aria-label="Choose a category"]';

/** The custom category trigger (replaces the old native select). */
export function categoryTrigger(): HTMLElement {
  return screen.getByTestId("category-trigger");
}

/** Current committed category string, or "" when nothing is selected. */
export function categoryValue(): string {
  const text = categoryTrigger().textContent?.trim() ?? "";
  return text === PLACEHOLDER ? "" : text;
}

/**
 * Drive the searchable category sheet the way a person does: open the trigger,
 * press the canonical option, and prove the value was committed. The sheet opens
 * within the trigger press (the component's own suite relies on it), so opening
 * and selecting stay in one interaction turn. No manual focus: the row's focus
 * handler writes React state outside `act`.
 */
export async function chooseCategory(canonical: string): Promise<void> {
  fireEvent.click(categoryTrigger());
  const sheet = screen.getByRole("dialog", { name: SHEET_NAME });
  const row = within(sheet).getByRole("button", { name: canonical });
  expect(sheet.isConnected).toBe(true);
  expect(row.isConnected).toBe(true);
  fireEvent.click(row);
  // The committed value is the post-condition; the sheet closing is not proof of it.
  expect(categoryValue()).toBe(canonical);
  await waitFor(() => expect(document.querySelector(SHEET_SELECTOR)).toBeNull());
}
