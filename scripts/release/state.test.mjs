#!/usr/bin/env node
/**
 * Tests for scripts/release/state.mjs.
 *
 * Run: `node --test scripts/release/state.test.mjs` from repo root.
 * Pure Node builtins. Commit existence is injected so no git is required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_VERSION_CODE,
  SCHEMA_VERSION,
  claimVersionCode,
  loadState,
  serializeState,
  validateState,
  writeState,
} from "./state.mjs";

const COMMIT = "a".repeat(40);
const RELEASE_COMMIT = "f2fdbe70fb8306dab6596e8d9ac525b1af00fa05";

const VALID_RELEASE = {
  tag: "v0.15.0-beta.1",
  version: "0.15.0-beta.1",
  versionCode: 101077,
  commit: RELEASE_COMMIT,
  publishedAt: "2026-11-08T17:18:01Z",
};

// A pending release records only what exists before the bump is committed.
const VALID_PENDING = {
  tag: "v0.16.0",
  version: "0.16.0",
  versionCode: 101078,
};

function fixture(overrides = {}) {
  return {
    schemaVersion: 1,
    channel: "beta",
    version: "0.16.0-beta.3",
    versionCode: 101077,
    classificationBase: COMMIT,
    pendingRelease: null,
    lastRelease: null,
    ...overrides,
  };
}

const commitExists = () => true;
const commitMissing = () => false;

function tempRepo() {
  return mkdtempSync(join(tmpdir(), "norfold-release-state-"));
}

test("exports the schema constants", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(MAX_VERSION_CODE, 2_100_000_000);
});

test("round-trips byte-identically through write and load", () => {
  const repoDir = tempRepo();
  try {
    const state = fixture();
    const file = writeState(repoDir, state, { commitExists });
    const first = readFileSync(file);
    const loaded = loadState(repoDir, { commitExists });
    assert.deepEqual(loaded, state);
    writeState(repoDir, loaded, { commitExists });
    assert.deepEqual(readFileSync(file), first);
    const text = first.toString("utf8");
    assert.ok(text.endsWith("}\n"), "ends with a single newline");
    assert.ok(!text.endsWith("\n\n"), "no extra trailing newline");
    assert.ok(!text.includes("\r"), "LF only");
    assert.equal(text, serializeState(state));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("lastRelease null is accepted and round-trips byte-identically", () => {
  const repoDir = tempRepo();
  try {
    const state = fixture({ lastRelease: null });
    const file = writeState(repoDir, state, { commitExists });
    const first = readFileSync(file);
    assert.match(first.toString("utf8"), /"lastRelease": null/);
    const loaded = loadState(repoDir, { commitExists });
    assert.equal(loaded.lastRelease, null);
    writeState(repoDir, loaded, { commitExists });
    assert.deepEqual(readFileSync(file), first);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("lastRelease accepts a well-formed release object", () => {
  const state = fixture({ lastRelease: { ...VALID_RELEASE } });
  assert.doesNotThrow(() => validateState(state, { repoDir: ".", commitExists }));
});

test("pendingRelease round-trips byte-identically without commit or publishedAt", () => {
  const repoDir = tempRepo();
  try {
    const state = fixture({ pendingRelease: { ...VALID_PENDING } });
    const file = writeState(repoDir, state, { commitExists });
    const first = readFileSync(file);
    const text = first.toString("utf8");
    assert.match(text, /"pendingRelease": \{/);
    assert.ok(!text.includes("\"commit\""), "a pending release carries no commit");
    assert.ok(!text.includes("\"publishedAt\""), "a pending release carries no publishedAt");
    writeState(repoDir, loadState(repoDir, { commitExists }), { commitExists });
    assert.deepEqual(readFileSync(file), first);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("pendingRelease accepts commit null", () => {
  assert.doesNotThrow(() =>
    validateState(fixture({ pendingRelease: { ...VALID_PENDING, commit: null } }), { repoDir: ".", commitExists }),
  );
});

test("pendingRelease accepts a 40-character hex commit", () => {
  assert.doesNotThrow(() =>
    validateState(
      fixture({ pendingRelease: { ...VALID_PENDING, commit: RELEASE_COMMIT } }),
      { repoDir: ".", commitExists },
    ),
  );
});

test("pendingRelease rejects publishedAt with the field named", () => {
  assert.throws(
    () =>
      validateState(
        fixture({ pendingRelease: { ...VALID_PENDING, publishedAt: "2026-11-20T00:32:59Z" } }),
        { repoDir: ".", commitExists },
      ),
    /pendingRelease\.publishedAt/,
  );
});

test("pendingRelease rejects a malformed commit with the field named", () => {
  assert.throws(
    () => validateState(fixture({ pendingRelease: { ...VALID_PENDING, commit: "abc" } }), { repoDir: ".", commitExists }),
    /pendingRelease\.commit/,
  );
});

test("lastRelease still requires publishedAt", () => {
  const withoutPublishedAt = { ...VALID_RELEASE };
  delete withoutPublishedAt.publishedAt;
  assert.throws(
    () => validateState(fixture({ lastRelease: withoutPublishedAt }), { repoDir: ".", commitExists }),
    /lastRelease\.publishedAt/,
  );
});

test("lastRelease still requires commit", () => {
  const withoutCommit = { ...VALID_RELEASE };
  delete withoutCommit.commit;
  assert.throws(
    () => validateState(fixture({ lastRelease: withoutCommit }), { repoDir: ".", commitExists }),
    /lastRelease\.commit/,
  );
});

test("loadState fails closed when the file is missing", () => {
  const repoDir = tempRepo();
  try {
    assert.throws(() => loadState(repoDir, { commitExists }), /release\/state\.json: cannot read/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("loadState fails closed when the file is not JSON", () => {
  const repoDir = tempRepo();
  try {
    writeState(repoDir, fixture(), { commitExists });
    writeFileSync(join(repoDir, "release/state.json"), "{not json", "utf8");
    assert.throws(() => loadState(repoDir, { commitExists }), /not valid JSON/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

const INVALID_STATES = [
  { name: "schemaVersion", state: fixture({ schemaVersion: 2 }), field: /schemaVersion/ },
  { name: "channel", state: fixture({ channel: "nightly" }), field: /channel/ },
  { name: "version", state: fixture({ version: "0.16" }), field: /version/ },
  { name: "versionCode zero", state: fixture({ versionCode: 0 }), field: /versionCode/ },
  {
    name: "versionCode above the ceiling",
    state: fixture({ versionCode: MAX_VERSION_CODE + 1 }),
    field: /versionCode/,
  },
  { name: "versionCode fraction", state: fixture({ versionCode: 1.5 }), field: /versionCode/ },
  {
    name: "classificationBase shape",
    state: fixture({ classificationBase: "abc123" }),
    field: /classificationBase/,
  },
  { name: "lastRelease missing", state: fixture({ lastRelease: undefined }), field: /lastRelease/ },
  {
    name: "lastRelease.tag",
    state: fixture({ lastRelease: { ...VALID_RELEASE, tag: "0.15.0" } }),
    field: /lastRelease\.tag/,
  },
  {
    name: "lastRelease.version",
    state: fixture({ lastRelease: { ...VALID_RELEASE, version: "0.15" } }),
    field: /lastRelease\.version/,
  },
  {
    name: "lastRelease.versionCode",
    state: fixture({ lastRelease: { ...VALID_RELEASE, versionCode: -1 } }),
    field: /lastRelease\.versionCode/,
  },
  {
    name: "lastRelease.commit",
    state: fixture({ lastRelease: { ...VALID_RELEASE, commit: "deadbeef" } }),
    field: /lastRelease\.commit/,
  },
  {
    name: "lastRelease.publishedAt",
    state: fixture({ lastRelease: { ...VALID_RELEASE, publishedAt: "yesterday" } }),
    field: /lastRelease\.publishedAt/,
  },
  { name: "pendingRelease shape", state: fixture({ pendingRelease: {} }), field: /pendingRelease\.tag/ },
  {
    name: "pendingRelease.publishedAt",
    state: fixture({ pendingRelease: { ...VALID_PENDING, publishedAt: "2026-11-20T00:32:59Z" } }),
    field: /pendingRelease\.publishedAt/,
  },
  {
    name: "pendingRelease.commit",
    state: fixture({ pendingRelease: { ...VALID_PENDING, commit: "abc" } }),
    field: /pendingRelease\.commit/,
  },
  { name: "state shape", state: [], field: /state must be a JSON object/ },
  { name: "state null", state: null, field: /state must be a JSON object/ },
];

test("every validation failure names the offending field", () => {
  for (const { name, state, field } of INVALID_STATES) {
    assert.throws(() => validateState(state, { repoDir: ".", commitExists }), field, name);
  }
});

test("a malformed lastRelease is rejected with the field named", () => {
  assert.throws(
    () => validateState(fixture({ lastRelease: { ...VALID_RELEASE, publishedAt: "soon" } }), { repoDir: ".", commitExists }),
    /lastRelease\.publishedAt/,
  );
});

test("an unknown classificationBase commit is rejected", () => {
  assert.throws(
    () => validateState(fixture(), { repoDir: ".", commitExists: commitMissing }),
    /classificationBase/,
  );
});

test("pendingRelease accepts null and a record with no commit", () => {
  assert.doesNotThrow(() => validateState(fixture({ pendingRelease: null }), { repoDir: ".", commitExists }));
  assert.doesNotThrow(() =>
    validateState(fixture({ pendingRelease: { ...VALID_PENDING } }), { repoDir: ".", commitExists }),
  );
});

test("claimVersionCode accepts exactly the next code", () => {
  const state = fixture();
  const claimed = claimVersionCode(state, 101078);
  assert.equal(claimed.versionCode, 101078);
  assert.equal(state.versionCode, 101077, "the original state is untouched");
  assert.equal(claimed.version, state.version, "other fields are preserved");
});

test("claimVersionCode rejects a stale claim", () => {
  const state = fixture();
  assert.throws(() => claimVersionCode(state, 101079), /stale/);
  assert.throws(() => claimVersionCode(state, 101077), /stale/);
  assert.throws(() => claimVersionCode(state, 101078.5), /must be an integer/);
});

test("claimVersionCode refuses a code above the ceiling", () => {
  const state = fixture({ versionCode: MAX_VERSION_CODE });
  assert.throws(() => claimVersionCode(state, MAX_VERSION_CODE + 1), /MAX_VERSION_CODE/);
});

test("serializeState is canonical", () => {
  const text = serializeState(fixture({ pendingRelease: null }));
  assert.ok(text.startsWith("{\n  \"schemaVersion\": 1,\n"));
  assert.ok(text.endsWith("\n"));
  assert.ok(!text.includes("\r"));
  assert.deepEqual(JSON.parse(text), fixture({ pendingRelease: null }));
});
