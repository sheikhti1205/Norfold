#!/usr/bin/env node
/**
 * Commit classification for the automatic release pipeline.
 *
 * One commit becomes at most one impact, using Conventional Commits:
 *   feat                  -> minor
 *   fix, perf             -> patch
 *   refactor docs test    -> none
 *   build ci chore style  -> none (except a dependency change -> patch)
 *   revert                -> none
 *   `!` or BREAKING CHANGE footer -> major
 *
 * File cross-check: a commit that would be `none` but touches a shipped path
 * is escalated to `patch`. Two shapes are exempt because their file list is
 * not their own change:
 *   * merge commits (`merge: true`) — the file list is the whole branch diff;
 *   * generated reverts (`revert: true`) — `Revert "<subject>"`, whose file
 *     list is the full reverted diff. The commit-message checker skips the
 *     same two shapes, so versioning must agree.
 *
 * `classifyCommit` is pure and takes plain data so it is unit-testable.
 * `classifyRange` adds the git reads.
 *
 * Pure Node builtins. Test suite: scripts/release/classify.test.mjs
 */
import { execFileSync } from "node:child_process";

export const IMPACTS = ["none", "patch", "minor", "major"];

const IMPACT_RANK = { none: 0, patch: 1, minor: 2, major: 3 };

const TYPES = new Set([
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "style",
  "revert",
]);

const TYPE_IMPACT = {
  feat: "minor",
  fix: "patch",
  perf: "patch",
  refactor: "none",
  docs: "none",
  test: "none",
  build: "none",
  ci: "none",
  chore: "none",
  style: "none",
  revert: "none",
};

// `type(scope)!: description`
const SUBJECT_RE = /^([a-z]+)(?:\(([^()\r\n]*)\))?(!)?: +(\S.*)$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;
const MERGE_RE = /^Merge (?:pull request #\d+|branch\b|remote-tracking branch\b|tag\b)/;
// Git and GitHub's revert button generate exactly `Revert "<original subject>"`.
const GENERATED_REVERT_RE = /^Revert "[^"]+"$/;

const DEPENDENCY_FILES = new Set(["apps/mobile/package.json", "packages/shared/package.json"]);

/** Roots whose contents ship to users. Everything else is build/tooling/docs. */
const SHIPPED_PREFIXES = [
  "apps/mobile/src/",
  "apps/mobile/android/app/",
  "apps/mobile/public/",
  "packages/shared/src/",
  "apps/share-preview/",
  "supabase/migrations/",
];

const TEST_FILE_RE = /\.(?:test|spec)\.[^/]+$/;
const TEST_DIR_RE = /(^|\/)(?:__tests__|fixtures)\//;
const ANDROID_TEST_RE = /\/src\/(?:test|androidTest)\//;

/** 0..3 for none/patch/minor/major. Throws TypeError on an unknown impact. */
export function impactRank(impact) {
  const rank = IMPACT_RANK[impact];
  if (rank === undefined) {
    throw new TypeError(`classify: unknown impact ${JSON.stringify(impact)}`);
  }
  return rank;
}

/** Highest impact in a list; `none` for an empty list. */
export function maxImpact(list) {
  let result = "none";
  for (const impact of list) {
    if (impactRank(impact) > impactRank(result)) result = impact;
  }
  return result;
}

/** True when a changed path ships to users (test files and fixtures excluded). */
export function isShippedPath(file) {
  if (typeof file !== "string" || file === "") return false;
  const normalised = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (TEST_FILE_RE.test(normalised) || TEST_DIR_RE.test(normalised) || ANDROID_TEST_RE.test(normalised)) {
    return false;
  }
  return SHIPPED_PREFIXES.some((prefix) => normalised.startsWith(prefix));
}

/**
 * Classify one commit.
 *
 * Returns { impact, reason, unparseable, escalated, merge, revert }.
 *
 * Only the changed file list is available here, so a `build` commit that
 * touches `apps/mobile/package.json` or `packages/shared/package.json` counts
 * as a dependency change. Reading the diff would make this impure for no gain:
 * a dependency bump is the only reason those commits are patch-worthy.
 */
