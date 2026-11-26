// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./ActionMenu";
import { AdaptiveTaskSurface, ConfirmDialog } from "./AdaptiveTaskSurface";
import { BottomSheet } from "./BottomSheet";
import { consumeBackIntercept, resetBackInterceptors } from "./backNavigation";
import { resetModalLayers } from "../hooks/modalLayers";

afterEach(() => { cleanup(); resetBackInterceptors(); resetModalLayers(); });

it("keeps Cancel available when confirmation authority disappears without an operation in flight", () => {
  render(<ConfirmDialog open title="Remove message?" onClose={() => {}} onConfirm={() => {}} confirmLabel="Remove" confirmDisabled />);
  const dialog=screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("button",{name:"Remove"}).hasAttribute("disabled")).toBe(true);
  expect(within(dialog).getByRole("button",{name:"Cancel"}).hasAttribute("disabled")).toBe(false);
});

it("starts a task on its safe close action rather than scheduling dialog refocus over nested tools", async () => {
  render(<AdaptiveTaskSurface open onClose={() => {}} title="Edit report"><input aria-label="Report title" /></AdaptiveTaskSurface>);
  const dialog = await screen.findByRole("dialog", { name: "Edit report" });
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" })));
});

it("bounds a task to the visual viewport when the IME overlays the layout viewport", () => {
  const previous = window.visualViewport;
  const viewport = new EventTarget();
  Object.defineProperties(viewport, { height: { configurable: true, value: window.innerHeight }, offsetTop: { value: 0 } });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  try {
    render(<AdaptiveTaskSurface open onClose={() => {}} title="Edit report"><input aria-label="Report title" /></AdaptiveTaskSurface>);
    Object.defineProperty(viewport, "height", { value: 400 });
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect((document.querySelector(".fb-modal-backdrop") as HTMLElement).style.height).toBe("400px");
  } finally {
    cleanup();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: previous });
  }
});

