#!/usr/bin/env node
/**
 * Single-command version writes for the release pipeline.
 *
 * The product version lives in exactly four places:
 *   * package.json                              -> version
 *   * apps/mobile/package.json                  -> version
 *   * package-lock.json                         -> packages[""].version
 *   * package-lock.json                         -> packages["apps/mobile"].version
 *
 * Nothing else is written. `packages/shared` is an independent internal package
 * and is never read or touched. The lockfile's own top-level `version` is left
 * exactly as it is: npm writes it, this tool does not.
 *
 * Writes are computed fully in memory first. For every file the new text is
 * compared line by line with the original; a difference on any line other than
 * a located version line aborts the whole run before anything reaches disk.
 * Line endings, indentation, key order and the trailing newline are preserved
 * because only the version string itself is replaced.
 *
 * Usage:
 *   node scripts/release/sync-version.mjs 0.17.0 [--repo <dir>]
 *   node scripts/release/sync-version.mjs --verify 0.17.0 [--repo <dir>]
 *   node scripts/release/sync-version.mjs --verify [--repo <dir>]
 *
 * With `--verify` and no version, the four places are compared with each other
 * and, when it exists, with `release/state.json`.
 *
 * Pure Node builtins. Test suite: scripts/release/sync-version.test.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STATE_FILE = "release/state.json";

/** Plain `X.Y.Z` only: no prerelease suffix, no build metadata. */
export const PLAIN_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The four write locations, in reporting order. */
export const TARGETS = [
  { id: "root", file: "package.json", path: ["version"], label: "package.json version" },
  { id: "mobile", file: "apps/mobile/package.json", path: ["version"], label: "apps/mobile/package.json version" },
  {
    id: "lockRoot",
    file: "package-lock.json",
    path: ["packages", "", "version"],
    label: 'package-lock.json packages[""].version',
  },
  {
    id: "lockMobile",
    file: "package-lock.json",
    path: ["packages", "apps/mobile", "version"],
    label: 'package-lock.json packages["apps/mobile"].version',
  },
];

const PROBE_VALUE = "__sync-version-probe__";
const VERSION_LINE_RE = /^(\s*)"version"\s*:\s*"((?:[^"\\]|\\.)*)"(,?)\s*$/d;

function fail(message) {
  throw new Error(`sync-version: ${message}`);
}

/** Throw unless `version` is a plain `X.Y.Z` string. Returns it unchanged. */
export function assertPlainVersion(version) {
  if (typeof version !== "string" || version === "") fail("<version> is required");
  if (version.includes("-")) fail(`${version} carries a prerelease suffix; versions are plain X.Y.Z`);
  if (version.includes("+")) fail(`${version} carries build metadata; versions are plain X.Y.Z`);
  if (!PLAIN_VERSION_RE.test(version)) fail(`${version} is not a plain X.Y.Z version`);
  return version;
}

function pathLabel(path) {
  let label = "";
  for (const key of path) {
    if (/^[A-Za-z_$][\w$]*$/.test(key)) label += label === "" ? key : `.${key}`;
    else label += `[${JSON.stringify(key)}]`;
  }
  return label;
}

function getPath(value, path) {
  let cursor = value;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor) || !Object.hasOwn(cursor, key)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return cursor;
}

function readText(directory, relativePath) {
  try {
    return readFileSync(resolve(directory, relativePath), "utf8");
  } catch (error) {
    fail(`cannot read ${relativePath} (${error.code ?? error.message})`);
  }
}

