/**
 * Output normalization for Norfold on-device assistance.
 *
 * Application-owned rules implemented here (this module owns R1/R2/R4/R5/R6):
 * R1 de-fence: reuse extractSingleJsonObject() from the stable
 *    FakeAiProvider, accept ONE object only, then STRICT validation (schema +
 *    enum/action allowlist). Multiple/conflicting objects or bad schema
 *    become INVALID_OUTPUT. Never "accept anything".
 * R2 reasoning-envelope stripping: PROFILE-SPECIFIC (only profiles declaring
 *    thoughtEnvelope). Thought+answer strips and processes; thought without
 *    answer is INVALID_OUTPUT. Reasoning text never surfaces.
 * R4 empty vs refusal: whitespace-only is INVALID_OUTPUT (EMPTY
 *    diagnostic); explicit refusal is UNSUPPORTED_REQUEST + reason.
 * R5 field-stuffing: the strict schema validator fails stuffed fields
 *    (e.g. visibleText padded with color repetitions) even when JSON parses.
 * R6 prompt/context-echo: values reproducing the system prompt, schema
 *    instructions, or userContext are rejected as observations.
 *
 * R3 loop detection belongs to the guard: this pipeline exposes an optional
 * loopCheck seam and performs no detection of its own.
 */
import {
  extractSingleJsonObject,
  type AiErrorClass,
} from "./testing/FakeAiProvider";
import type { ModelProfile } from "./modelProfiles";
import { makeAskUserPrompt } from "./clarificationCopy";
import { looksLikeCoordinates } from "../search/coordinates";
import {
  isAction,
  isAskUserPrompt,
  isAssistantAction,
  isIntent,
  type Action,
  type AiError,
  type AiResult,
  type AskUserPrompt,
  type AssistantAction,
  type ClassifiedIntent,
  type ReportSlotFields,
  type SearchFilterFields,
} from "./types";
import { makeAiError } from "./types";

function fail<T>(errorClass: AiErrorClass, diagnostic: string, reason?: string): AiResult<T> {
  return { ok: false, error: makeAiError(errorClass, diagnostic, reason) };
}

function pass<T>(value: T): AiResult<T> {
  return { ok: true, value };
}

/** Evidence-derived provisional bounds (see report for alternatives). */
export const MAX_STRING_CHARS = 280;
export const MAX_HELP_CHARS = 2000;
const MIN_ECHO_CHARS = 40;
const SCHEMA_ECHO_PATTERN = /string\s*(\[\]| *\| *null)/i;

export interface NormalizeContext {
  readonly instruction?: string;
  readonly userContext?: string;
}

/** Guard seam: returns an error when the text is a loop, else null. */
export type LoopCheck = (text: string) => AiError | null;

export interface NormalizeOptions {
  readonly context?: NormalizeContext;
  readonly loopCheck?: LoopCheck;
}

/** R1: tolerantly extract ONE object, then hand off for strict validation. */
export function extractOneJsonObject(rawText: string): AiResult<string> {
  const { json, count } = extractSingleJsonObject(rawText);
  if (count === 0 || json === null) {
    if (rawText.includes("{")) return fail("INVALID_OUTPUT", "R1_MALFORMED_JSON");
    return fail("INVALID_OUTPUT", "R1_NO_JSON_OBJECT");
  }
  if (count > 1) {
    return fail("INVALID_OUTPUT", "R1_MULTIPLE_JSON_OBJECTS");
  }
  try {
    JSON.parse(json);
  } catch {
    return fail("INVALID_OUTPUT", "R1_MALFORMED_JSON");
  }
  return pass(json);
}

/**
 * R2: strip the profile's thought envelope. Profiles without an envelope
 * pass text through untouched — there is deliberately no global regex.
 */