it("opens an anchored menu, navigates enabled actions and returns focus on Escape", async () => {
  render(<ActionMenu label="Report actions" items={[
    { id: "save", label: "Save", onAction: vi.fn() },
    { id: "locked", label: "Unavailable", disabled: true, onAction: vi.fn() },
    { id: "delete", label: "Delete", destructive: true, onAction: vi.fn() },
  ]} />);
  const trigger = screen.getByRole("button", { name: "Report actions" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = await screen.findByRole("menu", { name: "Report actions" });
  const save = within(menu).getByRole("menuitem", { name: "Save" });
  await waitFor(() => expect(document.activeElement).toBe(save));
  fireEvent.keyDown(save, { key: "ArrowDown" });
  await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Delete" })));
  expect(within(menu).getByRole("separator")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("opens one submenu by tap without hover; Back closes that panel before the root", async () => {
  const copy = vi.fn();
  render(<ActionMenu label="Actions" items={[
    { id: "share", label: "Share", items: [{ id: "copy", label: "Copy link", onAction: copy }] },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  const menu = await screen.findByRole("menu", { name: "Actions" });
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  const share = screen.getByRole("menuitem", { name: "Share" });
  act(() => share.focus());
  fireEvent.click(share);
  const copyAction = await screen.findByRole("menuitem", { name: "Copy link" });
  const submenu = screen.getByRole("menu", { name: "Share" });
  await waitFor(() => expect(submenu.contains(document.activeElement)).toBe(true));
  act(() => copyAction.focus());
  act(() => { expect(consumeBackIntercept()).toBe(true); });
  await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull());
  expect(screen.getByRole("menuitem", { name: "Share" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(share));
  fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
  await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});

it("confirmation starts on Cancel, retains caller-owned failures and refuses dismissal while busy", async () => {
  const confirm = vi.fn();
  function Example() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Remove</button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Remove files?"
        description="You can download them again." confirmLabel="Remove files" busy={busy}
        onConfirm={() => { confirm(); setBusy(true); }} />
    </>;
  }
  render(<Example />);
  const launcher = screen.getByRole("button", { name: "Remove" });
  launcher.focus(); fireEvent.click(launcher);
  const dialog = await screen.findByRole("alertdialog", { name: "Remove files?" });
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" })));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove files" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  act(() => { expect(consumeBackIntercept()).toBe(true); });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole("button", { name: "Remove files" }).hasAttribute("disabled")).toBe(true);
});

it("only the upper layer closes over a legacy task sheet and focus returns to its launcher", async () => {
  function Example() {
    const [sheet, setSheet] = useState(true);
    const [task, setTask] = useState(false);
    return <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Parent task">
      <button onClick={() => setTask(true)}>Open filters</button>
      <AdaptiveTaskSurface open={task} onClose={() => setTask(false)} title="Filters">
        <input aria-label="Filter text" />
      </AdaptiveTaskSurface>
    </BottomSheet>;
  }
  render(<Example />);
  const launcher = screen.getByRole("button", { name: "Open filters" });
  launcher.focus(); fireEvent.click(launcher);
  const dialog = await screen.findByRole("dialog", { name: "Filters" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Parent task" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(launcher));
});

it("gives the compact width its own panel and leaves the shared task measure alone", async () => {
  const compact = render(<AdaptiveTaskSurface open onClose={() => {}} title="Conversation info" width="compact"><button>Search chat</button></AdaptiveTaskSurface>);
  const info = await screen.findByRole("dialog", { name: "Conversation info" });
  const panel = info.closest(".fb-modal-panel");
  expect(panel?.classList.contains("fb-compact-panel")).toBe(true);
  expect(panel?.classList.contains("fb-task-panel")).toBe(false);
  compact.unmount();

  render(<AdaptiveTaskSurface open onClose={() => {}} title="Filters"><input aria-label="Filter text" /></AdaptiveTaskSurface>);
  const filters = await screen.findByRole("dialog", { name: "Filters" });
  expect(filters.closest(".fb-modal-panel")?.classList.contains("fb-task-panel")).toBe(true);
});

it("gives the report viewer its own panel", async () => {
  render(<AdaptiveTaskSurface open onClose={() => {}} title="Report" headerless width="report"><p>Viewer</p></AdaptiveTaskSurface>);
  const viewer = await screen.findByRole("dialog", { name: "Report" });
  expect(viewer.closest(".fb-modal-panel")?.classList.contains("fb-report-panel")).toBe(true);
});

it("takes the whole phone screen only when a surface opts in", async () => {
  const card = render(<AdaptiveTaskSurface open onClose={() => {}} title="Report a problem"><p>Card</p></AdaptiveTaskSurface>);
  const plain = await screen.findByRole("dialog", { name: "Report a problem" });
  expect(plain.closest(".fb-modal-panel")?.hasAttribute("data-immersive")).toBe(false);
  card.unmount();

  render(<AdaptiveTaskSurface open onClose={() => {}} title="Take photo" immersive><p>Viewfinder</p></AdaptiveTaskSurface>);
  const immersive = await screen.findByRole("dialog", { name: "Take photo" });
  expect(immersive.closest(".fb-modal-panel")?.getAttribute("data-immersive")).toBe("true");
});

describe("compact surface declarations", () => {
  const css = readFileSync("src/components/adaptiveFoundation.css", "utf8");

  function rule(selector: string): string {
    // Match at a rule boundary. A plain substring search finds
    // `.fb-surface-dialog {` inside the shared
    // `.fb-report-panel .fb-surface-dialog, .fb-comments-panel .fb-surface-dialog`
    // list and reads that rule instead of the standalone one below it.
    const start = css.indexOf(`\n${selector} {`);
    if (start < 0) throw new Error(`missing rule ${selector}`);
    return css.slice(start + 1, css.indexOf("}", start) + 1);
  }

  /** Brace-matched text of one media block, so nested rules read exactly. */
  function media(query: string): string {
    const start = css.indexOf(`@media (${query}) {`);
    if (start < 0) throw new Error(`missing media ${query}`);
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
    }
    throw new Error(`unterminated media ${query}`);
  }

  function phoneRule(selector: string): string {
    const block = media("max-width: 767px");
    const start = block.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`missing phone rule ${selector}`);
    return block.slice(start, block.indexOf("}", start) + 1);
  }

  it("narrows only the compact panel and keeps the shared measures", () => {
    expect(rule(".fb-compact-panel")).toContain("max-width: 26rem;");
    expect(rule(".fb-task-panel")).toContain("max-width: 44rem;");
    expect(rule(".fb-confirm-panel")).toContain("max-width: 26rem;");
  });

  it("scopes the tighter chrome under the compact panel", () => {
    expect(rule(".fb-compact-panel .fb-surface-header")).toContain("padding: 10px 12px;");
    expect(rule(".fb-compact-panel .fb-surface-body")).toContain("padding: 8px;");
  });

  it("caps every dialog short of the viewport and keeps the body the only scroller", () => {
    expect(rule(".fb-modal-panel")).toContain("max-height: min(86%, 46rem);");
    expect(rule(".fb-surface-dialog")).toContain("min-height: 0;");
    expect(rule(".fb-surface-body")).toContain("min-height: 0;");
    expect(rule(".fb-surface-body")).toContain("overflow: auto;");
  });

  it("gives the compact menu a tighter ceiling than the shared cap", () => {
    expect(rule(".fb-compact-panel")).toContain("max-height: min(72vh, 34rem);");
  });

  it("keeps the report viewer in the compact dialog family and sizes comments to the thread", () => {
    const reportPanel = rule(".fb-report-panel");
    expect(reportPanel).toContain("max-width: min(88%, 50rem);");
    expect(reportPanel).toContain("height: auto;");
    expect(reportPanel).toContain("max-height: min(86dvh, 44rem);");
    expect(reportPanel).toContain("border-radius: 28px;");
    expect(reportPanel).toContain("overflow: hidden;");
    // A thread is as tall as its comments, never a reserved 760px panel.
    expect(rule(".fb-comments-panel")).toContain("height: auto;");
    expect(rule(".fb-comments-panel")).toContain("max-height: min(86%, 46rem);");
    expect(rule(".fb-comments-panel")).toContain("border-radius: 24px;");
    expect(rule(".fb-comments-panel")).toContain("overflow: hidden;");
    // The panel is auto-height, so the body needs an intrinsic (auto) basis: a
    // zero-basis `flex: 1` body would shrink the panel to its header.
    const commentsBody = rule(".fb-surface-body.fb-comments-body");
    expect(commentsBody).toContain("flex: 1 1 auto;");
    expect(commentsBody).not.toContain("flex: 1;");
  });

  it("keeps a phone task dialog a card instead of a full screen", () => {
    expect(phoneRule(".fb-modal-backdrop:has(.fb-task-panel)")).toContain(
      "padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom));",
    );
    const taskPanel = phoneRule(".fb-task-panel");
    expect(taskPanel).toContain("height: auto;");
    expect(taskPanel).toContain("border-radius: 20px;");
    // The shared ceiling still binds; no phone rule may restore the full bleed.
    expect(taskPanel).not.toContain("height: 100%");
    expect(taskPanel).not.toContain("max-height");
    expect(rule(".fb-modal-panel")).toContain("max-height: min(86%, 46rem);");
    // The dialog may shrink inside the capped panel and its body scrolls.
    expect(phoneRule(".fb-task-panel .fb-surface-dialog")).toContain("min-height: 0;");
    const body = phoneRule(".fb-task-panel .fb-surface-body");
    expect(body).toContain("min-height: 0;");
    expect(body).toContain("overflow: auto;");
  });

  it("gives the one full-bleed phone surface an explicit opt-in", () => {
    const immersive = phoneRule('.fb-modal-panel[data-immersive="true"]');
    expect(immersive).toContain("height: 100%;");
    expect(immersive).toContain("max-height: 100%;");
    expect(immersive).toContain("border-radius: 0;");
    expect(phoneRule('.fb-modal-backdrop:has(.fb-modal-panel[data-immersive="true"])')).toContain("padding: 0;");

    // Every screen-height rule in the phone block belongs to the opt-in.
    const block = media("max-width: 767px");
    const inner = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    const fullBleed = [...inner.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /(^|;)\s*height:\s*100%\s*;/.test(body ?? ""))
      .map(([, selector]) => (selector ?? "").trim().replace(/\s+/g, " "));
    expect(fullBleed.length).toBeGreaterThan(0);
    for (const selector of fullBleed) expect(selector).toContain('[data-immersive="true"]');
  });
});
