#!/usr/bin/env node
/**
 * Decide whether this commit needs a release, and which version it would be.
 *
 * Reads `release/state.json`, classifies `classificationBase..HEAD`, and
 * prints a deterministic JSON decision to stdout (human summary on stderr).
 *
 * A release is required only when all of these hold:
 *   * the range contains at least one shipped change (impact > none)
 *   * RELEASE_PUBLICATION_ENABLED=true
 *   * the batch interval since the last publication has elapsed, OR the change
 *     is urgent (RELEASE_URGENT=true), OR the impact is `major`. With no
 *     `lastRelease` there is no batching reference, so the interval is skipped
 *     and the first release can go out immediately.
 *
 * Publication happens in two phases: the workflow writes `pendingRelease` and
 * bumps the package files, then builds, then creates the tag and the GitHub
 * release, then promotes the pending values. A `pendingRelease` is therefore a
 * continuation, never a new decision: it is resumed with the version and code
 * it recorded, whether or not the tag exists yet, and neither the batching
 * interval nor urgency can postpone it. Only the publication switch can stop
 * it, because the emergency switch must also be able to halt an in-flight
 * release.
 *
 * Idempotency: with no pending release, a tag that already exists means "no
 * release" and no further version is invented — publishing is a tag push, and
 * a tag is created once.
 *
 * Exit codes: 0 any decision (including "no release"), 1 blocking problems,
 * 2 cannot decide (invalid state, git unavailable, ambiguous base).
 *
 * Usage:
 *   node scripts/release/resolve-release.mjs [--repo <dir>] [--json]
 *     [--github-output <file>]
 *
 * Pure Node builtins. Test suite: scripts/release/resolve-release.test.mjs
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { classifyRange } from "./classify.mjs";
import { nextVersion, nextVersionCode } from "./next-version.mjs";
import { compare, parse as parseVersion } from "./semver.mjs";
import { loadState } from "./state.mjs";

export const DEFAULT_BATCH_INTERVAL_HOURS = 24;
const HOUR_MS = 3_600_000;

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

/** Parse RELEASE_BATCH_INTERVAL_HOURS. Unset means the default; garbage blocks. */
export function parseBatchInterval(value) {
  if (value === undefined) return { hours: DEFAULT_BATCH_INTERVAL_HOURS, problem: null };
  const trimmed = String(value).trim();
  const hours = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(hours) || hours < 0) {
    return {
      hours: null,
      problem: `RELEASE_BATCH_INTERVAL_HOURS must be a number >= 0 (got ${JSON.stringify(String(value))})`,
    };
  }
  return { hours, problem: null };
}

function countImpacts(commits) {
  const breakdown = { none: 0, patch: 0, minor: 0, major: 0 };
  for (const commit of commits) breakdown[commit.impact] += 1;
  return breakdown;
}

/**
 * Resume a release whose decision was already made and written to state.
 *
 * The recorded version and code are used verbatim — they are never recomputed.
 * A malformed pending release is reported as a blocking problem instead of
 * being repaired, because silently changing it would publish a second version.
 */
function resumePendingRelease({ decision, state, pendingRelease, publicationEnabled, tagExists }) {
  const version = typeof pendingRelease.version === "string" ? pendingRelease.version : null;
  const versionCode = Number.isSafeInteger(pendingRelease.versionCode) ? pendingRelease.versionCode : null;
  decision.version = version;
  decision.version_code = versionCode;

  const problems = [];
  if (version === null || parseVersion(version) === null) {
    problems.push(`pendingRelease.version ${JSON.stringify(pendingRelease.version)} is not a SemVer version`);
  } else if (compare(version, state.version) !== 1) {
    problems.push(`pendingRelease.version ${version} does not sort above state.version ${state.version}`);
  }
  if (versionCode === null) {
    problems.push(`pendingRelease.versionCode ${JSON.stringify(pendingRelease.versionCode)} is not an integer`);
  } else if (versionCode !== state.versionCode + 1) {
    problems.push(
      `pendingRelease.versionCode ${versionCode} is not state.versionCode + 1 (${state.versionCode + 1})`,
    );
  }
  if (problems.length > 0) {
    decision.blocking_problems.push(...problems);
    decision.reason = "pending release is invalid";
    return decision;
  }

  // Phase 1 leaves the tag absent; phase 2 creates it after the build. Both
  // are mid-flight resumptions of the same version.
  decision.reason = tagExists(`v${version}`)
    ? "resuming pending release (tag already created)"
    : "resuming pending release";

  if (!publicationEnabled) {
    decision.reason = "publication disabled by RELEASE_PUBLICATION_ENABLED";
    return decision;
  }

  decision.release_required = true;
  return decision;
}