export function stripThoughtEnvelope(rawText: string, profile: ModelProfile): AiResult<string> {
  const envelope = profile.thoughtEnvelope;
  if (envelope === undefined) return pass(rawText);
  const { openMarker, closeMarker } = envelope;
  if (!rawText.includes(openMarker)) return pass(rawText);

  let stripped = rawText;
  let removedThought = false;
  for (;;) {
    const open = stripped.indexOf(openMarker);
    if (open < 0) break;
    const close = stripped.indexOf(closeMarker, open + openMarker.length);
    if (close < 0) {
      stripped = stripped.slice(0, open);
    } else {
      stripped = stripped.slice(0, open) + stripped.slice(close + closeMarker.length);
    }
    removedThought = true;
  }
  stripped = stripped.split(closeMarker).join("");
  const answer = stripped.trim();
  if (answer === "" && removedThought) {
    return fail("INVALID_OUTPUT", "R2_THOUGHT_WITHOUT_ANSWER");
  }
  return pass(answer === "" ? stripped : answer);
}

const REFUSAL_SIGNALS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /i can't help with that request/i, label: "REFUSAL_POLICY" },
  { pattern: /i(?:'|’| a)m sorry,? but i cannot provide/i, label: "REFUSAL_PII" },
  { pattern: /i cannot (provide|share|disclose).{0,60}(address|phone|personal information)/i, label: "REFUSAL_PII" },
  { pattern: /do not have access to personal information/i, label: "REFUSAL_PII" },
];

/** Conservative refusal detector (heuristic; quoted forms in tests). */
export function detectRefusal(text: string): string | null {
  for (const signal of REFUSAL_SIGNALS) {
    if (signal.pattern.test(text)) return signal.label;
  }
  return null;
}

/** R4: explicit refusal wins over empty; both are distinct from answers. */
export function checkNonEmptyOrRefusal(text: string): AiResult<string> {
  const refusal = detectRefusal(text);
  if (refusal !== null) {
    return fail("UNSUPPORTED_REQUEST", "R4_REFUSAL_POLICY", refusal);
  }
  if (text.trim() === "") {
    return fail("INVALID_OUTPUT", "R4_EMPTY_OUTPUT");
  }
  return pass(text);
}

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** R6: value reproduces a long verbatim run of prompt/schema/userContext. */
export function containsEcho(value: string, context: NormalizeContext | undefined): boolean {
  if (SCHEMA_ECHO_PATTERN.test(value)) return true;
  if (context === undefined) return false;
  const candidate = norm(value);
  if (candidate.length < MIN_ECHO_CHARS) return false;
  const sources = [context.instruction, context.userContext];
  for (const source of sources) {
    if (source === undefined) continue;
    const haystack = norm(source);
    for (let i = 0; i + MIN_ECHO_CHARS <= candidate.length; i += 8) {
      const probe = candidate.slice(i, i + MIN_ECHO_CHARS);
      if (probe.trim().length >= MIN_ECHO_CHARS && haystack.includes(probe)) return true;
    }
  }
  return false;
}

function rejectCoordinates(value: string, field: string): AiResult<string> {
  if (looksLikeCoordinates(value)) {
    return fail("INVALID_OUTPUT", `R5_COORDINATES_NOT_ACCEPTED:${field}`);
  }
  return pass(value);
}

function checkNarrowString(
  value: unknown,
  field: string,
  maxChars: number,
  context: NormalizeContext | undefined,
): AiResult<string | undefined> {
  if (value === undefined) return pass(undefined);
  if (typeof value !== "string") return fail("INVALID_OUTPUT", `R1_BAD_FIELD:${field}`);
  const trimmed = value.trim();
  if (trimmed === "") return pass(undefined);
  if (trimmed.length > maxChars) return fail("INVALID_OUTPUT", `R5_FIELD_TOO_LONG:${field}`);
  if (containsEcho(trimmed, context)) return fail("INVALID_OUTPUT", `R6_CONTEXT_ECHO:${field}`);
  return pass(trimmed);
}

function strictKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): AiResult<null> {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return fail("INVALID_OUTPUT", `R1_UNKNOWN_FIELD:${what}:${key}`);
  }
  return pass(null);
}

