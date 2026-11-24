#!/usr/bin/env node
/**
 * Tests for scripts/check-version-sync.mjs.
 *
 * Run: `node --test scripts/check-version-sync.test.mjs` from repo root.
 * Pure Node builtins. Never prints key material.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertSync, MAX_VERSION_CODE } from "./check-version-sync.mjs";

const CLEAN = {
  rootVersion: "0.1.0-beta.1",
  mobileVersion: "0.1.0-beta.1",
  tag: null,
  headSha: "abc",
  tagSha: null,
  dirtyFiles: [],
};

const STATE = {
  version: "0.1.0-beta.1",
  versionCode: 101077,
};

const PENDING_STATE = {
  version: "0.16.0-beta.3",
  versionCode: 101077,
  pendingRelease: {
    version: "0.16.0",
    versionCode: 101078,
  },
};

const PENDING_CLEAN = {
  ...CLEAN,
  rootVersion: "0.16.0",
  mobileVersion: "0.16.0",
  state: PENDING_STATE,
};

describe("assertSync", () => {
  it("passes when versions match on an untagged clean tree", () => {
    assert.deepEqual(assertSync(CLEAN), []);
  });
  it("fails on root/mobile version mismatch", () => {
    const errors = assertSync({ ...CLEAN, mobileVersion: "0.2.0" });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /mismatch/);
  });
  it("passes when the tag equals v+mobile version on the tagged commit", () => {
    const errors = assertSync({
      ...CLEAN,
      tag: "v0.1.0-beta.1",
      headSha: "abc123",
      tagSha: "abc123",
    });
    assert.deepEqual(errors, []);
  });
  it("fails when the tag differs from v+mobile version", () => {
    const errors = assertSync({
      ...CLEAN,
      tag: "v0.2.0",
      headSha: "abc123",
      tagSha: "abc123",
    });
    assert.ok(errors.some((e) => /tag\/version mismatch/.test(e)));
  });
  it("fails when the checkout is not the tagged commit", () => {
    const errors = assertSync({
      ...CLEAN,
      tag: "v0.1.0-beta.1",
      headSha: "def456",
      tagSha: "abc123",
    });
    assert.ok(errors.some((e) => /exact tagged commit/.test(e)));
  });
  it("fails on a dirty tree", () => {
    const errors = assertSync({ ...CLEAN, dirtyFiles: ["M scripts/x.mjs"] });
    assert.ok(errors.some((e) => /dirty/.test(e)));
  });
});

describe("assertSync with release/state.json", () => {
  it("passes when the state agrees with the packages", () => {
    assert.deepEqual(assertSync({ ...CLEAN, state: STATE }), []);
  });

  it("fails when the state disagrees with the packages, naming all three values", () => {
    const errors = assertSync({ ...CLEAN, state: { ...STATE, version: "0.2.0" } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /canonical version is 0\.2\.0 \(from release\/state\.json version\)/);
    assert.match(errors[0], /root package\.json is 0\.1\.0-beta\.1/);
    assert.match(errors[0], /apps\/mobile\/package\.json is 0\.1\.0-beta\.1/);
  });

  it("fails when the state has no version", () => {
    const errors = assertSync({ ...CLEAN, state: { ...STATE, version: undefined } });
    assert.ok(errors.some((e) => /release\/state\.json has no version/.test(e)));
  });

  it("passes with a valid versionCode", () => {
    for (const versionCode of [1, 101077, MAX_VERSION_CODE]) {
      assert.deepEqual(assertSync({ ...CLEAN, state: { ...STATE, versionCode } }), [], String(versionCode));
    }
  });

  it("fails with an out-of-range versionCode", () => {
    for (const versionCode of [0, -1, 1.5, MAX_VERSION_CODE + 1, "101077", null]) {
      const errors = assertSync({ ...CLEAN, state: { ...STATE, versionCode } });
      assert.ok(
        errors.some((e) => /versionCode must be an integer in 1\.\.2100000000/.test(e)),
        String(versionCode),
      );
    }
  });

  it("keeps the tag rule when the state agrees", () => {
    const errors = assertSync({
      ...CLEAN,
      state: STATE,
      tag: "v0.2.0",
      headSha: "abc123",
      tagSha: "abc123",
    });
    assert.ok(errors.some((e) => /tag\/version mismatch/.test(e)));
  });

  it("fails when release/state.json is not a JSON object", () => {
    for (const state of [null, [], "state"]) {
      const errors = assertSync({ ...CLEAN, state });
      assert.ok(errors.some((e) => /release\/state\.json is not a JSON object/.test(e)), String(state));
    }
  });
});

describe("assertSync with a pending release", () => {
  it("passes when the pending version matches the packages", () => {
    assert.deepEqual(assertSync(PENDING_CLEAN), []);
  });

  it("fails when the packages still hold the base state version, naming the canonical version", () => {
    const errors = assertSync({
      ...PENDING_CLEAN,
      rootVersion: "0.16.0-beta.3",
      mobileVersion: "0.16.0-beta.3",
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /canonical version is 0\.16\.0/);
    assert.match(errors[0], /from release\/state\.json pendingRelease/);
  });

  it("passes when the tag equals v+the pending version", () => {
    const errors = assertSync({
      ...PENDING_CLEAN,
      tag: "v0.16.0",
      headSha: "abc123",
      tagSha: "abc123",
    });
    assert.deepEqual(errors, []);
  });

  it("fails when the tag uses the base state version instead of the pending version", () => {
    const errors = assertSync({
      ...PENDING_CLEAN,
      tag: "v0.16.0-beta.3",
      headSha: "abc123",
      tagSha: "abc123",
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /tag\/version mismatch/);
    assert.match(errors[0], /v0\.16\.0 exactly/);
  });

  it("fails when pendingRelease.versionCode is not state.versionCode + 1", () => {
    for (const versionCode of [101077, 101079]) {
      const errors = assertSync({
        ...PENDING_CLEAN,
        state: {
          ...PENDING_STATE,
          pendingRelease: { ...PENDING_STATE.pendingRelease, versionCode },
        },
      });
      assert.equal(errors.length, 1, String(versionCode));
      assert.match(errors[0], /pendingRelease\.versionCode is \d+/);
      assert.match(errors[0], /state\.versionCode is 101077/);
    }
  });

  it("keeps the base rule when there is no pending release", () => {
    const base = { ...PENDING_STATE, pendingRelease: null };
    assert.deepEqual(
      assertSync({
        ...CLEAN,
        rootVersion: "0.16.0-beta.3",
        mobileVersion: "0.16.0-beta.3",
        state: base,
      }),
      [],
    );
    const errors = assertSync({ ...PENDING_CLEAN, state: base });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /canonical version is 0\.16\.0-beta\.3/);
    assert.match(errors[0], /from release\/state\.json version/);
  });
});
