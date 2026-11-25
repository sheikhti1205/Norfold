#!/usr/bin/env node
/**
 * Release-note gate: fail when the version about to be released has no note.
 *
 * Reads apps/mobile/src/services/updates/releaseNotes.ts — resolved from this
 * script's own location, never from the working directory — and looks for a
 * `versionName: "<value>"` entry whose value is exactly the requested version.
 * Matching is exact string equality, so `0.16.0` is not satisfied by
 * `0.16.0-beta.1`.
 *
 * Usage:
 *   node scripts/release/verify-release-note.mjs <version>
 *
 * Exit codes:
 *   0  the version has a written release note
 *   1  no note for the version, or the notes file cannot be read
 *   2  no version argument
 *
 * Pure Node builtins. Test suite: scripts/release/verify-release-note.test.mjs
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXIT_OK = 0;
export const EXIT_MISSING = 1;
export const EXIT_USAGE = 2;

const NOTES_URL = new URL("../../apps/mobile/src/services/updates/releaseNotes.ts", import.meta.url);
const NOTES_DISPLAY = "apps/mobile/src/services/updates/releaseNotes.ts";

const VERSION_NAME_RE = /versionName:\s*"([^"]*)"/g;

/** Every `versionName` string literal in the release-note source, in file order. */
export function versionsInNoteSource(source) {
  const versions = [];
  for (const match of String(source).matchAll(VERSION_NAME_RE)) versions.push(match[1]);
  return versions;
}

/** True when the source has a note for exactly `version` (no prefix matching). */
export function hasReleaseNote(source, version) {
  if (typeof version !== "string" || version === "") return false;
  return versionsInNoteSource(source).includes(version);
}

/**
 * Run the checker without exiting the process. `readNotes` defaults to reading
 * the repository file; tests inject a reader. Returns the exit code.
 */
export function evaluate(version, readNotes = () => readFileSync(NOTES_URL, "utf8"), io = { out: console.log, err: console.error }) {
  const { out, err } = io;
  const requested = typeof version === "string" ? version.trim() : "";

  if (!requested) {
    err("verify-release-note: FAIL a version is required — usage: node scripts/release/verify-release-note.mjs <version>");
    return EXIT_USAGE;
  }

  let source;
  try {
    source = readNotes();
  } catch (error) {
    err(`verify-release-note: FAIL cannot read ${NOTES_DISPLAY} (${error.message})`);
    return EXIT_MISSING;
  }

  if (!hasReleaseNote(source, requested)) {
    err(
      `verify-release-note: FAIL no release note for ${requested} in ${NOTES_DISPLAY} — add a RELEASE_NOTES entry for this exact version before releasing`,
    );
    return EXIT_MISSING;
  }

  out(`verify-release-note: PASS ${requested} has a written release note`);
  return EXIT_OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(evaluate(process.argv[2]));
}
