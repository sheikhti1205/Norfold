#!/usr/bin/env node
/**
 * Commit classification for the automatic release pipeline.
 *
 * One commit becomes at most one impact, using Conventional Commits:
 *   feat                  -> minor
 *   fix, perf             -> patch
 *   refactor docs test    -> none
 *   build ci chore style  -> none
 *   revert                -> none
 *   `!` or BREAKING CHANGE footer -> major
 *
 * The type grammar is the conventional one (`type(scope)!: description`), so a
 * breaking marker is honoured for a type the impact table does not know: a
 * `dock!:` or `release-config(api)!:` subject, or a BREAKING[ -]CHANGE footer
 * under it, is major. `nextVersion` applies the pre-1.0 rule (major becomes a
 * minor bump while the version is still 0.x).
 *
 * File rules are independent of the type:
 *   * a commit that would be `none` but touches a shipped path is escalated to
 *     `patch`;
 *   * a commit that touches a shipped dependency manifest or the root lockfile
 *     is at least `patch` whatever its type, so `chore(deps): bump x` cannot
 *     slip out unreleased.
 * Two shapes are exempt from both rules because their file list is not their
 * own change:
 *   * merge commits (`merge: true`) — the file list is the whole branch diff;
 *   * generated reverts (`revert: true`) — `Revert "<subject>"`, whose file
 *     list is the full reverted diff. The commit-message checker skips the
 *     same two shapes, so versioning must agree.
 *
 * `classifyCommit` is pure and takes plain data so it is unit-testable.
 * `classifyRange` adds the git reads. A commit whose changed files cannot be
 * read throws instead of being reported as a clean commit.
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

// `type(scope)!: description`. The type may carry digits and hyphens
// (`release-config`), so the shape matches more types than the impact table
// knows; `parsed` below decides whether the type has an impact entry.
const SUBJECT_RE = /^([a-z][a-z0-9-]*)(?:\(([^()\r\n]*)\))?(!)?: +(\S.*)$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;
const MERGE_RE = /^Merge (?:pull request #\d+|branch\b|remote-tracking branch\b|tag\b)/;
// Git and GitHub's revert button generate exactly `Revert "<original subject>"`.
const GENERATED_REVERT_RE = /^Revert "[^"]+"$/;

/**
 * Manifests and lockfiles whose contents reach the app. A test-only or docs-only
 * manifest is not in this list, so editing one stays a non-release change.
 */
const SHIPPED_DEPENDENCY_FILES = new Set([
  "package.json",
  "apps/mobile/package.json",
  "packages/shared/package.json",
  "package-lock.json",
]);

/** Roots whose contents ship to users. Everything else is build/tooling/docs. */
const SHIPPED_PREFIXES = [
  "apps/mobile/src/",
  "apps/mobile/android/app/",
  "apps/mobile/public/",
  "packages/shared/src/",
  "apps/share-preview/",
  "supabase/migrations/",
  "supabase/functions/",
  "supabase/email-templates/",
];

/**
 * Shipped files outside those roots: the web shell, the build-time config that
 * decides what the bundle contains, the Android project defaults and the mobile
 * manifest (runtime dependencies plus the version the app is released as).
 */
const SHIPPED_FILES = new Set([
  "apps/mobile/index.html",
  "apps/mobile/vite.config.ts",
  "apps/mobile/vite.config.js",
  "apps/mobile/vite.config.mjs",
  "apps/mobile/capacitor.config.ts",
  "apps/mobile/capacitor.config.js",
  "apps/mobile/capacitor.config.mjs",
  "apps/mobile/package.json",
  "apps/mobile/android/variables.gradle",
  "apps/mobile/android/gradle.properties",
  "apps/mobile/android/settings.gradle",
  "apps/mobile/android/settings.gradle.kts",
  "apps/mobile/android/build.gradle",
  "apps/mobile/android/build.gradle.kts",
]);