/**
 * R1-strict validator for classify-intent payloads.
 *
 * Stable mapping honored: an action outside the allowlist is
 * UNSUPPORTED_ACTION naming the rejected action (WRONG_ACTION /
 * UNKNOWN_ACTION modes), even when no intent is present. The "args" key is
 * tolerated but never applied — no side effects flow from model output.
 * A missing action defaults deterministically via intentDefaultAction.
 */
export function validateIntentPayload(value: unknown): AiResult<ClassifiedIntent> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_OUTPUT", "R1_BAD_INTENT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  const keys = strictKeys(record, ["intent", "action", "prompt", "args"], "intent");
  if (!keys.ok) return keys;
  if (record["action"] !== undefined && !isAction(record["action"])) {
    return fail("UNSUPPORTED_ACTION", `R1_UNSUPPORTED_ACTION:${String(record["action"])}`);
  }
  if (!isIntent(record["intent"])) {
    return fail("INVALID_OUTPUT", "R1_UNKNOWN_INTENT");
  }
  const intent = record["intent"];
  if (record["action"] === undefined) {
    return pass({ intent, action: intentDefaultAction(intent) });
  }
  const candidate: AssistantAction =
    record["action"] === "ASK_USER"
      ? { action: "ASK_USER", prompt: record["prompt"] as AskUserPrompt }
      : { action: record["action"] as Action };
  if (!isAssistantAction(candidate)) {
    return fail("INVALID_OUTPUT", "R1_BAD_ACTION_SHAPE");
  }
  return pass({ intent, action: candidate });
}

/** Deterministic intent→action mapping (code-owned, never model-chosen). */
export function intentDefaultAction(intent: ClassifiedIntent["intent"]): AssistantAction {
  switch (intent) {
    case "REPORT_LOST":
    case "REPORT_FOUND":
      return { action: "OPEN_REPORT" };
    case "SEARCH":
      return { action: "OPEN_SEARCH" };
    case "APP_QUESTION":
    case "OPEN_QUESTION":
      return { action: "NONE" };
    case "UNKNOWN":
      return {
        action: "ASK_USER",
        prompt: makeAskUserPrompt({ field: "query" }),
      };
  }
}

/** R1-strict + R5 + R6 validator for report slot payloads. */
export function validateReportSlots(
  value: unknown,
  context?: NormalizeContext,
): AiResult<ReportSlotFields> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_OUTPUT", "R1_BAD_REPORT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  const keys = strictKeys(
    record,
    ["title", "description", "category", "dateText", "locationNote"],
    "report",
  );
  if (!keys.ok) return keys;
  const fields: Record<string, string | undefined> = {};
  const bounds: Record<string, number> = {
    title: 80,
    description: MAX_STRING_CHARS,
    category: 40,
    dateText: 40,
    locationNote: 140,
  };
  for (const field of Object.keys(bounds)) {
    const checked = checkNarrowString(record[field], field, bounds[field] ?? MAX_STRING_CHARS, context);
    if (!checked.ok) return checked;
    if (checked.value !== undefined) fields[field] = checked.value;
  }
  if (fields["locationNote"] !== undefined) {
    const coords = rejectCoordinates(fields["locationNote"], "locationNote");
    if (!coords.ok) return coords;
  }
  return pass({
    title: fields["title"],
    description: fields["description"],
    category: fields["category"],
    dateText: fields["dateText"],
    locationNote: fields["locationNote"],
  });
}

/** R1-strict + R5 + R6 validator for search-filter payloads. */
export function validateSearchFilters(
  value: unknown,
  context?: NormalizeContext,
): AiResult<SearchFilterFields> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_OUTPUT", "R1_BAD_SEARCH_OBJECT");
  }
  const record = value as Record<string, unknown>;
  const keys = strictKeys(record, ["query", "category", "status", "postType", "place", "dateRangeText"], "search");
  if (!keys.ok) return keys;
  const fields: Record<string, string | undefined> = {};
  const bounds: Record<string, number> = {
    query: 140,
    category: 40,
    status: 40,
    postType: 12,
    place: 80,
    dateRangeText: 40,
  };
  for (const field of Object.keys(bounds)) {
    const checked = checkNarrowString(record[field], field, bounds[field] ?? MAX_STRING_CHARS, context);
    if (!checked.ok) return checked;
    if (checked.value !== undefined) fields[field] = checked.value;
  }
  for (const field of ["query", "dateRangeText", "place"]) {
    if (fields[field] !== undefined) {
      const coords = rejectCoordinates(fields[field] as string, field);
      if (!coords.ok) return coords;
    }
  }
  return pass({
    query: fields["query"],
    category: fields["category"],
    status: fields["status"],
    postType: fields["postType"],
    place: fields["place"],
    dateRangeText: fields["dateRangeText"],
  });
}

