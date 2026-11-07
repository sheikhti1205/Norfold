// @vitest-environment jsdom
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SplitView } from "./SplitView";
import { UserIdentityTrigger } from "./UserIdentityTrigger";

const originalWidth = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

it("keeps compact panes mounted without leaving hidden controls in the tab order; Back restores list focus", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
  function Example() {
    const [selected, setSelected] = useState(false);
    return <SplitView selected={selected}
      list={<button onClick={() => setSelected(true)}>Open conversation</button>}
      detail={<><input aria-label="Draft" defaultValue="Keep me" /><button onClick={() => setSelected(false)}>Back to chats</button></>} />;
  }
  render(<Example />);
  const open = screen.getByRole("button", { name: "Open conversation" });
  expect(screen.queryByRole("textbox")).toBeNull();
  open.focus(); fireEvent.click(open);
  expect(screen.queryByRole("button", { name: "Open conversation" })).toBeNull();
  const draft = screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement;
  fireEvent.change(draft, { target: { value: "Unsent text" } });
  const back = screen.getByRole("button", { name: "Back to chats" });
  back.focus(); fireEvent.click(back);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).not.toBe(back);
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
  expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("Unsent text");
});

it("wide windows expose both panes and resizing away from the list relocates focus into the visible pane", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  render(<SplitView selected list={<button>Chat list</button>} detail={<button>Thread action</button>} />);
  screen.getByRole("button", { name: "Chat list" }).focus();
  expect(screen.getByRole("button", { name: "Thread action" })).toBeTruthy();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 393 });
  act(() => window.dispatchEvent(new Event("resize")));
  expect(screen.queryByRole("button", { name: "Chat list" })).toBeNull();
  expect(document.activeElement?.closest("[hidden]")).toBeNull();
  expect(document.activeElement).not.toBe(document.body);
});

it("identity is a direct profile link, not a quick-card popover", () => {
  render(<MemoryRouter><UserIdentityTrigger person={{ id: "u-river", username: "river", displayName: "River Lee" }} /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Open River Lee's profile" });
  expect(link.getAttribute("href")).toBe("/u/river");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("River Lee")).toBeTruthy();
});
