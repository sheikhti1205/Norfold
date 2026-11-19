// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CATEGORY_OPTIONS, CategoryField } from "./CategoryField";
import { categoryTrigger, categoryValue } from "../test-utils/reportCategory";

afterEach(() => {
  // Unmount before restoring the spies so pending cancels still reach the
  // installed frame queue.
  cleanup();
  vi.restoreAllMocks();
});

/**
 * A faithful rAF queue: real ids, real cancellation, one snapshot per frame and
 * increasing timestamps. Frames run only when a test steps them, so focus can be
 * decided before a deferred restore lands.
 */
function installFrameQueue() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let timestamp = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pending.delete(id);
  });
  return {
    get pending() {
      return pending.size;
    },
    step() {
      timestamp += 16;
      // Snapshot this frame: a callback cancelled mid-frame never runs, and a
      // frame requested now waits for the next step.
      const frame = Array.from(pending);
      act(() => {
        for (const [id, callback] of frame) {
          if (pending.get(id) !== callback) continue;
          pending.delete(id);
          callback(timestamp);
        }
      });
    },
    drain(maxFrames = 5) {
      for (let frame = 0; frame < maxFrames && pending.size > 0; frame += 1) {
        this.step();
      }
      if (pending.size > 0) {
        throw new Error(`frame queue did not settle: ${pending.size} callbacks pending`);
      }
    },
  };
}

