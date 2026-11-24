#!/usr/bin/env node
/**
 * Release state: `release/state.json`.
 *
 * The file is the single source of truth for the next version and version code
 * the automatic release pipeline may publish. It is read, validated, and
 * written here so every consumer sees the same rules.
 *
 * Guarantees:
 *   * `writeState` emits the canonical serialisation only — 2-space indent,
 *     LF, trailing newline — so an unchanged state round-trips byte-identically.
 *   * Every validation failure names the offending field.
 *   * `claimVersionCode` accepts exactly `state.versionCode + 1`, so two
 *     claimants reading the same state cannot both succeed.
 *   * `lastRelease` and `pendingRelease` accept null, meaning "none yet".
 *
 * `commitExists` is injectable so validation can be tested without a real
 * repository checkout.
 *
 * Pure Node builtins. Test suite: scripts/release/state.test.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parse as parseVersion } from "./semver.mjs";

export const SCHEMA_VERSION = 1;
export const MAX_VERSION_CODE = 2_100_000_000;
export const STATE_FILE = "release/state.json";

// `channel` is a release-workflow label only: it decides whether the GitHub
// release is flagged as a prerelease and how the title is worded. It never
// appears in, or changes, the version string or any signing metadata.
const CHANNELS = ["beta", "stable"];
// `signingChannel` is the installation-compatibility label: it is written into
// the update catalogue and asserted by verify-consistency.mjs. The native
// update policy compares it with the installed build's label and rejects a
// mismatched update, so changing this value strands every existing
// installation. Promoting it requires a native policy migration first, which
// is why only `beta` is accepted here.
const SIGNING_CHANNELS = ["beta"];
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const TAG_RE = /^v[0-9A-Za-z.+-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function statePath(repoDir) {
  return resolve(repoDir, STATE_FILE);
}

function fail(field, problem) {
  throw new Error(`${STATE_FILE}: ${field} ${problem}`);
}

function validateVersionCode(value, field) {
  // versionCode is a monotonic floor, never a derived value: 101077 is the
  // highest code ever distributed and installed devices carry it, so it may
  // never be lowered. Every release claims exactly one more.
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_VERSION_CODE) {
    fail(field, `must be an integer in 1..${MAX_VERSION_CODE} (got ${JSON.stringify(value)})`);
  }
}

/** Shared shape of any release: tag, version, versionCode. */
function validateReleaseIdentity(value, field) {
  if (typeof value.tag !== "string" || !TAG_RE.test(value.tag)) {
    fail(`${field}.tag`, `must be a v-prefixed release tag (got ${JSON.stringify(value.tag)})`);
  }
  if (typeof value.version !== "string" || parseVersion(value.version) === null) {
    fail(`${field}.version`, `must be a SemVer version (got ${JSON.stringify(value.version)})`);
  }
  validateVersionCode(value.versionCode, `${field}.versionCode`);
}

/**
 * A release that has been published.
 *
 * `commit` and `publishedAt` are required because both facts exist by the time
 * a release is published: the tag points at a commit and the GitHub release
 * carries a creation timestamp.
 */
function validateRelease(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(field, "must be an object");
  }
  validateReleaseIdentity(value, field);
  if (typeof value.commit !== "string" || !COMMIT_RE.test(value.commit)) {
    fail(`${field}.commit`, `must be a 40-character hex commit SHA (got ${JSON.stringify(value.commit)})`);
  }
  if (
    typeof value.publishedAt !== "string" ||
    !ISO_RE.test(value.publishedAt) ||
    Number.isNaN(Date.parse(value.publishedAt))
  ) {
    fail(`${field}.publishedAt`, `must be an ISO-8601 timestamp (got ${JSON.stringify(value.publishedAt)})`);
  }
}

/**
 * A release the workflow has decided to publish but has not published yet.
 *
 * Publication is two commits, so every field here is known when this record is
 * written:
 *   * commit A is the version bump (`sync-version` output only), pushed first;
 *   * commit B is this `pendingRelease` record, which carries A.
 *
 * Because A exists before B is written, `commit` is required: it pins the exact
 * built tree, so recovery never substitutes whatever `main` happens to be and
 * drift is impossible rather than merely unlikely.
 *
 * `publishedAt` must be absent — nothing has been published, so a timestamp
 * here would be a lie that later reads as fact.
 */
