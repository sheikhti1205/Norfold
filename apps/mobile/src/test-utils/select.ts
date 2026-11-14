import { expect } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Drive the shared SelectField the way a reader does: open the trigger, pick
 * the row by its visible label, and wait for the listbox to close. Native
 * `change` events no longer exist on any dropdown in the app.
 */
export async function chooseSelectOption(
  trigger: HTMLElement,
  optionLabel: string | RegExp,
): Promise<void> {
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionLabel });
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

/** The trigger's visible value, which is what a reader sees in the field. */
export function selectValue(label: string): string {
  return screen.getByLabelText(label).textContent?.trim() ?? "";
}