/** Full JSON-op pipeline: R2 → R4 → R3-seam → R1 → strict validation. */
export function normalizeJsonOp<T>(
  rawText: string,
  profile: ModelProfile,
  validate: (value: unknown, context?: NormalizeContext) => AiResult<T>,
  options?: NormalizeOptions,
): AiResult<T> {
  const stripped = stripThoughtEnvelope(rawText, profile);
  if (!stripped.ok) return stripped;
  const nonEmpty = checkNonEmptyOrRefusal(stripped.value);
  if (!nonEmpty.ok) return nonEmpty;
  if (options?.loopCheck !== undefined) {
    const loop = options.loopCheck(nonEmpty.value);
    if (loop !== null) return { ok: false, error: loop };
  }
  const extracted = extractOneJsonObject(nonEmpty.value);
  if (!extracted.ok) return extracted;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.value) as unknown;
  } catch {
    return fail("INVALID_OUTPUT", "R1_MALFORMED_JSON");
  }
  return validate(parsed, options?.context);
}

/**
 * Canonical slot envelope (Phase A Step 5): local producers emit slot
 * payloads as `{ fields: {...} }`, optionally with the code-owned
 * `deterministic: true` marker; cloud emits the flat slot object. Both are
 * canonical here: unwrap the envelope, then run the task's strict flat
 * validator. A `fields` envelope mixed with flat slots is invalid — never
 * silently merged. This is the ONLY place that knows about the envelope;
 * consumers must not unwrap `{ fields }` ad hoc (see the retired Help.tsx
 * workaround).
 */
export function validateSlotEnvelope<T>(
  value: unknown,
  validate: (candidate: unknown, context?: NormalizeContext) => AiResult<T>,
  context?: NormalizeContext,
): AiResult<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validate(value, context);
  }
  const rest = { ...(value as Record<string, unknown>) };
  delete rest["deterministic"];
  if (!("fields" in rest)) {
    return validate(rest, context);
  }
  const { fields, ...flat } = rest;
  if (Object.keys(flat).length > 0) {
    return fail("INVALID_OUTPUT", "R1_MIXED_ENVELOPE:fields");
  }
  return validate(fields, context);
}

/** Prose pipeline for help answers: R2 → R4 → R3-seam, no JSON required. */
export function normalizeProse(
  rawText: string,
  profile: ModelProfile,
  options?: NormalizeOptions,
): AiResult<string> {
  const stripped = stripThoughtEnvelope(rawText, profile);
  if (!stripped.ok) return stripped;
  const nonEmpty = checkNonEmptyOrRefusal(stripped.value);
  if (!nonEmpty.ok) return nonEmpty;
  const answer = nonEmpty.value.trim();
  if (answer.length > MAX_HELP_CHARS) {
    return fail("INVALID_OUTPUT", "R5_ANSWER_TOO_LONG");
  }
  if (containsEcho(answer, options?.context)) {
    return fail("INVALID_OUTPUT", "R6_CONTEXT_ECHO:answer");
  }
  if (options?.loopCheck !== undefined) {
    const loop = options.loopCheck(answer);
    if (loop !== null) return { ok: false, error: loop };
  }
  return pass(answer);
}

export function isValidAskUserAction(action: AssistantAction): action is AssistantAction & {
  action: "ASK_USER";
  prompt: AskUserPrompt;
} {
  return action.action === "ASK_USER" && isAskUserPrompt(action.prompt);
}
