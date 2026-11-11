import { describe, expect, it } from "vitest";
import { errorEnvelopeCode, sharedError } from "./sharedErrors";

describe("provider failure classification", () => {
  it.each([
    [401, undefined, "auth-invalid", false],
    [403, undefined, "auth-forbidden", false],
    [402, undefined, "payment-required", false],
    [429, undefined, "rate-limited", true],
    [429, "insufficient_quota", "payment-required", false],
  ])("classifies %s / %s", (status, code, expected, retryable) => {
    expect(sharedError(status, code)).toEqual({ code: expected, retryable });
  });

  it("extracts the provider error code without trusting free-form messages", () => {
    expect(errorEnvelopeCode({ error: { code: "insufficient_quota", message: "ignored" } })).toBe("insufficient_quota");
  });
});
