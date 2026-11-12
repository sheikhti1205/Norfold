// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagePill } from "./MessagePill";
import { readFileSync } from "node:fs";

afterEach(cleanup);

describe("MessagePill", () => {
  it("announces one pill and dismisses without opening", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<MessagePill person={{ name: "Alex", username: "alex" }} preview="Hello" onOpen={onOpen} onDismiss={onDismiss} />);
    const pills = screen.getAllByRole("status");
    expect(pills).toHaveLength(1);
    expect(pills[0]!.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message from Alex" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clamps a long preview to one line", () => {
    const sheet = document.createElement("style");
    sheet.textContent = readFileSync("src/components/MessagingStrip.css", "utf8");
    document.head.appendChild(sheet);
    const preview = "A".repeat(200);
    render(<MessagePill person={{ name: "Alex", username: "alex" }} preview={preview} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    const style = getComputedStyle(screen.getByText(preview));
    expect(style.textOverflow).toBe("ellipsis");
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.overflow).toBe("hidden");
    sheet.remove();
  });
});
