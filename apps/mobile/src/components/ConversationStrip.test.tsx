// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationStrip } from "./ConversationStrip";
import { readFileSync } from "node:fs";

afterEach(cleanup);

describe("ConversationStrip", () => {
  it("shows an empty message without controls", () => {
    render(<ConversationStrip people={[]} onOpen={vi.fn()} />);
    expect(screen.getByText("Conversations will appear here.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders eight people in caller order and opens the selected conversation", () => {
    const onOpen = vi.fn();
    const people = Array.from({ length: 8 }, (_, i) => ({ conversationId: `${i}`, name: `Person ${i}`, username: `person${i}` }));
    render(<ConversationStrip people={people} max={8} onOpen={onOpen} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(people.map((person) => person.name));
    fireEvent.click(buttons[0]!);
    expect(onOpen).toHaveBeenCalledWith("0");
  });

  it("marks the active conversation", () => {
    render(<ConversationStrip people={[{ conversationId: "a", name: "Alex", username: "alex" }]} activeConversationId="a" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Alex" }).getAttribute("aria-current")).toBe("true");
  });

  it("constrains a long name within its button", () => {
    const sheet = document.createElement("style");
    sheet.textContent = readFileSync("src/components/MessagingStrip.css", "utf8");
    document.head.appendChild(sheet);
    const name = "A".repeat(200);
    render(<ConversationStrip people={[{ conversationId: "a", name, username: "alex" }]} onOpen={vi.fn()} />);
    const label = screen.getByRole("button", { name }).querySelector(".fb-conversation-strip-name")!;
    expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(label).maxWidth).toBe("100%");
    sheet.remove();
  });
});
