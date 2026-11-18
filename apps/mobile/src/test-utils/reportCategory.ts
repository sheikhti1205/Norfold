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
 * press the canonical option, and prove the value was committed.
 */
export async function chooseCategory(canonical: string): Promise<void> {
  fireEvent.click(categoryTrigger());
  const sheet = await screen.findByRole("dialog", { name: SHEET_NAME });
  const row = within(sheet).getByRole("button", { name: canonical });
  // Focus the row before pressing it, as a person would.
  row.focus();
  fireEvent.click(row);
  // The committed value is the post-condition; the sheet closing is not proof of it.
  expect(categoryValue()).toBe(canonical);
  await waitFor(() => expect(document.querySelector(SHEET_SELECTOR)).toBeNull());
}
