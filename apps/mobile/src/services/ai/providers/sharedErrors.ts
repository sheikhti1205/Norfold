/** Shared HTTP classification. Quota is distinguishable only by 402 or an explicit billing code. */
export function sharedError(status: number | undefined, errorCode?: unknown): { code: string; retryable: boolean } | undefined {
  if (typeof errorCode === "string" && ["insufficient_quota", "quota_exceeded", "credit_balance_exhausted", "insufficient_credits", "billing_hard_limit_reached", "billing_error"].includes(errorCode.toLowerCase())) {
    return { code: "payment-required", retryable: false };
  }
  if (errorCode === "authentication_error") return { code: "auth-invalid", retryable: false };
  if (errorCode === "permission_error") return { code: "auth-forbidden", retryable: false };
  if (errorCode === "rate_limit_error" || errorCode === "rate_limit_exceeded") return { code: "rate-limited", retryable: true };
  // Gemini RESOURCE_EXHAUSTED does not distinguish quota exhaustion from throttling.
  if (errorCode === "RESOURCE_EXHAUSTED" || errorCode === "resource_exhausted") return { code: "rate-limited", retryable: true };
  if (errorCode === "UNAUTHENTICATED" || errorCode === "unauthenticated") return { code: "auth-invalid", retryable: false };
  if (errorCode === "PERMISSION_DENIED" || errorCode === "permission_denied") return { code: "auth-forbidden", retryable: false };
  if (status === 401) return { code: "auth-invalid", retryable: false };
  if (status === 403) return { code: "auth-forbidden", retryable: false };
  if (status === 402) return { code: "payment-required", retryable: false };
  if (status === 429) return { code: "rate-limited", retryable: true };
  return undefined;
}

export function errorEnvelopeCode(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { code?: unknown }).code ?? (error as { type?: unknown }).type;
}