export function classifyCommit({ subject = "", body = "", files = [] } = {}) {
  const text = String(subject ?? "").trim();
  const changed = Array.isArray(files) ? files : [];

  if (MERGE_RE.test(text)) {
    return {
      impact: "none",
      reason: "merge commit: branch history, not a change of its own",
      unparseable: false,
      escalated: false,
      merge: true,
      revert: false,
    };
  }

  // The generated revert's file list is the whole reverted diff, so it is not
  // evidence that shipped code changed. A hand-written `revert:` does not get
  // this exemption and stays subject to the normal cross-check below.
  if (GENERATED_REVERT_RE.test(text)) {
    return {
      impact: "none",
      reason: "generated revert: restores the reverted tree, not a change of its own",
      unparseable: false,
      escalated: false,
      merge: false,
      revert: true,
    };
  }

  const match = SUBJECT_RE.exec(text);
  const type = match === null ? null : match[1];
  const parsed = match !== null && TYPES.has(type);

  let impact = "none";
  let reason = "subject is not a Conventional Commits message";

  if (parsed) {
    const breaking = Boolean(match[3]) || BREAKING_FOOTER_RE.test(String(body ?? ""));
    if (breaking) {
      impact = "major";
      reason = `${type}: breaking change`;
    } else if (type === "build" && changed.some((file) => DEPENDENCY_FILES.has(file))) {
      impact = "patch";
      reason = "build: dependency change";
    } else {
      impact = TYPE_IMPACT[type];
      reason = `${type}: ${impact}`;
    }
  }

  // Unparseable commits are cross-checked too: shipped code changed, so the
  // release cannot be skipped just because the message was malformed.
  let escalated = false;
  if (impact === "none") {
    const shipped = changed.filter(isShippedPath);
    if (shipped.length > 0) {
      impact = "patch";
      escalated = true;
      reason = `${reason}; changes shipped path ${shipped[0]}${shipped.length > 1 ? ` (+${shipped.length - 1})` : ""}`;
    }
  }

  return {
    impact,
    reason,
    unparseable: !parsed,
    escalated,
    merge: false,
    revert: false,
  };
}

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCommit(repoDir, ref) {
  try {
    const sha = git(repoDir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
    if (sha === "") throw new Error("empty");
    return sha;
  } catch {
    const error = new Error(`classify: cannot resolve ${JSON.stringify(ref)} to a commit in ${repoDir}`);
    error.code = "RANGE_UNRESOLVABLE";
    throw error;
  }
}

function filesForCommit(repoDir, sha) {
  try {
    return git(repoDir, ["diff", "--name-only", "--no-renames", `${sha}^`, sha])
      .split("\n")
      .filter(Boolean);
  } catch {
    // A root commit has no parent; ask git for the full tree instead.
    try {
      return git(repoDir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", "--root", sha])
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

function parseLog(raw) {
  return raw
    .split(RECORD_SEP)
    .map((chunk) => chunk.replace(/^\n+/, ""))
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const parts = chunk.split(FIELD_SEP);
      return {
        sha: (parts[0] ?? "").trim(),
        subject: (parts[1] ?? "").trim(),
        body: parts.slice(2).join(FIELD_SEP),
      };
    });
}

/**
 * Classify every commit in `baseRef..HEAD`.
 *
 * Returns { impact, commits: [{ sha, subject, impact, reason, files,
 *           unparseable, escalated, merge, revert }], unparseable: [sha],
 *           escalated: [sha] }.
 * Throws an Error with code `RANGE_UNRESOLVABLE` when `baseRef` is not a commit.
 */
export function classifyRange(repoDir, baseRef) {
  const baseSha = resolveCommit(repoDir, baseRef);
  const format = `%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
  const raw = git(repoDir, ["log", `--format=${format}`, `${baseSha}..HEAD`]);

  const commits = parseLog(raw).map((entry) => {
    const files = filesForCommit(repoDir, entry.sha);
    const classification = classifyCommit({ subject: entry.subject, body: entry.body, files });
    return { sha: entry.sha, subject: entry.subject, ...classification, files };
  });

  return {
    impact: maxImpact(commits.map((commit) => commit.impact)),
    commits,
    unparseable: commits.filter((commit) => commit.unparseable).map((commit) => commit.sha),
    escalated: commits.filter((commit) => commit.escalated).map((commit) => commit.sha),
  };
}
