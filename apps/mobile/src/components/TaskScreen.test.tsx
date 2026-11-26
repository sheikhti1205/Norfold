// @vitest-environment jsdom
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
