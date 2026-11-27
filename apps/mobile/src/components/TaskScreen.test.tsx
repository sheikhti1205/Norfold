// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskScreen, type TaskScreenProps } from "./TaskScreen";

afterEach(cleanup);

/** Everything the fixed fixture below does not supply, all optional. */
type MountProps = Pick<TaskScreenProps, "description" | "actions" | "busy">;

function mount(props: Partial<MountProps> = {}) {
  const onBack = vi.fn();
  render(
    <TaskScreen title="Create report" onBack={onBack} {...props}>
      <p>Screen body</p>
    </TaskScreen>,
  );
  const section = document.querySelector("section.fb-task-screen");
  if (!(section instanceof HTMLElement)) throw new Error("no task screen rendered");
  return { onBack, section };
}

describe("TaskScreen", () => {
  it("is a named section on the page, never a dialog over it", () => {
    const { section } = mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".fb-modal-backdrop")).toBeNull();

    // The landmark is named by the visible heading, not by an aria-label.
    const labelId = section.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const heading = document.getElementById(labelId as string);
    expect(heading?.tagName).toBe("H1");
    expect(heading?.textContent).toBe("Create report");
    expect(screen.getByRole("heading", { level: 1, name: "Create report" })).toBe(heading);

    // A page in place: no scroll lock is installed on the document.
    expect(document.body.style.overflow).toBe("");
  });

  it("lands focus on the heading, not in a field", () => {
    mount();
    const heading = screen.getByRole("heading", { level: 1, name: "Create report" });
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
  });

  it("gives Back a 48px target with an accessible name", () => {
    const { onBack } = mount();
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.classList.contains("min-h-[48px]")).toBe(true);
    expect(back.classList.contains("min-w-[48px]")).toBe(true);

    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the description, the actions slot and its children", () => {
    mount({
      description: "Posting as @tester.",
      actions: <button type="button">Publish</button>,
    });
    expect(screen.getByText("Posting as @tester.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByText("Screen body")).toBeTruthy();
  });

  it("disables Back and the actions while busy without unmounting them", () => {
    const { section } = mount({ busy: true, actions: <button type="button">Publish</button> });

    expect(section.getAttribute("aria-busy")).toBe("true");

    const back = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(document.body.contains(back)).toBe(true);

    // A disabled fieldset is what stops the action group taking input; the
    // control itself stays mounted and keeps its name.
    const actions = screen.getByText("Publish").closest("fieldset") as HTMLFieldSetElement | null;
    expect(actions).toBeTruthy();
    expect(actions?.disabled).toBe(true);
    expect(document.body.contains(actions)).toBe(true);
  });
});

describe("TaskScreen compact header contract", () => {
  const css = readFileSync("src/components/TaskScreen.css", "utf8");

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start).split("}")[0]!;
  }

  it("spends the shell's vertical safe area exactly once", () => {
    // .fb-app-viewport already pads the routed area at the top and bottom.
    // A second inset here would double the shell's own padding.
    expect(css).not.toContain("safe-area-inset-top");
    expect(css).not.toContain("safe-area-inset-bottom");
    expect(rule(".fb-task-screen-header")).toMatch(/padding-block:\s*8px/);
  });

  it("keeps one compact navigation row with 48px Back and action targets", () => {
    const bar = rule(".fb-task-screen-bar");
    expect(bar).toMatch(/min-height:\s*48px/);
    expect(bar).toMatch(/grid-template-columns:[\s\S]*minmax\(0,\s*auto\)/);

    const back = rule(".fb-task-screen-back");
    expect(back).toMatch(/min-width:\s*48px/);
    expect(back).toMatch(/min-height:\s*48px/);

    const actions = rule(".fb-task-screen-actions");
    expect(actions).toMatch(/min-width:\s*48px/);
    expect(actions).toMatch(/min-height:\s*48px/);
  });

  it("keeps the title centred and ellipsized instead of overflowing at large text", () => {
    const title = rule(".fb-task-screen-title");
    expect(title).toMatch(/text-align:\s*center/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/white-space:\s*nowrap/);
  });
});
