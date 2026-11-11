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
import { readdirSync, readFileSync } from "node:fs";
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
  collectRelativeImports,
  resolveRelativeImport,
  findUndeclaredImports,
  DEFAULT_EXPECTATIONS_PATH,
  parseExpectations,
  checkJwtContract,
  summarizeJwtContract,
  formatJwtReport,
  evaluateJwtContract,
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
  "telegram-auth-webhook": "telegram-auth-webhook source v1",
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
      "telegram-auth-webhook",
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
    assert.match(report, /12 CURRENT, 0 STALE, 0 MISSING/);
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

describe("check-edge-parity manifest integrity", () => {
  const base = { name: "copy-chat-evidence", version: "2", verify_jwt: false };

  it("rejects a duplicate function entry in either mode", () => {
    const legacyDup = [manifestFor()[0], manifestFor()[0]];
    assert.throws(() => parseManifest(JSON.stringify(legacyDup)), /duplicate manifest entry/);
    const fileEntry = fileManifestFor("copy-chat-evidence", Object.keys(FIXTURE_FILES));
    assert.throws(
      () => parseManifest(JSON.stringify([fileEntry, fileEntry]), { strict: true }),
      /duplicate manifest entry/,
    );
  });

  it("rejects the same file listed twice in one entry", () => {
    const file = { path: "copy-chat-evidence/index.ts", sha256: "a".repeat(64) };
    assert.throws(
      () => parseManifest(JSON.stringify([{ ...base, files: [file, file] }])),
      /lists "copy-chat-evidence\/index\.ts" more than once/,
    );
  });

  it("strict mode rejects the legacy index-only shape", () => {
    assert.doesNotThrow(() => parseManifest(JSON.stringify(manifestFor())));
    assert.throws(
      () => parseManifest(JSON.stringify(manifestFor()), { strict: true }),
      /must use "files"/,
    );
  });

  it("strict mode rejects an entry with no entrypoint", () => {
    const files = [{ path: "_shared/cors.js", sha256: "a".repeat(64) }];
    assert.throws(
      () => parseManifest(JSON.stringify([{ ...base, files }]), { strict: true }),
      /missing its entrypoint copy-chat-evidence\/index\.ts/,
    );
    // Default mode still accepts it: the hash comparison reports what it can.
    assert.doesNotThrow(() => parseManifest(JSON.stringify([{ ...base, files }])));
  });
});

describe("check-edge-parity import closure", () => {
  it("collects relative specifiers and ignores external ones", () => {
    const source = [
      'import { a } from "./handler.ts";',
      'export { b } from "../_shared/cors.js";',
      'import "npm:@supabase/server@1.6.0";',
      'import { c } from "https://deno.land/std/mod.ts";',
      'import { d } from "node:assert";',
    ].join("\n");
    assert.deepEqual(collectRelativeImports(source).sort(), ["./handler.ts", "../_shared/cors.js"].sort());
  });

  it("resolves against the importing file, including imports inside _shared", () => {
    assert.equal(resolveRelativeImport("chat-media/handler.ts", "../_shared/cors.js"), "_shared/cors.js");
    assert.equal(resolveRelativeImport("chat-media/index.ts", "./handler.ts"), "chat-media/handler.ts");
    // The bug this guards: a `./` import inside _shared must stay in _shared.
    assert.equal(resolveRelativeImport("_shared/deviceEnrollment.ts", "./deviceProof.ts"), "_shared/deviceProof.ts");
    assert.equal(resolveRelativeImport("_shared/a/b.ts", "../c.ts"), "_shared/c.ts");
  });

  it("flags a shared module the manifest omits", () => {
    const files = {
      "copy-chat-evidence/index.ts": 'export * from "./handler.ts";',
      "copy-chat-evidence/handler.ts": 'import { copy } from "../_shared/chatEvidenceCopy.ts";',
      "_shared/chatEvidenceCopy.ts": 'import { reject } from "./emptyPost.ts";',
      "_shared/emptyPost.ts": "export const reject = 1;",
    };
    const entries = [{
      name: "copy-chat-evidence",
      files: [
        { path: "copy-chat-evidence/index.ts", sha256: "a".repeat(64) },
        { path: "copy-chat-evidence/handler.ts", sha256: "a".repeat(64) },
        { path: "_shared/chatEvidenceCopy.ts", sha256: "a".repeat(64) },
      ],
    }];
    const problems = findUndeclaredImports(entries, (path) => files[path]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, "copy-chat-evidence");
    assert.deepEqual(problems[0].missing, ["_shared/emptyPost.ts"]);
  });

  it("reports nothing when the closure is fully declared", () => {
    const files = {
      "copy-chat-evidence/index.ts": 'export * from "./handler.ts";',
      "copy-chat-evidence/handler.ts": 'import { copy } from "../_shared/chatEvidenceCopy.ts";',
      "_shared/chatEvidenceCopy.ts": 'import { reject } from "./emptyPost.ts";',
      "_shared/emptyPost.ts": "export const reject = 1;",
    };
    const entries = [{
      name: "copy-chat-evidence",
      files: Object.keys(files).map((path) => ({ path, sha256: "a".repeat(64) })),
    }];
    assert.deepEqual(findUndeclaredImports(entries, (path) => files[path]), []);
  });

  it("the real live manifest would satisfy strict closure for every function", () => {
    // Guards the contract that made this mode worth adding: the repo's actual
    // import graph must be fully declarable, so strict mode cannot false-fail.
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const diskRead = (path) => readFileSync(resolve(repoRoot, "supabase", "functions", path), "utf8");
    const entries = EDGE_FUNCTIONS.map((name) => {
      const declared = new Set([`${name}/index.ts`]);
      const queue = [`${name}/index.ts`];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const specifier of collectRelativeImports(diskRead(current))) {
          const resolved = resolveRelativeImport(current, specifier);
          if (!declared.has(resolved)) {
            declared.add(resolved);
            queue.push(resolved);
          }
        }
      }
      return { name, files: [...declared].map((path) => ({ path, sha256: sha256Hex(diskRead(path)) })) };
    });
    assert.deepEqual(findUndeclaredImports(entries, diskRead), []);
  });
});

