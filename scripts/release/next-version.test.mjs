#!/usr/bin/env node
/**
 * Tests for scripts/release/next-version.mjs.
 *
 * Run: `node --test scripts/release/next-version.test.mjs` from repo root.
 * Pure Node builtins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { assertPlainVersion, nextVersion, nextVersionCode } from "./next-version.mjs";
import { compare } from "./semver.mjs";
import { MAX_VERSION_CODE } from "./state.mjs";

const NEXT_VERSION_CASES = [
  {
    name: "legacy beta seed + patch drops the prerelease",
    version: "0.16.0-beta.3",
    impact: "patch",
    expected: "0.16.0",
  },
  {
    name: "legacy beta seed + minor bumps the minor",
    version: "0.16.0-beta.3",
    impact: "minor",
    expected: "0.17.0",
  },
  {
    name: "legacy beta seed + major is a minor bump before 1.0",
    version: "0.16.0-beta.3",
    impact: "major",
    expected: "0.17.0",
  },
  {
    name: "1.x legacy seed + major is a real major bump",
    version: "1.2.3-beta.2",
    impact: "major",
    expected: "2.0.0",
  },
  {
    name: "stable patch increments the patch",
    version: "0.16.0",
    impact: "patch",
    expected: "0.16.1",
  },
  {
    name: "stable minor zeroes the patch",
    version: "0.16.0",
    impact: "minor",
    expected: "0.17.0",
  },
  {
    name: "stable major is a minor bump before 1.0",
    version: "0.16.0",
    impact: "major",
    expected: "0.17.0",
  },
  {
    name: "1.2.3 + patch",
    version: "1.2.3",
    impact: "patch",
    expected: "1.2.4",
  },
  {
    name: "1.2.3 + minor",
    version: "1.2.3",
    impact: "minor",
    expected: "1.3.0",
  },
  {
    name: "1.2.3 + major",
    version: "1.2.3",
    impact: "major",
    expected: "2.0.0",
  },
];

test("nextVersion bumps the core and never emits a prerelease suffix", () => {
  for (const { name, version, impact, expected } of NEXT_VERSION_CASES) {
    for (const channel of ["beta", "stable"]) {
      const result = nextVersion({ channel, version }, impact);
      assert.equal(result.required, true, name);
      assert.equal(result.version, expected, `${name} (${channel})`);
      assert.ok(!result.version.includes("-"), `${name}: no prerelease suffix`);
      assert.equal(compare(result.version, version), 1, `${name}: sorts above ${version}`);
    }
  }
});

test("the channel never changes the version string", () => {
  for (const { version, impact } of NEXT_VERSION_CASES) {
    assert.equal(
      nextVersion({ channel: "beta", version }, impact).version,
      nextVersion({ channel: "stable", version }, impact).version,
      `${version} + ${impact}`,
    );
  }
});

test("nextVersion reports no requirement for a none impact", () => {
  for (const channel of ["beta", "stable"]) {
    assert.deepEqual(nextVersion({ channel, version: "0.16.0-beta.3" }, "none"), {
      required: false,
      version: null,
    });
  }
});

test("assertPlainVersion rejects anything with a prerelease suffix", () => {
  assert.equal(assertPlainVersion("0.16.0"), "0.16.0");
  assert.throws(() => assertPlainVersion("0.16.0-beta.3"), /prerelease suffix/);
  assert.throws(() => assertPlainVersion("1.2.3-rc.1"), /prerelease suffix/);
  assert.throws(() => assertPlainVersion(null), /prerelease suffix/);
});

test("nextVersion rejects unknown impacts, channels and versions", () => {
  assert.throws(() => nextVersion({ channel: "beta", version: "0.16.0-beta.3" }, "huge"), TypeError);
  assert.throws(() => nextVersion({ channel: "nightly", version: "0.16.0-beta.3" }, "patch"), TypeError);
  assert.throws(() => nextVersion({ channel: "beta", version: "0.16" }, "patch"), TypeError);
  assert.throws(() => nextVersion(null, "patch"), TypeError);
});

test("nextVersionCode increments by exactly one", () => {
  assert.equal(nextVersionCode({ versionCode: 101077 }), 101078);
  assert.equal(nextVersionCode({ versionCode: 1 }), 2);
});

test("nextVersionCode ignores anything a commit count could influence", () => {
  assert.equal(nextVersionCode({ versionCode: 101077, commitsTotal: 9999 }), 101078);
});

test("nextVersionCode refuses to exceed MAX_VERSION_CODE", () => {
  assert.equal(nextVersionCode({ versionCode: MAX_VERSION_CODE - 1 }), MAX_VERSION_CODE);
  assert.throws(() => nextVersionCode({ versionCode: MAX_VERSION_CODE }), RangeError);
  assert.throws(() => nextVersionCode({ versionCode: MAX_VERSION_CODE + 10 }), RangeError);
});

test("nextVersionCode rejects a non-integer current code", () => {
  assert.throws(() => nextVersionCode({ versionCode: 1.5 }), TypeError);
  assert.throws(() => nextVersionCode({ versionCode: -1 }), TypeError);
  assert.throws(() => nextVersionCode(null), TypeError);
});
