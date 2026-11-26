/**
 * Reviewable report-field suggestions (Lane C).
 *
 * Consumer of the `extract-report-fields` op. The op extracts a small slot
 * object (title, description, category, dateText, locationNote); this module
 * maps the form-applicable slots (title / description / date / category) into
 * per-field reviewable patches. Each patch carries its source so the UI can
 * label it, and every patch needs an explicit user Apply — nothing here
 * writes to the draft, publishes, or auto-applies.
 *
 * Frozen-report contract:
 * - Unreleased-category downgrade: a suggested category outside the released
 *   catalog is DROPPED (with a notice), never applied. Title/description/date
 *   patches stay reviewable.
 * - Wrong-kind rejection: every non-blank value must be the right KIND for its
 *   field — a real calendar date in the date slot, prose in the description
 *   slot, a short non-numeric title, a released category. A value of the wrong
 *   kind (a place phrase in the date slot, `S.T.` in the description slot) is
 *   DROPPED, never repaired or guessed: a suggestion the person cannot apply
 *   truthfully is worse than no suggestion.
 * - Cancellation is abort-clean: a pre-aborted signal never calls generate;
 *   a mid-flight abort returns CANCELLED and never triggers fallback side
 *   effects (no retry, no second op, no apply). A late op resolution is
 *   dropped, never rendered.
 * - Stale-drop is the caller's job (generation token, like the report form's
 *   `renderGeneration`):
 *   a result that resolves after a newer request started must be discarded
 *   by the UI, never rendered into another request's panel.
 */
import { parseDate } from "@internationalized/date";
import { isReleasedCategory, type Category } from "@norfold/shared";
import type { ModelProfile } from "./ai/modelProfiles";
import { extractReportFields } from "./ai/ops/extractReportFields";
import type {
  AiResult,
  AssistantAction,
  GenerateFn,
  ReportSlotFields,
} from "./ai/types";
import { makeAiError } from "./ai/types";
import { looksLikeCoordinates } from "./search/coordinates";

export const REPORT_FIELD_SOURCE = "extract-report-fields" as const;
export type ReportFieldSource = typeof REPORT_FIELD_SOURCE;

export type ReportSuggestionField = "title" | "description" | "category" | "date";

/** The report form's title bound (shared report schema: max 120). */
const TITLE_MAX_CHARS = 120;
/** A description is prose. `S.T.` is an abbreviation, not a description. */
const DESCRIPTION_MIN_CHARS = 20;
const DESCRIPTION_MIN_WORDS = 3;

/** True only for a strict ISO calendar date — the form's own date parser. */
function isCalendarDateText(value: string): boolean {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Prose about the item: long enough, several words, no position, not a date. */
function isProseDescription(value: string): boolean {
  if (value.length < DESCRIPTION_MIN_CHARS) return false;
  const words = value.split(/\s+/).filter((word) => word !== "");
  if (words.length < DESCRIPTION_MIN_WORDS) return false;
  if (looksLikeCoordinates(value)) return false;
  return !isCalendarDateText(value);
}

/** A short name for the item — never a bare number or a bare date. */
function isUsableTitle(value: string): boolean {
  if (value.length > TITLE_MAX_CHARS) return false;
  // \p{L} keeps non-Latin titles (Bengali, Arabic, …) while still rejecting a
  // value made only of digits and punctuation.
  if (!/\p{L}/u.test(value)) return false;
  return !isCalendarDateText(value);
}

/** Reasons a non-blank suggested value is the wrong kind for its field. */
export type ReportFieldRejection =
  | "TITLE_NOT_A_TITLE"
  | "DESCRIPTION_NOT_PROSE"
  | "DATE_NOT_A_CALENDAR_DATE"
  | "CATEGORY_NOT_RELEASED";

/**
 * Deterministic kind check for one suggested value, before the user can see
 * it. Returns null when the value belongs in that field, or the reason it does
 * not. A blank string is "nothing suggested", not a rejection — callers skip
 * blanks before asking, so an omitted slot never counts as a dropped field.
 */
export function rejectionReasonFor(
  field: ReportSuggestionField,
  value: string,
): ReportFieldRejection | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  switch (field) {
    case "title":
      return isUsableTitle(trimmed) ? null : "TITLE_NOT_A_TITLE";
    case "description":
      return isProseDescription(trimmed) ? null : "DESCRIPTION_NOT_PROSE";
    case "date":
      return isCalendarDateText(trimmed) ? null : "DATE_NOT_A_CALENDAR_DATE";
    case "category":
      return isReleasedCategory(trimmed) ? null : "CATEGORY_NOT_RELEASED";
  }
}