describe("check-edge-parity verify_jwt contract", () => {
  const EVIDENCE = [{ class: "deploy", source: "fixture", detail: "fixture evidence" }];

  /** Deployed results from a fixture manifest; omit a name to model a manifest that does not state verify_jwt. */
  const deployedResults = (verifyJwtFor = {}) => {
    const localHashes = computeLocalHashes(fixtureReader);
    const manifestEntries = EDGE_FUNCTIONS.map((name) => ({
      name,
      sha256: sha256Hex(FIXTURE_SOURCE[name]),
      version: "1",
      ...(name in verifyJwtFor ? { verify_jwt: verifyJwtFor[name] } : { verify_jwt: false }),
    }));
    return checkParity({ localHashes, manifestEntries });
  };

  /** Expectations manifest; `unknownFor` names are recorded as deliberately unresolved. */
  const expectationsFor = (verifyJwtFor = {}, unknownFor = []) => {
    const functions = {};
    for (const name of EDGE_FUNCTIONS) {
      if (unknownFor.includes(name)) {
        functions[name] = { verifyJwt: "unknown", status: "UNKNOWN", evidence: EVIDENCE };
      } else {
        functions[name] = {
          verifyJwt: name in verifyJwtFor ? verifyJwtFor[name] : false,
          status: "DERIVED",
          evidence: EVIDENCE,
        };
      }
    }
    return parseExpectations(JSON.stringify({ functions }));
  };

  it("matches when every deployed verify_jwt equals its expectation", () => {
    const rows = checkJwtContract(deployedResults(), expectationsFor());
    assert.ok(rows.every((row) => row.verdict === "MATCH"), JSON.stringify(rows.filter((r) => r.verdict !== "MATCH")));
    assert.equal(summarizeJwtContract(rows).exitCode, 0);
    assert.match(formatJwtReport(rows), /12 MATCH, 0 MISMATCH, 0 UNKNOWN/);
  });

  it("fails on a mismatch and names the function, expected and deployed value", () => {
    const rows = checkJwtContract(deployedResults(), expectationsFor({ "delete-account": true }));
    const row = rows.find((r) => r.name === "delete-account");
    assert.equal(row.verdict, "MISMATCH");
    assert.equal(row.expected, true);
    assert.equal(row.deployed, false);
    const summary = summarizeJwtContract(rows);
    assert.equal(summary.MISMATCH, 1);
    assert.equal(summary.exitCode, 1);
    const report = formatJwtReport(rows);
    assert.match(report, /delete-account \| true \| false \| MISMATCH \| deployed verify_jwt=false, expected true/);
    assert.ok(rows.filter((r) => r.name !== "delete-account").every((r) => r.verdict === "MATCH"));
  });

  it("fails when a deployed true disagrees with a false expectation", () => {
    const rows = checkJwtContract(deployedResults({ "chat-media": true }), expectationsFor({ "chat-media": false }));
    const row = rows.find((r) => r.name === "chat-media");
    assert.equal(row.verdict, "MISMATCH");
    assert.equal(row.expected, false);
    assert.equal(row.deployed, true);
    assert.match(formatJwtReport(rows), /chat-media \| false \| true \| MISMATCH/);
    assert.equal(summarizeJwtContract(rows).exitCode, 1);
  });

  it("reports an unresolved expectation as UNKNOWN, never a pass", () => {
    const rows = checkJwtContract(deployedResults(), expectationsFor({}, ["reply-comment"]));
    const row = rows.find((r) => r.name === "reply-comment");
    assert.equal(row.verdict, "UNKNOWN");
    assert.match(row.reason, /unresolved/);
    assert.equal(summarizeJwtContract(rows).UNKNOWN, 1);
    assert.equal(summarizeJwtContract(rows).exitCode, 1);
  });

  it("reports a missing expectation as UNKNOWN", () => {
    const expectations = expectationsFor();
    delete expectations["trust-maintenance"];
    const rows = checkJwtContract(deployedResults(), expectations);
    const row = rows.find((r) => r.name === "trust-maintenance");
    assert.equal(row.verdict, "UNKNOWN");
    assert.match(row.reason, /no expectation recorded/);
    assert.equal(summarizeJwtContract(rows).exitCode, 1);
  });

  it("reports a deployed manifest that does not state verify_jwt as UNKNOWN", () => {
    const localHashes = computeLocalHashes(fixtureReader);
    const manifestEntries = EDGE_FUNCTIONS.map((name) => ({
      name,
      sha256: sha256Hex(FIXTURE_SOURCE[name]),
      version: "1",
    }));
    const results = checkParity({ localHashes, manifestEntries });
    const rows = checkJwtContract(results, expectationsFor());
    assert.ok(rows.every((row) => row.verdict === "UNKNOWN"));
    assert.match(rows[0].reason, /does not state verify_jwt/);
    assert.equal(summarizeJwtContract(rows).exitCode, 1);
  });

  it("does not evaluate the contract in default (non-strict) mode", () => {
    const results = deployedResults({ "delete-account": false });
    assert.equal(evaluateJwtContract({ strict: false, results, expectations: expectationsFor() }), null);
    // Non-strict parity still reports what it always did: the deployed value, no verdict.
    assert.equal(summarize(results).exitCode, 0);
    assert.doesNotMatch(formatParityReport(results), /verify_jwt/);
    const strict = evaluateJwtContract({ strict: true, results, expectations: expectationsFor({ "delete-account": true }) });
    assert.equal(strict.summary.MISMATCH, 1);
    assert.equal(strict.summary.exitCode, 1);
  });

  it("rejects malformed expectations fail-closed", () => {
    const ok = (entry) => JSON.stringify({ functions: { "chat-media": entry } });
    const evidence = [{ class: "caller", source: "fixture", detail: "fixture" }];
    assert.throws(() => parseExpectations("not json"), /not valid JSON/);
    assert.throws(() => parseExpectations(JSON.stringify({ nope: true })), /"functions" map/);
    assert.throws(() => parseExpectations(JSON.stringify({ functions: {} })), /no functions/);
    assert.throws(() => parseExpectations(ok({ verifyJwt: false, status: "GUESSED", evidence })), /invalid status/);
    assert.throws(() => parseExpectations(ok({ verifyJwt: "unknown", status: "DERIVED", evidence })), /must set a boolean verifyJwt/);
    assert.throws(() => parseExpectations(ok({ verifyJwt: true, status: "UNKNOWN", evidence })), /must set verifyJwt to "unknown"/);
    assert.throws(() => parseExpectations(ok({ verifyJwt: false, status: "DERIVED", evidence: [] })), /records no evidence/);
    assert.throws(
      () => parseExpectations(ok({ verifyJwt: false, status: "DERIVED", evidence: [{ class: "vibes", source: "x", detail: "y" }] })),
      /unknown class "vibes"/,
    );
    assert.throws(
      () => parseExpectations(ok({ verifyJwt: false, status: "DERIVED", evidence: [{ class: "caller", source: "x" }] })),
      /has no detail/,
    );
  });

  it("the shipped expectations manifest covers every edge function with cited evidence", () => {
    const manifest = parseExpectations(readFileSync(DEFAULT_EXPECTATIONS_PATH, "utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), [...EDGE_FUNCTIONS].sort());
    for (const name of EDGE_FUNCTIONS) {
      const entry = manifest[name];
      assert.ok(entry.evidence.length > 0, `${name} has no evidence`);
      // Every recorded expectation must be a decided boolean, not a placeholder.
      assert.equal(typeof entry.verifyJwt, "boolean", `${name} is not DERIVED`);
      assert.equal(entry.status, "DERIVED");
      assert.ok(
        entry.evidence.some((item) => item.class === "source-auth" || item.class === "caller"),
        `${name} cites no source-auth or caller evidence`,
      );
    }
  });
});
