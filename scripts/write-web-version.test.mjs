import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_WEB_DIST,
  buildWebVersion,
  shortCommit,
  verifyWebVersionFile,
  writeWebVersion,
} from "./write-web-version.mjs";

// Identity of the commit this manifest exists to expose (public build metadata,
// not key material).
const COMMIT = "c7724e541efdb6e60f4fcd199c311da53a09c04b";
const SHORT = "c7724e541efd";
const RELEASE = `findback-mobile@0.15.0-beta.1+${SHORT}`;
const BUILT_AT = "2026-11-10T09:30:00.000Z";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "norfold-web-version-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("manifest carries commit, release, dist tag and UTC build time", () => {
  const document = buildWebVersion({ commit: COMMIT, release: RELEASE, builtAt: BUILT_AT });
  assert.deepEqual(document, {
    schemaVersion: 1,
    commit: COMMIT,
    shortCommit: SHORT,
    release: RELEASE,
    dist: "web-production",
    builtAt: BUILT_AT,
  });
  assert.equal(DEFAULT_WEB_DIST, "web-production");
  assert.equal(document.builtAt.endsWith("Z"), true);
});

test("the short commit is the 12-char prefix, lowercased", () => {
  assert.equal(shortCommit(COMMIT), SHORT);
  assert.equal(shortCommit(COMMIT.toUpperCase()), SHORT);
  const document = buildWebVersion({ commit: COMMIT.toUpperCase(), release: RELEASE, builtAt: BUILT_AT });
  assert.equal(document.commit, COMMIT);
  assert.equal(document.shortCommit, SHORT);
  // A release whose sha is uppercase still describes the same commit.
  const upperShaRelease = "findback-mobile@0.15.0-beta.1+C7724E541EFD";
  assert.equal(
    buildWebVersion({ commit: COMMIT, release: upperShaRelease, builtAt: BUILT_AT }).release,
    upperShaRelease,
  );
});

test("a missing, empty or truncated commit is rejected", () => {
  assert.throws(() => buildWebVersion({ commit: undefined, release: RELEASE }), /commit is empty/);
  assert.throws(() => buildWebVersion({ commit: "", release: RELEASE }), /commit is empty/);
  assert.throws(() => buildWebVersion({ commit: "   ", release: RELEASE }), /commit is empty/);
  assert.throws(() => buildWebVersion({ commit: SHORT, release: RELEASE }), /not a full 40-hex SHA/);
  assert.throws(() => buildWebVersion({ commit: "z".repeat(40), release: RELEASE }), /not a full 40-hex SHA/);
  assert.throws(() => buildWebVersion({ commit: `${COMMIT}0`, release: RELEASE }), /not a full 40-hex SHA/);
});

test("a release that does not describe the commit is rejected", () => {
  const otherSha = "aaaaaaaabbbbccccddddeeeeffff000011112222";
  assert.throws(
    () => buildWebVersion({ commit: otherSha, release: RELEASE }),
    /does not describe commit/,
  );
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: "" }), /release is empty/);
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: "findback-mobile@0.15.0-beta.1" }), /12-char sha/);
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: `0.15.0-beta.1+${SHORT}` }), /12-char sha/);
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: `findback-mobile@0.15.0-beta.1+${SHORT}0` }), /12-char sha/);
});

test("the dist tag and build time are validated", () => {
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: RELEASE, dist: "" }), /dist is empty/);
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: RELEASE, dist: "Web Production" }), /plain lowercase tag/);
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: RELEASE, builtAt: "not-a-date" }), /not a timestamp/);
  assert.throws(() => buildWebVersion({ commit: COMMIT, release: RELEASE, builtAt: "" }), /builtAt is empty/);
  // An offset timestamp is normalised to UTC so consumers read one format.
  assert.equal(
    buildWebVersion({ commit: COMMIT, release: RELEASE, builtAt: "2026-11-10T11:30:00+02:00" }).builtAt,
    BUILT_AT,
  );
});

test("the written file round-trips through JSON and verifies", () => withTempDir((dir) => {
  const out = join(dir, "version.json");
  const written = writeWebVersion({ out, commit: COMMIT, release: RELEASE, builtAt: BUILT_AT });
  const raw = readFileSync(out, "utf8");
  assert.equal(raw.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(raw), written);
  assert.deepEqual(verifyWebVersionFile({ file: out, release: RELEASE }), written);
}));

test("verification fails closed on a wrong release, a missing file or bad JSON", () => withTempDir((dir) => {
  const out = join(dir, "version.json");
  const corrupt = join(dir, "corrupt.json");
  const missing = join(dir, "absent.json");
  writeWebVersion({ out, commit: COMMIT, release: RELEASE, builtAt: BUILT_AT });
  writeFileSync(corrupt, "{ not json");

  assert.throws(
    () => verifyWebVersionFile({ file: out, release: `findback-mobile@0.15.0-beta.1+000000000000` }),
    /does not equal computed SENTRY_RELEASE/,
  );
  assert.throws(() => verifyWebVersionFile({ file: missing, release: RELEASE }), /manifest missing/);
  assert.throws(() => verifyWebVersionFile({ file: corrupt, release: RELEASE }), /not valid JSON/);
  assert.throws(() => verifyWebVersionFile({ release: RELEASE }), /--verify is required/);
}));

test("verification rejects a tampered manifest body", () => withTempDir((dir) => {
  const out = join(dir, "version.json");
  const written = writeWebVersion({ out, commit: COMMIT, release: RELEASE, builtAt: BUILT_AT });

  const cases = [
    [{ ...written, dist: "web-staging" }, /manifest dist/],
    [{ ...written, commit: "abc" }, /commit is not a full 40-hex SHA/],
    [{ ...written, shortCommit: "000000000000" }, /shortCommit is not/],
    [{ ...written, builtAt: "2026-11-10T09:30:00.000+00:00" }, /not a UTC timestamp/],
    [{ ...written, builtAt: 1712345678 }, /not a UTC timestamp/],
    [["not", "an", "object"], /not a JSON object/],
  ];
  for (const [body, pattern] of cases) {
    writeFileSync(out, JSON.stringify(body));
    assert.throws(() => verifyWebVersionFile({ file: out, release: RELEASE }), pattern);
  }
}));