export interface ReportFieldSuggestion {
  readonly field: ReportSuggestionField;
  /** Exact suggested value; the UI may let the user edit before Apply. */
  readonly suggestedValue: string;
  readonly source: ReportFieldSource;
}

export interface BuiltReportFieldSuggestions {
  readonly suggestions: readonly ReportFieldSuggestion[];
  /** True when the model suggested a category that was dropped as unreleased. */
  readonly droppedCategory: boolean;
}

/**
 * Pure map from validated extraction slots to reviewable per-field patches.
 * Only non-empty trimmed values of the right kind become suggestions; a
 * wrong-kind value is dropped silently (no notice, no repaired guess). A
 * category outside the released catalog is dropped with droppedCategory=true
 * instead of surfacing as an applicable patch — applying one field keeps the
 * others reviewable, and a dropped field never blocks the rest.
 */
export function buildReportFieldSuggestions(
  fields: ReportSlotFields,
): BuiltReportFieldSuggestions {
  const suggestions: ReportFieldSuggestion[] = [];
  const title = fields.title?.trim();
  if (title && rejectionReasonFor("title", title) === null) {
    suggestions.push({ field: "title", suggestedValue: title, source: REPORT_FIELD_SOURCE });
  }
  const description = fields.description?.trim();
  if (description && rejectionReasonFor("description", description) === null) {
    suggestions.push({ field: "description", suggestedValue: description, source: REPORT_FIELD_SOURCE });
  }
  const dateText = fields.dateText?.trim();
  if (dateText && rejectionReasonFor("date", dateText) === null) {
    suggestions.push({ field: "date", suggestedValue: dateText, source: REPORT_FIELD_SOURCE });
  }
  const category = fields.category?.trim();
  let droppedCategory = false;
  if (category) {
    if (rejectionReasonFor("category", category) === null) {
      suggestions.push({ field: "category", suggestedValue: category, source: REPORT_FIELD_SOURCE });
    } else {
      // The only category rejection is an unreleased label: keep the existing
      // downgrade contract (a notice), never an applicable patch.
      droppedCategory = true;
    }
  }
  return { suggestions, droppedCategory };
}

export interface SuggestReportFieldsResult extends BuiltReportFieldSuggestions {
  readonly action: AssistantAction;
}

export interface SuggestReportFieldsOptions {
  readonly signal?: AbortSignal;
}

/**
 * Runs `extract-report-fields` with an injected generate transport (tests pass
 * fakes; production wires its own transport) and maps the outcome to
 * reviewable patches. Abort-clean: a pre-aborted signal never calls generate;
 * a mid-flight abort returns CANCELLED without parsing, retrying, falling
 * back, or applying anything. Op validation failures pass through unchanged
 * (fail closed). The result is SUGGESTIONS ONLY — the caller renders
 * Apply/Keep per field and drops stale generations via its own generation
 * token. When every extracted value is the wrong kind, the result is the
 * normal empty shape (`suggestions: []`), never an error or a throw.
 */
export async function suggestReportFields(
  generate: GenerateFn,
  userMessage: string,
  profile: ModelProfile,
  options?: SuggestReportFieldsOptions,
): Promise<AiResult<SuggestReportFieldsResult>> {
  const signal = options?.signal;
  if (signal !== undefined && signal.aborted) {
    return { ok: false, error: makeAiError("CANCELLED", "ABORT_BEFORE_START") };
  }
  const opTask = extractReportFields(generate, userMessage, profile);
  let opResult: Awaited<typeof opTask>;
  if (signal === undefined) {
    opResult = await opTask;
  } else {
    opResult = await new Promise<Awaited<typeof opTask>>((resolve, reject) => {
      const onAbort = (): void => reject(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      opTask.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    }).catch((error: unknown): Awaited<typeof opTask> => {
      // Only an actual abort becomes CANCELLED. A transport failure from the
      // op itself must never be mislabeled as a cancellation.
      if (signal.aborted) {
        return {
          ok: false,
          error: makeAiError("CANCELLED", "ABORT_MID_GENERATION"),
        };
      }
      throw error;
    });
    if (signal.aborted) {
      return { ok: false, error: makeAiError("CANCELLED", "ABORT_MID_GENERATION") };
    }
  }
  if (!opResult.ok) return opResult;
  const built = buildReportFieldSuggestions(opResult.value.fields);
  return {
    ok: true,
    value: {
      suggestions: built.suggestions,
      droppedCategory: built.droppedCategory,
      action: opResult.value.action,
    },
  };
}

/** Type-level proof that a built category patch is always released. */
export function isReleasedCategoryPatch(
  suggestion: ReportFieldSuggestion,
): suggestion is ReportFieldSuggestion & { field: "category"; suggestedValue: Category } {
  return suggestion.field === "category" && isReleasedCategory(suggestion.suggestedValue);
}
