#!/usr/bin/env node
/**
 * TDD tests for scripts/check-edge-parity.mjs (SYNC-13/14/15).
 *
 * Run: `node --test scripts/check-edge-parity.test.mjs` from the repo root.
 * Hermetic: fixtures only, injected readers/manifests, no network, no disk
 * (except the module under test). Never prints secret material (hashes here
 * are of public fixture strings, not credentials).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDGE_FUNCTIONS,
  sha256Hex,
  computeLocalHashes,
  computeLocalFileHashes,
  parseManifest,
  checkParity,
  summarize,
  formatParityReport,
} from "./check-edge-parity.mjs";

const FIXTURE_SOURCE = {
  "chat-media": "chat-media source v1",
  "chat-wake": "chat-wake source v1",
  "cleanup-chat-media": "cleanup-chat-media source v1",
  "cleanup-comment-media": "cleanup-comment-media source v1",
  "cleanup-report-media": "cleanup-report-media source v1",
  "copy-chat-evidence": "copy-chat-evidence source v1",
  "delete-account": "delete-account source v1",
  "device-enroll": "device-enroll source v1",
  "push-dispatch": "push-dispatch source v1",
  "reply-comment": "reply-comment source v1",
  "trust-maintenance": "trust-maintenance source v1",
};

// Per-file fixtures: function-local files plus the shared modules that the
// legacy index-only manifest could not see.
const FIXTURE_FILES = {
  "copy-chat-evidence/index.ts": "copy-chat-evidence/index.ts v1",
  "copy-chat-evidence/handler.ts": "copy-chat-evidence/handler.ts v1",
  "_shared/chatEvidenceCopy.ts": "_shared/chatEvidenceCopy.ts v1",
  "_shared/cors.js": "_shared/cors.js v1",
};

const fixtureReader = (name) => {
  if (!(name in FIXTURE_SOURCE)) throw new Error(`no fixture: ${name}`);
  return FIXTURE_SOURCE[name];
};

const fixtureFileReader = (path) => {
  if (!(path in FIXTURE_FILES)) throw new Error(`no fixture: ${path}`);
  return FIXTURE_FILES[path];
};

const manifestFor = (overrides = {}) =>
  EDGE_FUNCTIONS.map((name) => ({
    name,
    sha256: overrides[name] ?? sha256Hex(FIXTURE_SOURCE[name]),
    version: "1",
    verify_jwt: true,
  }));

const fileManifestFor = (name, paths, overrides = {}) => ({
  name,
  files: paths.map((path) => ({
    path,
    sha256: overrides[path] ?? sha256Hex(FIXTURE_FILES[path]),
  })),
  version: "2",
  verify_jwt: false,
});

describe("check-edge-parity fixtures", () => {
  it("covers every deployed edge function", () => {
    assert.deepEqual([...EDGE_FUNCTIONS].sort(), [
      "chat-media",
      "chat-wake",
      "cleanup-chat-media",
      "cleanup-comment-media",
      "cleanup-report-media",
      "copy-chat-evidence",
      "delete-account",
      "device-enroll",
      "push-dispatch",
      "reply-comment",
      "trust-maintenance",
    ]);
  });

  it("lists exactly the function directories on disk, so a new function cannot be silently omitted", () => {
    // The original bug: the checker covered 6 of 11 deployed functions, so
    // drift in the other 5 could never fail CI. This test fails when a
    // directory exists that the list does not cover.
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions");
    const onDisk = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual([...EDGE_FUNCTIONS].sort(), onDisk);
  });

  it("accepts matching hashes as CURRENT (exit 0)", () => {
    const localHashes = computeLocalHashes(fixtureReader);
    const results = checkParity({ localHashes, manifestEntries: manifestFor() });
    assert.ok(results.every((row) => row.status === "CURRENT"));
    assert.equal(summarize(results).exitCode, 0);
  });

  it("detects stale deployments when a sha256 differs (exit 1)", () => {
    const localHashes = computeLocalHashes(fixtureReader);
    const manifest = manifestFor({ "push-dispatch": "0".repeat(64) });
    const results = checkParity({ localHashes, manifestEntries: manifest });
    const row = results.find((r) => r.name === "push-dispatch");
    assert.equal(row.status, "STALE");
    assert.equal(row.local, sha256Hex(FIXTURE_SOURCE["push-dispatch"]));
    assert.equal(row.deployed, "0".repeat(64));
    assert.ok(results.filter((r) => r.name !== "push-dispatch").every((r) => r.status === "CURRENT"));
    const summary = summarize(results);
    assert.equal(summary.STALE, 1);
    assert.equal(summary.exitCode, 1);
  });

  it("flags missing manifest entries as MISSING (exit 1)", () => {
    const localHashes = computeLocalHashes(fixtureReader);
    const manifest = manifestFor().filter((entry) => entry.name !== "delete-account");
    const results = checkParity({ localHashes, manifestEntries: manifest });
    assert.equal(results.find((r) => r.name === "delete-account").status, "MISSING");
    assert.equal(summarize(results).exitCode, 1);
  });

  it("flags unreadable repo sources as MISSING without throwing", () => {
    const localHashes = computeLocalHashes(() => {
      throw new Error("ENOENT");
    });
    const results = checkParity({ localHashes, manifestEntries: manifestFor() });
    assert.ok(results.every((row) => row.status === "MISSING"));
    assert.equal(summarize(results).exitCode, 1);
  });

  it("rejects malformed manifests fail-closed", () => {
    assert.throws(() => parseManifest("not json"), /not valid JSON/);
    assert.throws(() => parseManifest(JSON.stringify({ nope: true })), /array or \{ functions/);
    assert.throws(
      () => parseManifest(JSON.stringify([{ name: "ai-help", sha256: "xyz" }])),
      /invalid sha256/,
    );
    assert.throws(
      () => parseManifest(JSON.stringify([{ sha256: "a".repeat(64) }])),
      /no name/,
    );
  });

  it("accepts { functions: [...] } manifest envelopes", () => {
    const entries = parseManifest(JSON.stringify({ functions: manifestFor() }));
    assert.equal(entries.length, EDGE_FUNCTIONS.length);
  });

  it("normalises CRLF so a Windows checkout does not report false STALE", () => {
    assert.equal(sha256Hex("a\r\nb\r\n"), sha256Hex("a\nb\n"));
    assert.notEqual(sha256Hex("a\r\nb\r\n"), sha256Hex("a\nb"));
  });

  it("report lists every function by name with counts, never secret values", () => {
    const localHashes = computeLocalHashes(fixtureReader);
    const results = checkParity({ localHashes, manifestEntries: manifestFor() });
    const report = formatParityReport(results);
    for (const name of EDGE_FUNCTIONS) assert.ok(report.includes(name), `missing ${name}`);
    assert.match(report, /11 CURRENT, 0 STALE, 0 MISSING/);
  });
});

describe("check-edge-parity per-file manifests", () => {
  const paths = Object.keys(FIXTURE_FILES);

  it("is CURRENT only when every file, including _shared, matches", () => {
    const entries = [fileManifestFor("copy-chat-evidence", paths)];
    const localFiles = computeLocalFileHashes(fixtureFileReader, entries);
    const results = checkParity({ localHashes: {}, localFiles, manifestEntries: entries });
    const row = results.find((r) => r.name === "copy-chat-evidence");
    assert.equal(row.status, "CURRENT");
    assert.match(row.detail, /4 files match/);
  });

  it("is STALE and names the file when a _shared module differs", () => {
    const entries = [
      fileManifestFor("copy-chat-evidence", paths, {
        "_shared/chatEvidenceCopy.ts": "0".repeat(64),
      }),
    ];
    const localFiles = computeLocalFileHashes(fixtureFileReader, entries);
    const results = checkParity({ localHashes: {}, localFiles, manifestEntries: entries });
    const row = results.find((r) => r.name === "copy-chat-evidence");
    assert.equal(row.status, "STALE");
    assert.match(row.detail, /_shared\/chatEvidenceCopy\.ts/);
    assert.equal(summarize(results).exitCode, 1);
  });

  it("is STALE when a repo file listed in the manifest is unreadable", () => {
    const entries = [fileManifestFor("copy-chat-evidence", paths)];
    const localFiles = computeLocalFileHashes((path) => {
      if (path === "_shared/cors.js") throw new Error("ENOENT");
      return fixtureFileReader(path);
    }, entries);
    const results = checkParity({ localHashes: {}, localFiles, manifestEntries: entries });
    const row = results.find((r) => r.name === "copy-chat-evidence");
    assert.equal(row.status, "STALE");
    assert.match(row.detail, /_shared\/cors\.js \(repo unreadable\)/);
  });

  it("is MISSING when no local file hashes were computed for the function", () => {
    const entries = [fileManifestFor("copy-chat-evidence", paths)];
    const results = checkParity({ localHashes: {}, localFiles: {}, manifestEntries: entries });
    assert.equal(results.find((r) => r.name === "copy-chat-evidence").status, "MISSING");
  });

  it("rejects unsafe paths and bad file hashes fail-closed", () => {
    const base = { name: "copy-chat-evidence", version: "2", verify_jwt: false };
    assert.throws(
      () => parseManifest(JSON.stringify([{ ...base, files: [] }])),
      /invalid files/,
    );
    assert.throws(
      () => parseManifest(JSON.stringify([{ ...base, files: [{ path: "../escape.ts", sha256: "a".repeat(64) }] }])),
      /unsafe path/,
    );
    assert.throws(
      () => parseManifest(JSON.stringify([{ ...base, files: [{ path: "index.ts", sha256: "xyz" }] }])),
      /invalid sha256/,
    );
  });

  it("mixed manifests compare per-file where declared and index-only otherwise", () => {
    const entries = [
      fileManifestFor("copy-chat-evidence", paths),
      ...manifestFor().filter((entry) => entry.name !== "copy-chat-evidence"),
    ];
    const localHashes = computeLocalHashes(fixtureReader);
    const localFiles = computeLocalFileHashes(fixtureFileReader, entries);
    const results = checkParity({ localHashes, localFiles, manifestEntries: entries });
    assert.ok(results.every((row) => row.status === "CURRENT"));
    assert.equal(summarize(results).exitCode, 0);
  });
});