function parseJson(raw, file) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${file} is not valid JSON (${error.message})`);
  }
}

/**
 * Every line of `raw` that looks like `"version": "<value>"`, with the
 * offsets of the quoted value. `content` keeps its `\r`, so offsets map
 * straight back into `raw`.
 */
function versionCandidates(raw) {
  const candidates = [];
  let start = 0;
  let number = 1;
  for (let index = 0; index <= raw.length; index += 1) {
    if (index !== raw.length && raw[index] !== "\n") continue;
    if (index === raw.length && start === raw.length) break;
    const content = raw.slice(start, index);
    const text = content.endsWith("\r") ? content.slice(0, -1) : content;
    const match = VERSION_LINE_RE.exec(text);
    if (match !== null) {
      let value;
      try {
        value = JSON.parse(`"${match[2]}"`);
      } catch {
        value = undefined;
      }
      if (typeof value === "string") {
        candidates.push({
          lineNumber: number,
          valueStart: start + match.indices[2][0] - 1,
          valueEnd: start + match.indices[2][1] + 1,
          value,
        });
      }
    }
    start = index + 1;
    number += 1;
  }
  return candidates;
}

/** True when replacing this candidate's literal puts PROBE_VALUE at `path`. */
function isValueAt(raw, candidate, path) {
  const probe = `${raw.slice(0, candidate.valueStart)}"${PROBE_VALUE}"${raw.slice(candidate.valueEnd)}`;
  try {
    return getPath(JSON.parse(probe), path) === PROBE_VALUE;
  } catch {
    return false;
  }
}

/** Locate the one line that holds the version at `path`. */
function locateValueLine(raw, path, file) {
  const parsed = parseJson(raw, file);
  const current = getPath(parsed, path);
  if (typeof current !== "string") fail(`${file} ${pathLabel(path)} is missing or not a string`);
  const matches = versionCandidates(raw).filter(
    (candidate) => candidate.value === current && isValueAt(raw, candidate, path),
  );
  if (matches.length !== 1) {
    fail(`cannot locate ${file} ${pathLabel(path)} (${matches.length} matching line(s))`);
  }
  return matches[0];
}

function splitLinesWithEndings(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** Refuse a computed text whose changes escape the located version lines. */
function assertOnlyVersionLinesChanged(file, before, after, lineNumbers) {
  const beforeLines = splitLinesWithEndings(before);
  const afterLines = splitLinesWithEndings(after);
  if (beforeLines.length !== afterLines.length) {
    fail(`${file} line count changed (${beforeLines.length} -> ${afterLines.length}); refusing to write`);
  }
  const allowed = new Set(lineNumbers);
  const unexpected = [];
  for (let index = 0; index < beforeLines.length; index += 1) {
    if (beforeLines[index] !== afterLines[index] && !allowed.has(index + 1)) unexpected.push(index + 1);
  }
  if (unexpected.length > 0) {
    fail(`${file} changed unexpected line(s) ${unexpected.join(", ")}; refusing to write`);
  }
}

function applyVersionEdits(raw, edits, version) {
  let text = raw;
  for (const edit of [...edits].sort((left, right) => right.valueStart - left.valueStart)) {
    text = `${text.slice(0, edit.valueStart)}${JSON.stringify(version)}${text.slice(edit.valueEnd)}`;
  }
  return text;
}

function assertTargetsHold(text, targets, version, file) {
  const parsed = parseJson(text, `${file} (computed)`);
  for (const target of targets) {
    const value = getPath(parsed, target.path);
    if (value !== version) {
      fail(`${target.label} would be ${JSON.stringify(value)} after writing ${version}; refusing to write`);
    }
  }
}

/** Read the four current values. Throws if a place is missing. */
export function readVersions(repoDir = process.cwd()) {
  const directory = resolve(repoDir);
  const values = {};
  for (const target of TARGETS) {
    const value = getPath(parseJson(readText(directory, target.file), target.file), target.path);
    if (typeof value !== "string") fail(`${target.label} is missing or not a string`);
    values[target.id] = value;
  }
  return values;
}

function readStateIfPresent(repoDir) {
  const file = resolve(repoDir, STATE_FILE);
  if (!existsSync(file)) return undefined;
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    fail(`cannot read ${STATE_FILE} (${error.code ?? error.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${STATE_FILE} is not valid JSON (${error.message})`);
  }
}

/**
 * Write `version` to all four places. Returns
 * `{ version, changedFiles, already }`; `already` is true when nothing was
 * written because every place already held `version`.
 */
export function syncVersion(repoDir, version) {
  const wanted = assertPlainVersion(version);
  const directory = resolve(repoDir);

  const files = new Map();
  for (const target of TARGETS) {
    if (!files.has(target.file)) files.set(target.file, { raw: readText(directory, target.file), targets: [] });
    files.get(target.file).targets.push(target);
  }

  const planned = [];
  for (const [file, entry] of files) {
    const edits = [];
    for (const target of entry.targets) {
      const located = locateValueLine(entry.raw, target.path, file);
      if (located.value !== wanted) edits.push(located);
    }
    if (edits.length === 0) continue;
    const after = applyVersionEdits(entry.raw, edits, wanted);
    assertOnlyVersionLinesChanged(file, entry.raw, after, edits.map((edit) => edit.lineNumber));
    assertTargetsHold(after, entry.targets, wanted, file);
    planned.push({ file, after });
  }

  if (planned.length === 0) return { version: wanted, changedFiles: [], already: true };
  for (const item of planned) writeFileSync(resolve(directory, item.file), item.after, "utf8");
  return { version: wanted, changedFiles: planned.map((item) => item.file), already: false };
}

/**
 * Compare the four places with `version`, or — without a version — with each
 * other and with `release/state.json` when it exists. Never writes.
 *
 * Returns `{ reference, entries, errors, ok }` where each entry is
 * `{ label, file, value, ok }`.
 */
export function verifyVersion(repoDir, version) {
  const directory = resolve(repoDir);
  const values = readVersions(directory);
  const entries = TARGETS.map((target) => ({ label: target.label, file: target.file, value: values[target.id] }));

  let reference;
  let stateEntry = null;
  if (version !== undefined) {
    reference = assertPlainVersion(version);
  } else {
    // The root package is the reference; every other place, including the
    // release state, must agree with it.
    reference = values.root;
    const state = readStateIfPresent(directory);
    if (state !== undefined) {
      if (state === null || typeof state !== "object" || Array.isArray(state) || typeof state.version !== "string") {
        fail(`${STATE_FILE} has no string version`);
      }
      stateEntry = { label: `${STATE_FILE} version`, file: STATE_FILE, value: state.version };
    }
  }

  const all = stateEntry === null ? entries : [...entries, stateEntry];
  const errors = [];
  for (const entry of all) {
    entry.ok = entry.value === reference;
    if (!entry.ok) errors.push(`${entry.label} is ${entry.value} (expected ${reference})`);
  }
  return { reference, entries: all, errors, ok: errors.length === 0 };
}

export function parseArgs(argv) {
  const options = { repo: process.cwd(), version: undefined, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify") {
      options.verify = true;
      continue;
    }
    if (arg === "--repo") {
      const value = argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) fail("--repo requires a value");
      options.repo = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) fail(`unknown argument ${JSON.stringify(arg)}`);
    if (options.version !== undefined) fail(`unexpected argument ${JSON.stringify(arg)}`);
    options.version = arg;
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const repoDir = resolve(options.repo);

  if (options.verify) {
    const result = verifyVersion(repoDir, options.version);
    for (const entry of result.entries) {
      const suffix = entry.ok ? "" : ` (expected ${result.reference})`;
      console.log(`sync-version: ${entry.ok ? "PASS" : "FAIL"} ${entry.label} = ${entry.value}${suffix}`);
    }
    if (!result.ok) {
      console.error(`sync-version: FAILED: ${result.errors.length} place(s) do not match ${result.reference}`);
      process.exitCode = 1;
      return;
    }
    console.log(`sync-version: VERIFIED ${result.reference}`);
    return;
  }

  if (options.version === undefined) fail("<version> is required unless --verify is used");
  const result = syncVersion(repoDir, options.version);
  if (result.already) {
    console.log(`sync-version: already at ${result.version}`);
    return;
  }
  console.log(`sync-version: updated ${result.changedFiles.join(", ")} to ${result.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error.message.startsWith("sync-version:") ? error.message : `sync-version: ${error.message}`;
    console.error(message);
    process.exitCode = 1;
  }
}