function validatePendingRelease(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(field, "must be an object");
  }
  validateReleaseIdentity(value, field);
  if (typeof value.commit !== "string" || !COMMIT_RE.test(value.commit)) {
    fail(`${field}.commit`, `must be a 40-character hex commit SHA (got ${JSON.stringify(value.commit)})`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "publishedAt")) {
    fail(`${field}.publishedAt`, "must not be set: a pending release is not published yet");
  }
}

function defaultCommitExists(repoDir, sha) {
  try {
    execFileSync("git", ["-C", repoDir, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Validate a parsed state object. Returns it unchanged; throws on the first problem. */
export function validateState(state, { repoDir = process.cwd(), commitExists = defaultCommitExists } = {}) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    fail("state", "must be a JSON object");
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    fail("schemaVersion", `must be ${SCHEMA_VERSION} (got ${JSON.stringify(state.schemaVersion)})`);
  }
  if (!CHANNELS.includes(state.channel)) {
    fail("channel", `must be one of ${CHANNELS.join(", ")} (got ${JSON.stringify(state.channel)})`);
  }
  if (!SIGNING_CHANNELS.includes(state.signingChannel)) {
    fail(
      "signingChannel",
      `must be one of ${SIGNING_CHANNELS.join(", ")} (got ${JSON.stringify(state.signingChannel)}); ` +
        "promoting the installation channel requires a native policy migration first",
    );
  }
  if (typeof state.version !== "string" || parseVersion(state.version) === null) {
    fail("version", `must be a SemVer version (got ${JSON.stringify(state.version)})`);
  }
  validateVersionCode(state.versionCode, "versionCode");
  if (typeof state.classificationBase !== "string" || !COMMIT_RE.test(state.classificationBase)) {
    fail(
      "classificationBase",
      `must be a 40-character hex commit SHA (got ${JSON.stringify(state.classificationBase)})`,
    );
  }
  if (!commitExists(repoDir, state.classificationBase)) {
    fail("classificationBase", `commit ${state.classificationBase} does not exist in ${repoDir}`);
  }
  // `lastRelease` is null until a release has been published from this state;
  // null is a first-class value, not a missing field.
  if (state.lastRelease !== null) validateRelease(state.lastRelease, "lastRelease");
  if (state.pendingRelease !== null) validatePendingRelease(state.pendingRelease, "pendingRelease");
  return state;
}

/** Read and validate `${repoDir}/release/state.json`. */
export function loadState(repoDir = process.cwd(), { commitExists = defaultCommitExists } = {}) {
  const file = statePath(repoDir);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`${STATE_FILE}: cannot read ${file} (${error.code ?? error.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${STATE_FILE}: is not valid JSON (${error.message})`);
  }
  return validateState(parsed, { repoDir, commitExists });
}

/** Canonical serialisation: 2-space indent, LF, exactly one trailing newline. */
export function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Validate, then write the canonical serialisation. Returns the file path. */
export function writeState(repoDir = process.cwd(), state, { commitExists = defaultCommitExists } = {}) {
  validateState(state, { repoDir, commitExists });
  const file = statePath(repoDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeState(state), "utf8");
  return file;
}

/**
 * Return a new state with `versionCode` advanced to `nextCode`.
 *
 * Throws unless `nextCode` is exactly `state.versionCode + 1`: a caller that
 * read an older state cannot overwrite a claim it never observed.
 */
export function claimVersionCode(state, nextCode) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError(`${STATE_FILE}: claimVersionCode needs a state object`);
  }
  const current = state.versionCode;
  if (!Number.isSafeInteger(current)) {
    fail("versionCode", `must be an integer (got ${JSON.stringify(current)})`);
  }
  if (!Number.isSafeInteger(nextCode)) {
    fail("versionCode claim", `must be an integer (got ${JSON.stringify(nextCode)})`);
  }
  if (nextCode !== current + 1) {
    fail("versionCode claim", `${nextCode} is stale: state is ${current}, so the only claimable code is ${current + 1}`);
  }
  if (nextCode > MAX_VERSION_CODE) {
    fail("versionCode claim", `${nextCode} exceeds MAX_VERSION_CODE ${MAX_VERSION_CODE}`);
  }
  return { ...state, versionCode: nextCode };
}
