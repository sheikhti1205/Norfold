#!/usr/bin/env node
/**
 * decide-android-build: one value decides what the Android workflow does.
 *
 * `ANDROID_BUILD_MODE` (repo variable, readable in the UI) takes:
 *   none    - never build on a push; the workflow does nothing automatically
 *   build   - build on every successful main CI run, upload a 7-day artifact,
 *             never create or touch a release
 *
 * Numbered releases are produced only by the tag-driven release.yml, so no mode
 * here publishes. The legacy value `publish` is still accepted but is treated as
 * `build` with a deprecation notice: it keeps the build operators already had and
 * simply drops the release step.
 *
 * Unset or unrecognised falls back to `build`, the behaviour the former `publish`
 * default has now that releases live in release.yml.
 *
 * A `workflow_dispatch` run may override the mode for that one run; `auto`
 * means "use the repo variable".
 *
 * Why a decide step at all: an upstream CI run that failed, or was not a push to
 * this repository, must never start a 45-minute build. The guard makes that
 * cheap, and `none` lets an operator disable automatic builds without editing
 * the workflow.
 *
 * Pure and injectable: importing this module runs nothing.
 */
import { appendFileSync } from "node:fs";

export const MODES = ["none", "build"];
export const DEFAULT_MODE = "build";

/** Legacy values still accepted from the repo variable, and what they mean now. */
export const DEPRECATED_MODES = { publish: "build" };

/**
 * Normalise a mode string.
 *
 * `none` and `build` pass through. The deprecated `publish` becomes `build`
 * with a warning, because a numbered release is release.yml's job now. Empty,
 * `auto` and unrecognised values fall back to the default; only an unrecognised
 * value is worth a warning, because a deliberately absent value is not a typo.
 */
export function normalizeMode(value, { fallback = DEFAULT_MODE } = {}) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "auto") return { mode: fallback, warning: null };
  if (Object.prototype.hasOwnProperty.call(DEPRECATED_MODES, raw)) {
    const mode = DEPRECATED_MODES[raw];
    return {
      mode,
      warning:
        `build mode "${raw}" is deprecated and now behaves as "${mode}": numbered ` +
        `releases are produced by release.yml, so change ANDROID_BUILD_MODE to ` +
        `"${mode}" (or "none")`,
    };
  }
  if (MODES.includes(raw)) return { mode: raw, warning: null };
  return { mode: fallback, warning: `unknown build mode "${raw}"; using "${fallback}"` };
}

/**
 * Decide what this run should do.
 *
 * Inputs:
 *   mode               none | build | publish (deprecated alias of build)
 *   eventName          workflow_run | workflow_dispatch | ...
 *   workflowConclusion upstream CI conclusion (workflow_run only)
 *   workflowEvent      upstream trigger, e.g. "push" (workflow_run only)
 *   sameRepo           upstream run is from this repository
 *
 * Returns { decision: "skip" | "build", reason, warnings }.
 */
export function decideAndroidBuild({
  mode = DEFAULT_MODE,
  eventName = "workflow_run",
  workflowConclusion = "success",
  workflowEvent = "push",
  sameRepo = true,
} = {}) {
  const { mode: resolved, warning } = normalizeMode(mode);
  const warnings = warning ? [warning] : [];

  // An upstream CI run that failed, or was not a push to this repository, is
  // never a build trigger regardless of mode.
  if (eventName === "workflow_run") {
    if (workflowConclusion !== "success") {
      return { decision: "skip", reason: `upstream CI concluded ${workflowConclusion}`, warnings };
    }
    if (workflowEvent !== "push") {
      return { decision: "skip", reason: `upstream event was ${workflowEvent}, not push`, warnings };
    }
    if (!sameRepo) {
      return { decision: "skip", reason: "upstream run is not from this repository", warnings };
    }
  }

  if (resolved === "none") {
    return { decision: "skip", reason: "build mode is none", warnings };
  }
  return { decision: "build", reason: "build mode; signed artifacts only, never a release", warnings };
}

/** Human-readable one-liner for the job log. */
export function formatDecision({ decision, reason }) {
  return `android-build: ${decision} (${reason})`;
}

function main() {
  const env = process.env;
  const result = decideAndroidBuild({
    mode: env.MODE ?? DEFAULT_MODE,
    eventName: env.GITHUB_EVENT_NAME ?? "workflow_run",
    workflowConclusion: env.UPSTREAM_CONCLUSION ?? "success",
    workflowEvent: env.UPSTREAM_EVENT ?? "push",
    sameRepo: (env.SAME_REPO ?? "true") === "true",
  });
  for (const warning of result.warnings ?? []) console.log(`::warning::${warning}`);
  // The mode is echoed so a run log shows which lever produced this outcome.
  console.log(formatDecision(result));
  console.log(`android-build-mode: ${normalizeMode(env.MODE).mode}`);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `decision=${result.decision}\nreason=${result.reason}\n`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main();
}
