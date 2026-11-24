#!/usr/bin/env node
/**
 * Commit-message convention checker (see docs/COMMIT_CONVENTIONS.md).
 *
 * Subjects follow Conventional Commits: `type(scope)!: description`. A body is
 * optional; verification evidence lives in CI, not in commit text. Breaking
 * changes are declared with `!` or a `BREAKING CHANGE:` / `BREAKING-CHANGE:`
 * footer.
 *
 * Conventional Commits does not define a closed type list: a type is any
 * lowercase noun (`[a-z][a-z0-9-]*`). `feat` and `fix` are examples, not the
 * whole vocabulary.
 *
 * Exit codes:
 *   0  every checked message passes (including a range with no commits)
 *   1  at least one real convention violation
 *   3  the requested range could not be resolved
 *
 * Without `--strict-range`, an unresolvable range prints an explicit fallback
 * line and checks the last commit anyway; it still exits 3 unless that commit
 * itself violates the convention.
 *
 * Pure Node builtins. Test suite: scripts/check-commit-messages.test.mjs
 * Run: `node --test scripts/check-commit-messages.test.mjs` from repo root.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXIT_OK = 0;
export const EXIT_VIOLATION = 1;
export const EXIT_UNRESOLVABLE = 3;

const MAX_SUBJECT_LENGTH = 72;
const SEP = "\x1f";
const END = "\x1e";
const FORMAT = `%H${SEP}%s${SEP}%b${END}`;

// Merge, generated revert and release-automation commits are accepted without
// further checks. A generated revert is machine-written, so contributors
// cannot reshape its subject.
const MERGE_SUBJECT_RE = /^Merge (?:pull request|branch|remote-tracking branch)\b/;
const REVERT_SUBJECT_RE = /^Revert ".+"$/;
const RELEASE_SUBJECT_RE = /^(?:chore\(release\): v\d+\.\d+\.\d+|Bump\b)/;

// Conventional Commits defines no closed type list: a type is a lowercase
// noun. Letters, digits and hyphens are allowed after the first letter.
const TYPE_RE = /^[a-z][a-z0-9-]*$/;

// `type(scope)!: description`; the scope is a comma-separated list of
// lower-case path-ish segments and may never contain whitespace.
const SUBJECT_RE = /^([a-z][a-z0-9-]*)(?:\(([a-z0-9._/-]+(?:,[a-z0-9._/-]+)*)\))?(!)?: (.*)$/;
const EMPTY_DESCRIPTION_RE = /^([a-z][a-z0-9-]*)(?:\([a-z0-9._/-]+(?:,[a-z0-9._/-]+)*\))?!?:$/;

/** Thrown when the requested range or revision cannot be resolved. */
export class RangeResolutionError extends Error {}

/** True when `type` satisfies the Conventional Commits type grammar. */
export function isValidType(type) {
  return typeof type === "string" && TYPE_RE.test(type);
}

/**
 * Parse `type(scope)!: description`. Returns
 * `{ type, scope, breaking, description }` with `scope` null when absent, or
 * null when the subject does not match the grammar.
 */
export function parseSubject(subject) {
  if (typeof subject !== "string") return null;
  const text = subject.trim();
  if (!text) return null;
  const match = SUBJECT_RE.exec(text);
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  if (!isValidType(type)) return null;
  return { type, scope: scope ?? null, breaking: Boolean(bang), description };
}

/**
 * Classify a subject line. Returns "skip" for merge, generated revert and
 * release-automation commits, otherwise "normal". The versioning classifier
 * should treat every "skip" subject as impact "none".
 */
export function classifyCommit(subject) {
  const text = subject.trim();
  if (
    MERGE_SUBJECT_RE.test(text) ||
    REVERT_SUBJECT_RE.test(text) ||
    RELEASE_SUBJECT_RE.test(text)
  ) {
    return "skip";
  }
  return "normal";
}

/**
 * Check one commit message. Returns { ok, errors[], skipped }.
 * Never throws on content; never prints key material (no secrets involved).
 */
export function checkMessage(subject, body = "") {
  const trimmed = subject.trim();
  if (classifyCommit(trimmed) === "skip") return { ok: true, errors: [], skipped: true };
  if (!trimmed) return { ok: false, errors: ["subject is empty"], skipped: false };

  const errors = [];

  if (trimmed.length > MAX_SUBJECT_LENGTH) {
    errors.push(`subject is ${trimmed.length} characters; the limit is ${MAX_SUBJECT_LENGTH}`);
  }

  if (EMPTY_DESCRIPTION_RE.test(trimmed)) {
    errors.push("description is empty");
  } else {
    const parsed = parseSubject(trimmed);
    if (!parsed) {
      errors.push('subject must be "type(scope)!: description" with a lowercase type');
    } else {
      const { description } = parsed;
      if (description.length === 0) {
        errors.push("description is empty");
      } else if (description.startsWith(" ")) {
        errors.push("description must not start with a space");
      } else if (!/\p{L}/u.test(description)) {
        errors.push("description must contain at least one letter");
      }
    }
  }

  const footerError = breakingFooterError(body);
  if (footerError) errors.push(footerError);

  return { ok: errors.length === 0, errors, skipped: false };
}

