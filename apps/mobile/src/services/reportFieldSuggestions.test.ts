// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { stubGenerate, mustProfile } from "./ai/ops/testSupport";
import {
  buildReportFieldSuggestions,
  REPORT_FIELD_SOURCE,
  suggestReportFields,
} from "./reportFieldSuggestions";
import { DROPPED_CATEGORY_NOTE } from "./reportSuggestionNotes";

const PROFILE = mustProfile("test-thought-envelope");
const MESSAGE = "I lost my black umbrella yesterday near the central market.";
const VALID_DESCRIPTION = "Black umbrella with a wooden handle and a small tear.";

describe("buildReportFieldSuggestions (pure map)", () => {
  it("maps title/description/date/released-category to reviewable patches with source", () => {
    const built = buildReportFieldSuggestions({
      title: "Black umbrella",
      description: VALID_DESCRIPTION,
      category: "Umbrellas & Bottles",
      dateText: "2026-11-26",
      locationNote: "central market",
    });
    expect(built.droppedCategory).toBe(false);
    expect(built.suggestions).toEqual([
      { field: "title", suggestedValue: "Black umbrella", source: REPORT_FIELD_SOURCE },
      { field: "description", suggestedValue: VALID_DESCRIPTION, source: REPORT_FIELD_SOURCE },
      { field: "date", suggestedValue: "2026-11-26", source: REPORT_FIELD_SOURCE },
      { field: "category", suggestedValue: "Umbrellas & Bottles", source: REPORT_FIELD_SOURCE },
    ]);
  });

  it("downgrades an unreleased category but keeps title/description/date reviewable", () => {
    const built = buildReportFieldSuggestions({
      title: "Black umbrella",
      description: VALID_DESCRIPTION,
      category: "Spaceship Parts",
    });
    expect(built.droppedCategory).toBe(true);
    expect(built.suggestions.map((s) => s.field)).toEqual(["title", "description"]);
    expect(DROPPED_CATEGORY_NOTE).toMatch(/left out/);
  });

  it("emits no patches for empty input (Keep sends nothing, nothing to Apply)", () => {
    const built = buildReportFieldSuggestions({});
    expect(built.suggestions).toEqual([]);
    expect(built.droppedCategory).toBe(false);
  });

  it("skips blank strings and trims values", () => {
    const built = buildReportFieldSuggestions({
      title: "   ",
      description: `  ${VALID_DESCRIPTION}  `,
    });
    expect(built.suggestions).toEqual([
      { field: "description", suggestedValue: VALID_DESCRIPTION, source: REPORT_FIELD_SOURCE },
    ]);
  });
});

describe("buildReportFieldSuggestions (wrong-kind rejection)", () => {
  it("drops a place phrase suggested as a date", () => {
    const built = buildReportFieldSuggestions({
      title: "ClassWiz Scientific Calculator",
      description: "Black scientific calculator with a slide-on cover.",
      dateText: "near the battery compartment",
    });
    // The other fields stay reviewable; the place phrase is not offered at all,
    // so there is no "Use this date" that can land beside a real date field.
    expect(built.suggestions.map((s) => s.field)).toEqual(["title", "description"]);
    expect(built.suggestions.some((s) => s.suggestedValue === "near the battery compartment")).toBe(false);
  });

  it("drops an abbreviation suggested as a description", () => {
    const built = buildReportFieldSuggestions({ title: "Calculator", description: "S.T." });
    expect(built.suggestions).toEqual([
      { field: "title", suggestedValue: "Calculator", source: REPORT_FIELD_SOURCE },
    ]);
  });

  it("drops a date that is not a real calendar day", () => {
    const built = buildReportFieldSuggestions({ dateText: "2026-02-30" });
    expect(built.suggestions).toEqual([]);
  });

  it("drops a title that is only a number or only a date", () => {
    expect(buildReportFieldSuggestions({ title: "12345" }).suggestions).toEqual([]);
    expect(buildReportFieldSuggestions({ title: "2026-11-26" }).suggestions).toEqual([]);
  });

  it("keeps a valid full extraction unchanged", () => {
    const fields = {
      title: "Black umbrella",
      description: VALID_DESCRIPTION,
      category: "Umbrellas & Bottles",
      dateText: "2026-11-26",
      locationNote: "central market",
    };
    const built = buildReportFieldSuggestions(fields);
    expect(built.droppedCategory).toBe(false);
    expect(built.suggestions).toEqual([
      { field: "title", suggestedValue: fields.title, source: REPORT_FIELD_SOURCE },
      { field: "description", suggestedValue: fields.description, source: REPORT_FIELD_SOURCE },
      { field: "date", suggestedValue: fields.dateText, source: REPORT_FIELD_SOURCE },
      { field: "category", suggestedValue: fields.category, source: REPORT_FIELD_SOURCE },
    ]);
  });

  it("keeps an accepted date exactly as extracted (no reformat, no invention)", () => {
    const built = buildReportFieldSuggestions({ dateText: "2026-11-26" });
    expect(built.suggestions).toEqual([
      { field: "date", suggestedValue: "2026-11-26", source: REPORT_FIELD_SOURCE },
    ]);
  });
});

