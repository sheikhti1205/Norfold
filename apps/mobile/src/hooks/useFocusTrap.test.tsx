// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "./useFocusTrap";

afterEach(() => cleanup());

function Outer({ children, onClose }: { children?: React.ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const setRef = useFocusTrap(ref, onClose ?? vi.fn(), true);
  return (
    <div ref={setRef} data-testid="outer" tabIndex={-1}>
      <button type="button">Outer action</button>
      {children}
    </div>
  );
}

function Inner({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const setRef = useFocusTrap(ref, onClose, true);
  return (
    <div ref={setRef} role="dialog" aria-label="Inner dialog" tabIndex={-1}>
      <button type="button">Inner first</button>
      <button type="button">Inner second</button>
    </div>
  );
}

function Nested({ onOuterClose, onInnerClose }: { onOuterClose: () => void; onInnerClose: () => void }) {
  // The inner dialog opens AFTER the outer layer mounts, exactly like the
  // production sheets/menus/dialogs: push order then matches z-order, so the
  // last-opened layer is topmost.
  const [open, setOpen] = useState(false);
  return (
    <Outer onClose={onOuterClose}>
      <button type="button" onClick={() => setOpen(true)}>Open inner</button>
      {open ? <Inner onClose={() => { onInnerClose(); setOpen(false); }} /> : null}
    </Outer>
  );
}

function openInner(): void {
  fireEvent.click(screen.getByRole("button", { name: "Open inner" }));
  expect(screen.getByRole("dialog", { name: "Inner dialog" })).toBeTruthy();
}

describe("useFocusTrap nested layers", () => {
  it.each(["disabled", "removed"])("recovers focus when the current control is %s", async (change) => {
    function Changing({ changed }: { changed: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const setRef = useFocusTrap(ref, vi.fn());
      return <div ref={setRef} role="dialog" tabIndex={-1}>
        <button>Close</button>
        {!(changed && change === "removed") && <button disabled={changed}>Send</button>}
      </div>;
    }
    const { rerender } = render(<Changing changed={false} />);
    screen.getByRole("button", { name: "Send" }).focus();
    rerender(<Changing changed />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })));
  });

  it("uses the container when a mutation leaves no enabled controls", async () => {
    function Changing({ busy }: { busy: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const setRef = useFocusTrap(ref, vi.fn());
      return <div ref={setRef} role="dialog" tabIndex={-1}><button disabled={busy}>Send</button></div>;
    }
    const { rerender } = render(<Changing busy={false} />);
    rerender(<Changing busy />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
  });

  it("preserves a valid text-field focus across unrelated content mutations", async () => {
    function Changing({ loaded }: { loaded: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const setRef = useFocusTrap(ref, vi.fn());
      return <div ref={setRef} tabIndex={-1}><button>Close</button><input aria-label="Details" />{loaded && <p>Loaded</p>}</div>;
    }
    const { rerender } = render(<Changing loaded={false} />);
    screen.getByRole("textbox").focus();
    rerender(<Changing loaded />);
    await waitFor(() => expect(screen.getByText("Loaded")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("does not let a covered sheet reclaim focus on its own mutation", async () => {
    const { rerender } = render(<Outer><p>Loading</p></Outer>);
    // Register a top layer by opening it after the outer layer, as production does.
    rerender(<Outer><p>Loading</p>{createPortal(<Inner onClose={vi.fn()} />, document.body)}</Outer>);
    screen.getByRole("button", { name: "Inner second" }).focus();
    rerender(<Outer><p>Outer load completed</p>{createPortal(<Inner onClose={vi.fn()} />, document.body)}</Outer>);
    await waitFor(() => expect(screen.getByText("Outer load completed")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inner second" }));
  });

  it("moves Tab into the topmost dialog instead of wrapping the covered editor", () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);
    openInner();
    // Opening the dialog focuses its first control; move focus back out to
    // the covered editor, then press Tab: the top dialog must reclaim it.
    (screen.getByRole("button", { name: "Outer action" }) as HTMLElement).focus();
    expect(document.activeElement?.textContent).toBe("Outer action");
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement?.textContent).toBe("Inner first");
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(onInnerClose).not.toHaveBeenCalled();
  });

  it("wraps Shift+Tab inside the topmost dialog", () => {
    render(<Nested onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);
    openInner();
    (screen.getByRole("button", { name: "Inner first" }) as HTMLElement).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement?.textContent).toBe("Inner second");
  });

  it("closes only the topmost layer on Escape", () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);
    openInner();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Inner dialog" })).toBeNull();
  });

  it("restores focus to the trigger when the top dialog unmounts", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          {open ? <Inner onClose={() => setOpen(false)} /> : null}
        </div>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    (trigger as HTMLElement).focus();
    fireEvent.click(trigger);
    expect(document.activeElement?.textContent).toBe("Inner first");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inner dialog" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

/**
 * A child that owns focus as soon as it mounts, the way react-aria's Calendar
 * focuses the focused day in its own mount effect. Effects run child-first, so
 * a launcher captured in an effect records this button instead of the trigger.
 */
function AutoFocusControl() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <button ref={ref} type="button">Focused day</button>;
}

function AutoFocusDialog({ onClose, viaCallbackRef }: { onClose: () => void; viaCallbackRef: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const setRef = useFocusTrap(ref, onClose);
  return (
    <div ref={viaCallbackRef ? setRef : ref} role="dialog" aria-label="Auto dialog" tabIndex={-1}>
      <button type="button" onClick={onClose}>Close</button>
      <AutoFocusControl />
    </div>
  );
}

function AutoFocusLaunch({ viaCallbackRef }: { viaCallbackRef: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      {open ? <AutoFocusDialog viaCallbackRef={viaCallbackRef} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

describe("useFocusTrap launcher", () => {
  it.each([true, false])(
    "returns focus to the launcher when a child autofocuses on mount (callback ref: %s)",
    (viaCallbackRef) => {
      render(<AutoFocusLaunch viaCallbackRef={viaCallbackRef} />);
      const trigger = screen.getByRole("button", { name: "Open dialog" });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "Auto dialog" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Auto dialog" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("keeps the launcher through a StrictMode effect replay", () => {
    render(<StrictMode><AutoFocusLaunch viaCallbackRef /></StrictMode>);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Auto dialog" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("re-records the launcher when the same trap is re-enabled from another trigger", () => {
    function ToggleTrap() {
      const [enabled, setEnabled] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      const setRef = useFocusTrap(ref, () => setEnabled(false), enabled);
      return (
        <>
          <button type="button" onClick={() => setEnabled(true)}>First launcher</button>
          <button type="button" onClick={() => setEnabled(true)}>Second launcher</button>
          <div ref={setRef} role="dialog" aria-label="Toggle dialog" tabIndex={-1}>
            <button type="button" onClick={() => setEnabled(false)}>Dismiss</button>
          </div>
        </>
      );
    }
    render(<ToggleTrap />);
    const first = screen.getByRole("button", { name: "First launcher" });
    const second = screen.getByRole("button", { name: "Second launcher" });

    first.focus();
    fireEvent.click(first);
    expect(document.activeElement?.textContent).toBe("Dismiss");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(first);

    second.focus();
    fireEvent.click(second);
    expect(document.activeElement?.textContent).toBe("Dismiss");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(second);
  });

  it("restores a caller-supplied launcher instead of the focused element", () => {
    function CallerDialog({ onClose, launcher }: {
      onClose: () => void;
      launcher: React.RefObject<HTMLButtonElement | null>;
    }) {
      const ref = useRef<HTMLDivElement>(null);
      const setRef = useFocusTrap(ref, onClose, true, launcher);
      return (
        <div ref={setRef} role="dialog" aria-label="Caller dialog" tabIndex={-1}>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      );
    }
    function Harness() {
      const [open, setOpen] = useState(false);
      const launcher = useRef<HTMLButtonElement>(null);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          <button type="button" ref={launcher}>Saved launcher</button>
          {open ? <CallerDialog launcher={launcher} onClose={() => setOpen(false)} /> : null}
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Saved launcher" }));
  });

  it("closes cleanly when nothing owned focus before the trap opened", () => {
    render(<AutoFocusLaunch viaCallbackRef />);
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Auto dialog" })).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not focus a launcher that left the DOM while the trap was open", () => {
    function VanishingLauncher() {
      const [open, setOpen] = useState(false);
      const [showLauncher, setShowLauncher] = useState(true);
      const ref = useRef<HTMLDivElement>(null);
      const setRef = useFocusTrap(ref, () => setOpen(false));
      return (
        <>
          {showLauncher ? (
            <button
              type="button"
              onClick={() => { setOpen(true); setShowLauncher(false); }}
            >
              Open dialog
            </button>
          ) : null}
          {open ? (
            <div ref={setRef} role="dialog" aria-label="Vanishing dialog" tabIndex={-1}>
              <button type="button" onClick={() => setOpen(false)}>Dismiss</button>
            </div>
          ) : null}
        </>
      );
    }
    render(<VanishingLauncher />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.queryByRole("button", { name: "Open dialog" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Vanishing dialog" })).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