const TEST_FILE_RE = /\.(?:test|spec)\.[^/]+$/;
const TEST_DIR_RE = /(^|\/)(?:__tests__|fixtures)\//;
const ANDROID_TEST_RE = /\/src\/(?:test|androidTest)\//;

/** Repo-relative form of a path from git or a test case. */
function normalisePath(file) {
  return String(file).replace(/\\/g, "/").replace(/^\.\//, "");
}

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
  const normalised = normalisePath(file);
  if (TEST_FILE_RE.test(normalised) || TEST_DIR_RE.test(normalised) || ANDROID_TEST_RE.test(normalised)) {
    return false;
  }
  return SHIPPED_FILES.has(normalised) || SHIPPED_PREFIXES.some((prefix) => normalised.startsWith(prefix));
}

/**
 * Classify one commit.
 *
 * Returns { impact, reason, unparseable, escalated, merge, revert }.
 *
 * `escalated` marks the shipped-path cross-check only: the commit's type said
 * `none` and its files made it releasable. The dependency rule is a declared
 * classification rule rather than an escalation, so it does not set the flag.
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

  // Breaking is read from the message shape, not from the impact table: a `!`
  // before the colon or a BREAKING[ -]CHANGE footer makes any type-shaped
  // subject major, including a type this table has never seen.
  const breaking = match !== null && (Boolean(match[3]) || BREAKING_FOOTER_RE.test(String(body ?? "")));

  let impact = "none";
  let reason = "subject is not a Conventional Commits message";

  if (breaking) {
    impact = "major";
    reason = `${type}: breaking change`;
  } else if (parsed) {
    impact = TYPE_IMPACT[type];
    reason = `${type}: ${impact}`;
  } else if (match !== null) {
    reason = `type ${JSON.stringify(type)} has no impact entry; treated as none`;
  }

  // File rule: a shipped dependency manifest or the root lockfile is
  // releasable whatever the commit type says, so `chore(deps): bump x` cannot
  // ship unnoticed.
  const dependencyFile = changed.map(normalisePath).find((file) => SHIPPED_DEPENDENCY_FILES.has(file));
  if (dependencyFile !== undefined && impactRank(impact) < impactRank("patch")) {
    impact = "patch";
    reason = `${reason}; shipped dependency file ${dependencyFile} makes it patch`;
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

/** Best available text for a failed git call: stderr first, then the message. */
function gitFailureText(error) {
  const stderr = error?.stderr;
  if (stderr !== undefined && stderr !== null) {
    const text = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr);
    if (text.trim() !== "") return text.trim();
  }
  if (error?.message !== undefined) return String(error.message).trim();
  return "unknown git error";
}

/**
 * Changed paths for one commit.
 *
 * A root commit has no parent, so the parent diff fails and the full tree is
 * requested instead. If both reads fail the commit is unreadable: throw rather
 * than return `[]`, because an empty file list would silently mean "nothing
 * shipped" and skip the release. `runGit(repoDir, args)` is injectable so a
 * test can fail the reads without spawning git.
 */
export function filesForCommit(repoDir, sha, runGit = git) {
  let parentError;
  try {
    return runGit(repoDir, ["diff", "--name-only", "--no-renames", `${sha}^`, sha])
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    parentError = error;
  }

  try {
    return runGit(repoDir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", "--root", sha])
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    const unreadable = new Error(
      `classify: cannot read the changed files of commit ${sha} in ${repoDir}: ` +
        `${gitFailureText(error)} (parent diff: ${gitFailureText(parentError)})`,
    );
    unreadable.code = "COMMIT_UNREADABLE";
    unreadable.sha = sha;
    throw unreadable;
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
 * Throws an Error with code `RANGE_UNRESOLVABLE` when `baseRef` is not a commit
 * and with code `COMMIT_UNREADABLE` when a commit's file list cannot be read;
 * neither is a clean range.
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