describe("suggestReportFields (extract-report-fields consumer, fakes only)", () => {
  it("returns reviewable patches from a fake extraction", async () => {
    const generate = stubGenerate(
      `{"title":"Black umbrella","description":"${VALID_DESCRIPTION}",` +
        '"category":"Umbrellas & Bottles","dateText":"2026-11-26",' +
        '"locationNote":"central market"}',
    );
    const result = await suggestReportFields(generate, MESSAGE, PROFILE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions.map((s) => s.field)).toEqual(["title", "description", "date", "category"]);
      expect(result.value.suggestions.every((s) => s.source === "extract-report-fields")).toBe(true);
      // The values the extraction produced, not merely the fields it named: a
      // copy of the reviewed list that substitutes or fabricates a value renders
      // and can be applied, so the reviewable patch is only reviewable if the
      // value it carries is the one that was extracted (CF-070 gate review
      // MAJOR-1).
      expect(result.value.suggestions.map((s) => s.suggestedValue)).toEqual([
        "Black umbrella",
        VALID_DESCRIPTION,
        "2026-11-26",
        "Umbrellas & Bottles",
      ]);
      expect(result.value.droppedCategory).toBe(false);
      expect(result.value.action).toEqual({ action: "NONE" });
    }
    expect(generate.calls).toBe(1);
  });

  it("drops a wrong-kind date and description from a real extraction", async () => {
    const generate = stubGenerate(
      '{"title":"ClassWiz Scientific Calculator","description":"S.T.",' +
        '"dateText":"near the battery compartment"}',
    );
    const result = await suggestReportFields(generate, MESSAGE, PROFILE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions).toEqual([
        {
          field: "title",
          suggestedValue: "ClassWiz Scientific Calculator",
          source: REPORT_FIELD_SOURCE,
        },
      ]);
      expect(result.value.droppedCategory).toBe(false);
    }
  });

  it("returns the empty contract, not a throw, when every field is the wrong kind", async () => {
    const generate = stubGenerate(
      '{"title":"2026-11-26","description":"S.T.",' +
        '"dateText":"near the battery compartment","category":"Spaceship Parts",' +
        '"locationNote":"central market"}',
    );
    const result = await suggestReportFields(generate, MESSAGE, PROFILE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions).toEqual([]);
      expect(result.value.droppedCategory).toBe(true);
      expect(result.value.action).toEqual({ action: "NONE" });
    }
  });

  it("downgrades an unreleased category to dropped, keeping other patches", async () => {
    const generate = stubGenerate('{"title":"Keys","category":"Spaceship Parts"}');
    const result = await suggestReportFields(generate, "Lost keys.", PROFILE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions.map((s) => s.field)).toEqual(["title"]);
      expect(result.value.suggestions.map((s) => s.suggestedValue)).toEqual(["Keys"]);
      expect(result.value.droppedCategory).toBe(true);
    }
  });

  it("fails closed on malformed model output (no patches, no apply)", async () => {
    const generate = stubGenerate("{objectName: black umbrella, colors: [}");
    const result = await suggestReportFields(generate, "Lost umbrella.", PROFILE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.errorClass).toBe("INVALID_OUTPUT");
  });

  it("never calls generate when already aborted (ABORT_BEFORE_START)", async () => {
    const generate = stubGenerate('{"title":"Keys"}');
    const controller = new AbortController();
    controller.abort();
    const result = await suggestReportFields(generate, "Lost keys.", PROFILE, {
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: { errorClass: "CANCELLED", diagnostic: "ABORT_BEFORE_START" } });
    expect(generate.calls).toBe(0);
  });

  it("aborts mid-generation cleanly with no fallback side effects", async () => {
    let release!: (text: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const generate = Object.assign(async () => pending, { calls: 0 });
    const controller = new AbortController();
    const task = suggestReportFields(generate, "Lost keys.", PROFILE, { signal: controller.signal });
    controller.abort();
    // The late model output must never surface: cancellation wins the race.
    release('{"title":"Late keys"}');
    const result = await task;
    expect(result).toEqual({ ok: false, error: { errorClass: "CANCELLED", diagnostic: "ABORT_MID_GENERATION" } });
  });

  it("does not mislabel a transport failure as cancellation", async () => {
    const failing = Object.assign(
      async (): Promise<string> => {
        throw new Error("transport exploded");
      },
      { calls: 0 },
    );
    // The documented contract is `AiResult`, so an engine failure comes back as
    // a result the screen renders ("Couldn't draft suggestions…"), never as a
    // rejection: a rejection here is silently unhandled unless every caller
    // remembers a try/catch (CF-040 F7).
    const result = await suggestReportFields(failing, MESSAGE, PROFILE);
    expect(result).toEqual({
      ok: false,
      error: { errorClass: "RUNTIME_ERROR", diagnostic: "FIELDS_GENERATION_FAILED" },
    });
  });
});
