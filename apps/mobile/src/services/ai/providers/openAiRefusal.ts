/** Detect OpenAI-compatible policy stops before emitting any text in the frame. */
export function isOpenAiRefusal(choice: unknown): boolean {
  if (typeof choice !== "object" || choice === null) return false;
  const item = choice as { finish_reason?: unknown; delta?: { refusal?: unknown } | null };
  return item.finish_reason === "content_filter" || typeof item.delta?.refusal === "string";
}