function breakingFooterError(body) {
  const lines = String(body).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^BREAKING[ -]CHANGE:[ \t]*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    const following = (lines[index + 1] ?? "").trim();
    if (!inline && !following) return "BREAKING CHANGE footer must describe the break";
  }
  return null;
}

/** Encode commits into the `git log --format` wire form (used by tests). */
export function encodeLog(commits) {
  return commits
    .map(({ sha = "", subject = "", body = "" }) => `${sha}${SEP}${subject}${SEP}${body}${END}`)
    .join("");
}

/** Decode `git log --format` output into { sha, subject, body } records. */
export function parseLog(raw) {
  return String(raw)
    .split(END)
    .map((chunk) => chunk.replace(/^\n+/, ""))
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [sha = "", subject = "", body = ""] = chunk.split(SEP);
      return { sha: sha.trim(), subject: subject.trim(), body };
    });
}

function gitLog(git, args) {
  try {
    return git(args);
  } catch (error) {
    throw new RangeResolutionError(error?.message ?? String(error));
  }
}

/**
 * Load commits for the requested CLI selector. `git(args)` returns raw stdout
 * and throws on failure; tests inject fixtures instead of spawning processes.
 */
export function loadCommits(argv, git) {
  const rangeIdx = argv.indexOf("--range");
  const revIdx = argv.indexOf("--rev");
  const countIdx = argv.indexOf("--count");
  const useStdin = argv.includes("--stdin");

  if (useStdin) {
    return parseLog(readFileSync(0, "utf8")).map((commit, index) => ({
      ...commit,
      sha: commit.sha || `stdin-${index}`,
      subject: commit.subject || commit.sha,
    }));
  }

  if (rangeIdx !== -1) {
    const range = argv[rangeIdx + 1];
    if (!range) throw new Error("check-commit-messages: --range requires a value");
    return parseLog(gitLog(git, ["log", `--format=${FORMAT}`, range]));
  }
  if (revIdx !== -1) {
    const rev = argv[revIdx + 1];
    if (!rev) throw new Error("check-commit-messages: --rev requires a value");
    const commits = parseLog(gitLog(git, ["log", "-1", `--format=${FORMAT}`, rev]));
    if (commits.length === 0) throw new RangeResolutionError(`revision ${rev} is unknown`);
    return commits;
  }
  if (countIdx !== -1) {
    const count = argv[countIdx + 1];
    if (!count) throw new Error("check-commit-messages: --count requires a value");
    const commits = parseLog(gitLog(git, ["log", `-${count}`, `--format=${FORMAT}`]));
    if (commits.length === 0) throw new RangeResolutionError("history has no commits");
    return commits;
  }
  throw new Error(
    "check-commit-messages: expected one of --range A...B, --rev X, --count N, --stdin",
  );
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : "(no sha)";
}

function checkCommits(commits, out, err) {
  if (commits.length === 0) {
    out("check-commit-messages: PASS (0 checked, 0 skipped, 0 total — no commits in range)");
    return EXIT_OK;
  }

  let failed = 0;
  let skipped = 0;

  for (const { sha, subject, body } of commits) {
    const result = checkMessage(subject, body);
    if (result.skipped) {
      skipped += 1;
      out(`check-commit-messages: SKIP ${shortSha(sha)} ${subject}`);
      continue;
    }
    if (result.ok) continue;
    failed += 1;
    err(`check-commit-messages: FAIL ${shortSha(sha)} ${subject}`);
    for (const error of result.errors) err(`  - ${error}`);
  }

  const checked = commits.length - skipped;
  const status = failed > 0 ? "FAIL" : "PASS";
  const summary = `check-commit-messages: ${status} (${checked} checked, ${skipped} skipped, ${commits.length} total)`;
  if (failed > 0) {
    err(summary);
    return EXIT_VIOLATION;
  }
  out(summary);
  return EXIT_OK;
}

/**
 * Run the checker without exiting the process. `io` defaults to the console;
 * tests inject recorders. Returns the exit code.
 */
export function evaluate(argv, git, io = { out: console.log, err: console.error }) {
  const { out, err } = io;
  const strict = argv.includes("--strict-range");

  let commits;
  try {
    commits = loadCommits(argv, git);
  } catch (error) {
    if (!(error instanceof RangeResolutionError)) throw error;

    if (strict) {
      err(`check-commit-messages: range unresolvable (${error.message})`);
      return EXIT_UNRESOLVABLE;
    }

    err("range unresolvable, falling back to the last commit only");
    let fallback;
    try {
      fallback = loadCommits(["--count", "1"], git);
    } catch (fallbackError) {
      err(`check-commit-messages: range unresolvable (${fallbackError.message})`);
      return EXIT_UNRESOLVABLE;
    }

    const result = checkCommits(fallback, out, err);
    return result === EXIT_VIOLATION ? EXIT_VIOLATION : EXIT_UNRESOLVABLE;
  }

  return checkCommits(commits, out, err);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const git = (args) => execFileSync("git", args, { encoding: "utf8" });
    process.exit(evaluate(process.argv.slice(2), git));
  } catch (error) {
    console.error(
      error.message.startsWith("check-commit-messages:")
        ? error.message
        : `check-commit-messages: ${error.message}`,
    );
    process.exit(EXIT_VIOLATION);
  }
}
