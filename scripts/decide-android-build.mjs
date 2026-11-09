#!/usr/bin/env node
/**
 * decide-android-build: one value decides what the Android workflow does.
 *
 * `ANDROID_BUILD_MODE` (repo variable, readable in the UI) takes:
 *   none    - never build on a push; the workflow does nothing automatically
 *   build   - build on every successful main CI run, upload a 7-day artifact,
 *             never create or touch a release
 *   publish - build only when this commit has something to publish, then
 *             create/refresh the numbered release (immutable once published)
 *
 * Unset or unrecognised falls back to `publish`, which is the behaviour the
 * workflow had before this switch existed.
 *
 * A `workflow_dispatch` run may override the mode for that one run; `auto`
 * means "use the repo variable".
 *
 * Why a decide step at all: numbered releases are immutable, so a commit whose
 * version is already published has nothing to publish. Deciding that in a
 * 5-minute guard job avoids a 45-minute build that must then throw its work
 * away. Modes `build` and `none` exist so the guard is not the only lever.
 *
 * Pure and injectable: importing this module runs nothing.
 */
import { appendFileSync } from "node:fs";

export const MODES = ["none", "build", "publish"];
export const DEFAULT_MODE = "publish";

/**
 * Normalise a mode string. Unknown or empty values fall back to `publish` and
 * say so, because silently doing nothing is the one outcome an operator cannot
 * see from a green workflow.
 */
export function normalizeMode(value, { fallback = DEFAULT_MODE } = {}) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "auto") return { mode: fallback, warning: null };
  if (MODES.includes(raw)) return { mode: raw, warning: null };
  return { mode: fallback, warning: `unknown build mode "${raw}"; using "${fallback}"` };
}

/**
 * Decide what this run should do.
 *
 * Inputs:
 *   mode               none | build | publish
 *   eventName          workflow_run | workflow_dispatch | ...
 *   workflowConclusion upstream CI conclusion (workflow_run only)
 *   workflowEvent      upstream trigger, e.g. "push" (workflow_run only)
 *   sameRepo           upstream run is from this repository
 *   headSha            commit this run would build
 *   tagSha             commit the version tag points at, or null
 *   releaseSha         commit the existing release (if any) targets, or null
 *
 * Returns { decision: "skip" | "build" | "publish", reason }.
 */
export function decideAndroidBuild({
  mode = DEFAULT_MODE,
  eventName = "workflow_run",
  workflowConclusion = "success",
  workflowEvent = "push",
  sameRepo = true,
  headSha = "",
  tagSha = null,
  releaseSha = null,
} = {}) {
  const { mode: resolved, warning } = normalizeMode(mode);
  const asWarning = warning ? [warning] : [];

  // An upstream CI run that failed, or was not a push to this repository, is
  // never a build trigger regardless of mode.
  if (eventName === "workflow_run") {
    if (workflowConclusion !== "success") {
      return { decision: "skip", reason: `upstream CI concluded ${workflowConclusion}`, warnings: asWarning };
    }
    if (workflowEvent !== "push") {
      return { decision: "skip", reason: `upstream event was ${workflowEvent}, not push`, warnings: asWarning };
    }
    if (!sameRepo) {
      return { decision: "skip", reason: "upstream run is not from this repository", warnings: asWarning };
    }
  }

  if (resolved === "none") {
    return { decision: "skip", reason: "build mode is none", warnings: asWarning };
  }
  if (resolved === "build") {
    return { decision: "build", reason: "build mode is build; artifacts only, no release", warnings: asWarning };
  }

  // publish
  if (tagSha && headSha && tagSha === headSha) {
    return { decision: "skip", reason: "this version is already published from this exact commit", warnings: asWarning };
  }
  if (tagSha && tagSha !== headSha) {
    return {
      decision: "skip",
      reason: `this version is already published from ${tagSha.slice(0, 12)}; bump the app version to publish ${headSha.slice(0, 12)}`,
      warnings: asWarning,
    };
  }
  if (releaseSha && headSha && releaseSha !== headSha) {
    return {
      decision: "skip",
      reason: `the existing release targets ${releaseSha.slice(0, 12)}; bump the app version`,
      warnings: asWarning,
    };
  }
  return { decision: "publish", reason: "no release for this version yet", warnings: asWarning };
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
    headSha: env.HEAD_SHA ?? "",
    tagSha: env.TAG_SHA || null,
    releaseSha: env.RELEASE_SHA || null,
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
