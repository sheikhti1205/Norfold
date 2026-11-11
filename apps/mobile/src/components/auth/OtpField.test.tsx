// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OtpField } from "./OtpField";

afterEach(cleanup);

function ControlledField({ maxLength = 8 }: { maxLength?: 6 | 7 | 8 | 9 | 10 }) {
  const [value, setValue] = useState("");
  return <OtpField label="Email code" value={value} onChange={setValue} maxLength={maxLength} />;
}

describe("OtpField", () => {
  it("renders one labelled input without decorative fake inputs", () => {
    const { container } = render(<ControlledField />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const input = screen.getByLabelText("Email code") as HTMLInputElement;
    expect(input.inputMode).toBe("numeric");
    expect(input.autocomplete).toBe("one-time-code");
    expect(input.maxLength).toBe(8);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(input.hasAttribute("placeholder")).toBe(false);
  });

  it("strips non-digits while typing and displays an eight-digit code", () => {
    render(<ControlledField />);
    const input = screen.getByLabelText("Email code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a34 5678" } });
    expect(input.value).toBe("12345678");
  });

  it("sanitizes pasted text and respects the configured maximum", () => {
    render(<ControlledField maxLength={10} />);
    const input = screen.getByLabelText("Email code") as HTMLInputElement;
    fireEvent.paste(input, { clipboardData: { getData: () => "12-34 5678 9012" } });
    expect(input.value).toBe("1234567890");
  });

  it("exposes its disabled state", () => {
    render(<OtpField value="" onChange={() => {}} disabled />);
    expect((screen.getByLabelText("Verification code") as HTMLInputElement).disabled).toBe(true);
  });
});
