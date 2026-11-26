// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FORMATTING_COMMANDS } from "./formattingCommands";
import { FormattingMenu, type FormattingMenuProps } from "./FormattingMenu";

// Two history rows then two text rows: one group pair per heading.
const TWO_GROUPS = FORMATTING_COMMANDS.slice(0, 4);

const BASE_PROPS: FormattingMenuProps = {
  open: true,
  items: TWO_GROUPS,
  activeIndex: -1,
  getAnchorRect: () => new DOMRect(24, 96, 0, 20),
  onHover: () => undefined,
  onPick: () => undefined,
  label: "Formatting commands",
};

function renderMenu(overrides: Partial<FormattingMenuProps> = {}) {
  const props: FormattingMenuProps = { ...BASE_PROPS, ...overrides };
  return render(<FormattingMenu {...props} />);
}

function headings(): Element[] {
  return Array.from(document.querySelectorAll('[role="presentation"]'));
}

afterEach(cleanup);

describe("FormattingMenu", () => {
  it("renders nothing while closed", () => {
    renderMenu({ open: false });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("renders nothing when there are no items", () => {
    renderMenu({ items: [] });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("renders one option per item and one presentation heading per group", () => {
    renderMenu();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(headings().map((heading) => heading.textContent)).toEqual(["History", "Text"]);
  });

  it("marks only the active index as selected", () => {
    renderMenu({ activeIndex: 2 });
    screen.getAllByRole("option").forEach((option, index) => {
      expect(option.getAttribute("aria-selected")).toBe(index === 2 ? "true" : "false");
    });
  });

  it("picks the row the pointer clicks", () => {
    const onPick = vi.fn();
    renderMenu({ onPick });
    fireEvent.click(screen.getAllByRole("option")[3]!);
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("reports the hovered row", () => {
    const onHover = vi.fn();
    renderMenu({ onHover });
    fireEvent.pointerOver(screen.getAllByRole("option")[1]!, { pointerType: "mouse" });
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it("keeps the option ids and indices in the item space across group headings", () => {
    const onPick = vi.fn();
    renderMenu({ onPick });
    const options = screen.getAllByRole("option");
    options.forEach((option, index) => {
      expect(option.id.endsWith(`-opt-${index}`)).toBe(true);
    });
    fireEvent.click(options[options.length - 1]!);
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("prevents the default of a press on the listbox so the editor keeps focus", () => {
    renderMenu();
    const listbox = screen.getByRole("listbox", { name: "Formatting commands" });
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const notCanceled = listbox.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(notCanceled).toBe(false);
  });

  it("names the listbox for assistive tech", () => {
    renderMenu();
    const listbox = screen.getByRole("listbox", { name: "Formatting commands" });
    expect(listbox.getAttribute("aria-label")).toBe("Formatting commands");
  });

  it("asks the caller for the live caret rect while open", async () => {
    const getAnchorRect = vi.fn(() => new DOMRect(24, 96, 0, 20));
    renderMenu({ getAnchorRect });
    await waitFor(() => expect(getAnchorRect).toHaveBeenCalled());
  });
});