/**
 * Pure decision core.
 *
 * Inputs:
 *   state       validated release state
 *   range       classifyRange() output
 *   env         environment map (RELEASE_PUBLICATION_ENABLED,
 *               RELEASE_BATCH_INTERVAL_HOURS, RELEASE_URGENT)
 *   now         epoch milliseconds
 *   tagExists   (tag) => boolean
 */
export function resolveRelease({ state, range, env = {}, now = Date.now(), tagExists = () => false } = {}) {
  const blockingProblems = [];
  const interval = parseBatchInterval(env.RELEASE_BATCH_INTERVAL_HOURS);
  if (interval.problem !== null) blockingProblems.push(interval.problem);
  const publicationEnabled = isTrue(env.RELEASE_PUBLICATION_ENABLED);
  const urgent = isTrue(env.RELEASE_URGENT);

  const impact = range.impact;
  const lastRelease = state.lastRelease ?? null;
  const pendingRelease = state.pendingRelease ?? null;

  const decision = {
    release_required: false,
    version: null,
    version_code: null,
    impact,
    classification_base: state.classificationBase,
    last_release_tag: lastRelease === null ? null : lastRelease.tag,
    commits_total: range.commits.length,
    impact_breakdown: countImpacts(range.commits),
    escalated: [...range.escalated],
    unparseable: [...range.unparseable],
    reason: "no releasable changes",
    blocking_problems: blockingProblems,
    batch_interval_hours: interval.hours,
    publication_enabled: publicationEnabled,
  };

  // A pending release is a continuation of an earlier decision, so it is
  // resolved before any bump is computed and is immune to interval/urgency.
  if (pendingRelease !== null) {
    return resumePendingRelease({ decision, state, pendingRelease, publicationEnabled, tagExists });
  }

  const candidate = nextVersion(state, impact);

  if (!candidate.required) return decision;

  const tag = `v${candidate.version}`;
  if (tagExists(tag)) {
    decision.reason = "tag already exists";
    return decision;
  }

  const versionCode = nextVersionCode(state);
  decision.version = candidate.version;
  decision.version_code = versionCode;

  if (!publicationEnabled) {
    decision.reason = "publication disabled";
    return decision;
  }

  const publishedAt = lastRelease === null ? Number.NaN : Date.parse(lastRelease.publishedAt);
  // A null lastRelease means no batching reference: the gate is skipped
  // (treated as elapsed), not blocked, so the first release after a wipe never
  // waits for the interval. batch_interval_hours is still reported.
  const elapsed =
    lastRelease === null ||
    (interval.hours !== null && Number.isFinite(publishedAt) && now - publishedAt >= interval.hours * HOUR_MS);

  if (!urgent && impact !== "major" && !elapsed) {
    decision.reason = "batch interval not elapsed";
    return decision;
  }

  decision.release_required = true;
  decision.reason = urgent ? "release required (urgent)" : impact === "major" ? "release required (major change)" : "release required";
  return decision;
}

/** Append `key=value` lines for scalar keys only (arrays/objects are skipped). */
export function appendGithubOutput(file, decision) {
  const lines = [];
  for (const [key, value] of Object.entries(decision)) {
    if (value !== null && typeof value === "object") continue;
    lines.push(`${key.toLowerCase()}=${value === null ? "" : String(value)}`);
  }
  appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

export function formatSummary(decision) {
  const state = decision.release_required ? "release required" : "no release";
  const version = decision.version === null ? "-" : `${decision.version} (${decision.version_code})`;
  return `resolve-release: ${state} (${decision.reason}); version=${version} impact=${decision.impact} commits=${decision.commits_total}`;
}

function tagExistsIn(repoDir) {
  return (tag) => {
    try {
      execFileSync("git", ["-C", repoDir, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), json: false, githubOutput: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo" || arg === "--github-output") {
      const value = argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error(`resolve-release: ${arg} requires a value`);
      }
      if (arg === "--repo") options.repo = value;
      else options.githubOutput = value;
      index += 1;
      continue;
    }
    throw new Error(`resolve-release: unknown argument ${JSON.stringify(arg)}`);
  }
  return options;
}

function decide(repoDir) {
  const state = loadState(repoDir);
  const range = classifyRange(repoDir, state.classificationBase);
  return resolveRelease({ state, range, env: process.env, tagExists: tagExistsIn(repoDir) });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoDir = resolve(options.repo);

  const decision = decide(repoDir);

  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  process.stderr.write(`${formatSummary(decision)}\n`);
  for (const problem of decision.blocking_problems) process.stderr.write(`resolve-release: blocking: ${problem}\n`);

  if (options.githubOutput !== null) appendGithubOutput(resolve(options.githubOutput), decision);

  process.exitCode = decision.blocking_problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const message = error.message.startsWith("resolve-release:") ? error.message : `resolve-release: ${error.message}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}