describe("CategoryField (P3 searchable grouped sheet)", () => {
  it("opens an anchored popover, focuses search, and restores focus on Escape", async () => {
    render(<CategoryField value="" onChange={() => {}} />);
    const trigger = categoryTrigger();
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "Search categories" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.queryByTestId("bottom-sheet-content")).toBeNull();
    expect(screen.getByTestId("category-popover")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it("keeps one category in the tab order and moves it with arrow keys", () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const results = screen.getByTestId("category-results");
    expect(results.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    const first = screen.getByRole("button", { name: "Electronics" });
    const next = screen.getByRole("button", { name: "Phones & Tablets" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(next);
    expect(results.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  });
  it("dismisses an open sheet when locked and does not reopen on unlock", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<CategoryField value="Electronics" onChange={onChange} />);
    fireEvent.click(categoryTrigger());
    expect(screen.getByRole("dialog")).toBeTruthy();
    rerender(<CategoryField value="Electronics" onChange={onChange} disabled />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(<CategoryField value="Electronics" onChange={onChange} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("exposes all 25 released canonical options for submission", () => {
    expect(CATEGORY_OPTIONS.map((o) => o.value)).toEqual([
      "Electronics",
      "Bags & Wallets",
      "Keys",
      "Documents & IDs",
      "Books & Stationery",
      "Clothing",
      "Accessories & Jewelry",
      "Other",
      "Phones & Tablets",
      "Computers & Accessories",
      "Audio & Wearables",
      "Cameras & Photography",
      "Watches & Eyewear",
      "Footwear",
      "Personal Care",
      "Tools & Equipment",
      "Office Supplies",
      "Umbrellas & Bottles",
      "Household Items",
      "Sports & Fitness",
      "Toys & Games",
      "Travel & Luggage",
      "Vehicle Accessories",
      "Medical & Health Items",
      "Pet Accessories",
    ]);
  });

  it("shows a placeholder trigger, not a native select", () => {
    const { container } = render(<CategoryField value="" onChange={() => {}} />);
    expect(container.querySelector("select")).toBeNull();
    expect(categoryTrigger()).toBeTruthy();
    expect(categoryValue()).toBe("");
  });

  it("opens the sheet with search and grouped options", () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    expect(screen.getByRole("dialog", { name: /choose a category/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/search categories/i)).toBeTruthy();
    expect(screen.getByText("Tech")).toBeTruthy();
  });

  it("commits a released category and closes the sheet", async () => {
    const onChange = vi.fn();
    render(<CategoryField value="" onChange={onChange} />);
    fireEvent.click(categoryTrigger());
    fireEvent.click(screen.getByRole("button", { name: "Electronics" }));
    expect(onChange).toHaveBeenCalledWith("Electronics");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /choose a category/i })).toBeNull(),
    );
  });

  it("commits a cutover category and closes the sheet", async () => {
    const onChange = vi.fn();
    render(<CategoryField value="" onChange={onChange} />);
    fireEvent.click(categoryTrigger());
    const option = screen.getByRole("button", { name: "Phones & Tablets" }) as HTMLButtonElement;
    expect(option.disabled).toBe(false);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("Phones & Tablets");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /choose a category/i })).toBeNull(),
    );
  });

  it("finds a cutover category through a synonym and commits it", () => {
    const onChange = vi.fn();
    render(<CategoryField value="" onChange={onChange} />);
    fireEvent.click(categoryTrigger());
    fireEvent.change(screen.getByPlaceholderText(/search categories/i), {
      target: { value: "spectacles" },
    });
    const match = screen.getByRole("button", { name: "Watches & Eyewear" }) as HTMLButtonElement;
    expect(match.disabled).toBe(false);
    fireEvent.click(match);
    expect(onChange).toHaveBeenCalledWith("Watches & Eyewear");
  });

  it.each([
    ["phone", "Phones & Tablets"],
    ["laptop", "Computers & Accessories"],
    ["camera", "Cameras & Photography"],
  ] as Array<[string, string]>)("offers the specific cutover option when searching %s", (query, expected) => {
    const onChange = vi.fn();
    render(<CategoryField value="" onChange={onChange} />);
    fireEvent.click(categoryTrigger());
    fireEvent.change(screen.getByPlaceholderText(/search categories/i), { target: { value: query } });
    const option = screen.getByRole("button", { name: expected }) as HTMLButtonElement;
    expect(option.disabled).toBe(false);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it("clears the query and recovers from zero results", () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const search = screen.getByPlaceholderText(/search categories/i);
    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText(/No categories match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show all categories/i }));
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("keeps search in a fixed header outside the scrolling results", () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const header = screen.getByTestId("category-search-header");
    expect(header.contains(screen.getByPlaceholderText(/search categories/i))).toBe(true);
    expect(screen.queryByTestId("bottom-sheet-content")).toBeNull();
    const results = screen.getByTestId("category-results");
    expect(results.className).toMatch(/overflow-y-auto/);
  });

  it("announces the result count while filtering", () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    fireEvent.change(screen.getByPlaceholderText(/search categories/i), {
      target: { value: "spectacles" },
    });
    expect(screen.getByText(/1 category/)).toBeTruthy();
  });

  it("separates groups with dividers and tints the selected row", () => {
    render(<CategoryField value="Keys" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const sections = screen.getByTestId("category-results").querySelectorAll("section[aria-label]");
    expect(sections.length).toBeGreaterThan(1);
    const second = sections[1];
    expect(second).toBeTruthy();
    expect(second?.className).toMatch(/border-t/);
    const selected = screen.getByRole("button", { name: "Keys" });
    expect(selected.className).toMatch(/bg-surface-container/);
    expect(selected.getAttribute("aria-pressed")).toBe("true");
  });

  it("marks the trigger invalid and announces the error", () => {
    render(<CategoryField value="" onChange={() => {}} error="Choose a category" />);
    expect(screen.getByRole("alert").textContent).toBe("Choose a category");
    expect(categoryTrigger().getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the selected value on the trigger", () => {
    render(<CategoryField value="Keys" onChange={() => {}} />);
    expect(categoryValue()).toBe("Keys");
  });

  it("fades the results panel in when the sheet opens", async () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const results = screen.getByTestId("category-results");
    // Entrance starts hidden and settled, never mid-flight.
    expect(results.style.opacity).toBe("0");
    await waitFor(() => expect(results.style.opacity).toBe("1"));
    expect(results.style.transform === "" || results.style.transform === "none").toBe(true);
  });

  it("staggers result rows in and leaves them steady once settled", async () => {
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const rows = Array.from(
      screen.getByTestId("category-results").querySelectorAll("button"),
    ) as HTMLButtonElement[];
    expect(rows.length).toBeGreaterThan(9);
    const lastRow = rows[rows.length - 1]!;
    // Queued behind the capped stagger delay while earlier rows are already moving.
    expect(lastRow.style.opacity).toBe("0");
    await waitFor(() => expect(lastRow.style.opacity).toBe("1"));
    // No endless pulse: it stays put afterwards.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(lastRow.style.opacity).toBe("1");
    expect(lastRow.style.transform === "" || lastRow.style.transform === "none").toBe(true);
  });

  it("acknowledges the selected row with a persistent mark and aria-pressed", async () => {
    const { rerender } = render(<CategoryField value="Keys" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    const mark = (name: string) =>
      screen.getByRole("button", { name }).querySelector("span[aria-hidden]") as HTMLElement;

    const selected = mark("Keys");
    const other = mark("Electronics");
    expect(selected).toBeTruthy();
    expect(other).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keys" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Electronics" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    // The mark is always in the DOM and only its opacity/scale differ.
    expect(selected.style.opacity).toBe("1");
    expect(other.style.opacity).toBe("0");

    // Selection moves: the acknowledgement follows without a remount blink.
    rerender(<CategoryField value="Electronics" onChange={() => {}} />);
    await waitFor(() => expect(mark("Electronics").style.opacity).toBe("1"));
    await waitFor(() => expect(mark("Keys").style.opacity).toBe("0"));
    expect(screen.getByRole("button", { name: "Keys" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Electronics" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("does not steal focus that moved on purpose before the close frame lands", async () => {
    const frames = installFrameQueue();
    render(<CategoryField value="" onChange={() => {}} />);
    fireEvent.click(categoryTrigger());
    fireEvent.click(screen.getByRole("button", { name: "Electronics" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The form focuses its validation summary after an invalid publish.
    const summary = document.createElement("p");
    summary.tabIndex = -1;
    document.body.appendChild(summary);
    summary.focus();

    frames.drain();
    expect(document.activeElement).toBe(summary);
    summary.remove();
  });

  it("returns focus to the trigger when closing left focus on the body", async () => {
    const frames = installFrameQueue();
    render(<CategoryField value="" onChange={() => {}} />);
    const trigger = categoryTrigger();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Electronics" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The focused search field went away with the panel.
    expect(document.activeElement).toBe(document.body);

    frames.drain();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves focus in another field's open panel when this field closes", async () => {
    const frames = installFrameQueue();
    render(
      <>
        <CategoryField value="" onChange={() => {}} />
        <CategoryField value="" onChange={() => {}} />
      </>,
    );
    const [first, second] = screen.getAllByTestId("category-trigger");
    // Open and close the first field; its restore frame is still pending.
    fireEvent.click(first!);
    fireEvent.click(first!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(second!);
    const otherSearch = screen.getByRole("searchbox", { name: "Search categories" });
    otherSearch.focus();

    frames.drain();
    expect(document.activeElement).toBe(otherSearch);
  });

  it("cancels the pending close restore when the panel reopens first", () => {
    const frames = installFrameQueue();
    render(<CategoryField value="" onChange={() => {}} />);
    const trigger = categoryTrigger();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    const afterClose = frames.pending;
    expect(afterClose).toBeGreaterThan(0);

    fireEvent.click(trigger);
    expect(frames.pending).toBeLessThan(afterClose);

    const search = screen.getByRole("searchbox", { name: "Search categories" });
    search.focus();
    frames.drain();
    expect(document.activeElement).toBe(search);
  });

  it("coalesces two closes in the same tick into one restore", () => {
    const frames = installFrameQueue();
    render(<CategoryField value="" onChange={() => {}} />);
    const trigger = categoryTrigger();

    // One close schedules one deferred restore.
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    const afterOneClose = frames.pending;
    expect(afterOneClose).toBeGreaterThan(0);
    frames.drain();
    expect(document.activeElement).toBe(trigger);

    // Both presses land before React commits the first close.
    fireEvent.click(trigger);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(frames.pending).toBe(afterOneClose);
    frames.drain();
    expect(document.activeElement).toBe(trigger);
  });
});
