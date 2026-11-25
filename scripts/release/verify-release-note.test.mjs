#!/usr/bin/env node
/**
 * Tests for scripts/release/verify-release-note.mjs (matching core only).
 *
 * The notes file is read as text, never imported, so these tests do not load
 * TypeScript or depend on the build.
 *
 * Run: `node --test scripts/release/verify-release-note.test.mjs` from repo root.
 * Pure Node builtins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluate, hasReleaseNote, versionsInNoteSource } from "./verify-release-note.mjs";

function recorder() {
  const out = [];
  const err = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

test("a source containing the version passes", () => {
  assert.equal(hasReleaseNote('{ versionName: "0.16.0" }', "0.16.0"), true);
});

test("a prerelease does not satisfy its plain version", () => {
  const source = '{ versionName: "0.16.0-beta.1" }';
  assert.equal(hasReleaseNote(source, "0.16.0"), false);
  assert.equal(hasReleaseNote(source, "0.16.0-beta.1"), true);
});

test("several entries are each found", () => {
  const source = `
    { versionName: "0.16.0-beta.3" },
    { versionName: "0.16.0-beta.2" },
    { versionName: "0.15.0-beta.1" },
  `;
  assert.deepEqual(versionsInNoteSource(source), ["0.16.0-beta.3", "0.16.0-beta.2", "0.15.0-beta.1"]);
  for (const version of ["0.16.0-beta.3", "0.16.0-beta.2", "0.15.0-beta.1"]) {
    assert.equal(hasReleaseNote(source, version), true, version);
  }
  assert.equal(hasReleaseNote(source, "0.16.0"), false);
});

test("an empty source has no note", () => {
  assert.equal(hasReleaseNote("", "0.16.0"), false);
  assert.deepEqual(versionsInNoteSource(""), []);
});

test("a version argument is required", () => {
  const { io, err } = recorder();
  assert.equal(evaluate(undefined, () => "", io), 2);
  assert.equal(evaluate("   ", () => "", io), 2);
  assert.match(err[0], /version is required/);
});

test("an unreadable notes file fails instead of passing", () => {
  const { io, err } = recorder();
  const code = evaluate("0.16.0", () => {
    throw new Error("ENOENT: no such file");
  }, io);
  assert.equal(code, 1);
  assert.match(err[0], /releaseNotes\.ts/);
  assert.match(err[0], /ENOENT/);
});

test("a missing version prints the file and the version", () => {
  const { io, err } = recorder();
  assert.equal(evaluate("0.16.0", () => '{ versionName: "0.16.0-beta.1" }', io), 1);
  assert.match(err[0], /no release note for 0\.16\.0\b/);
  assert.match(err[0], /releaseNotes\.ts/);
});

test("the real notes file has a note for 0.16.0-beta.3", () => {
  const source = readFileSync(
    new URL("../../apps/mobile/src/services/updates/releaseNotes.ts", import.meta.url),
    "utf8",
  );
  assert.equal(hasReleaseNote(source, "0.16.0-beta.3"), true);
});
