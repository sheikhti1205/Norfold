#!/usr/bin/env node
/**
 * Tests for scripts/release/semver.mjs.
 *
 * Run: `node --test scripts/release/semver.test.mjs` from repo root.
 * Pure Node builtins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compare, format, incMajor, incMinor, incPatch, isPrerelease, parse } from "./semver.mjs";

// The precedence chain from the SemVer 2.0.0 specification.
const PRECEDENCE_CHAIN = [
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0-alpha.beta",
  "1.0.0-beta",
  "1.0.0-beta.2",
  "1.0.0-beta.11",
  "1.0.0-rc.1",
  "1.0.0",
];

const PARSE_CASES = [
  {
    version: "1.2.3",
    expected: { major: 1, minor: 2, patch: 3, prerelease: [] },
  },
  {
    version: "0.16.0-beta.3",
    expected: { major: 0, minor: 16, patch: 0, prerelease: ["beta", "3"] },
  },
  {
    version: "10.20.30-rc.1.hotfix-2",
    expected: { major: 10, minor: 20, patch: 30, prerelease: ["rc", "1", "hotfix-2"] },
  },
];

const INVALID_VERSIONS = [
  "",
  "1",
  "1.0",
  "1.0.0.0",
  "v1.0.0",
  "01.0.0",
  "1.02.3",
  "1.2.3-",
  "1.2.3-01",
  "1.2.3-alpha..1",
  "1.2.3+build.5",
  " 1.2.3",
  "1.2.3 ",
  "1.2.3-alpha beta",
];

const BUMP_CASES = [
  { version: "1.2.3", patch: "1.2.4", minor: "1.3.0", major: "2.0.0" },
  { version: "0.16.0-beta.3", patch: "0.16.1", minor: "0.17.0", major: "1.0.0" },
  { version: "0.0.0", patch: "0.0.1", minor: "0.1.0", major: "1.0.0" },
];

test("compare follows the SemVer precedence chain", () => {
  for (let index = 0; index < PRECEDENCE_CHAIN.length - 1; index += 1) {
    const lower = PRECEDENCE_CHAIN[index];
    const higher = PRECEDENCE_CHAIN[index + 1];
    assert.equal(compare(lower, higher), -1, `${lower} < ${higher}`);
    assert.equal(compare(higher, lower), 1, `${higher} > ${lower}`);
    assert.equal(compare(lower, lower), 0, `${lower} == ${lower}`);
  }
});

test("compare ranks numeric prerelease identifiers below alphanumeric ones", () => {
  assert.equal(compare("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compare("1.0.0-alpha", "1.0.0-1"), 1);
});

test("compare puts a prerelease below the same core version", () => {
  assert.equal(compare("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compare("1.0.0", "1.0.0-rc.1"), 1);
});

test("compare puts fewer prerelease identifiers below more when the prefix is equal", () => {
  assert.equal(compare("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compare("1.0.0-alpha.1", "1.0.0-alpha"), 1);
});

test("compare orders by major, then minor, then patch", () => {
  assert.equal(compare("2.0.0", "1.99.99"), 1);
  assert.equal(compare("1.2.0", "1.1.99"), 1);
  assert.equal(compare("1.1.2", "1.1.1"), 1);
});

test("parse reads valid versions", () => {
  for (const { version, expected } of PARSE_CASES) {
    assert.deepEqual(parse(version), expected, version);
  }
});

test("parse returns null for anything outside the subset", () => {
  for (const version of INVALID_VERSIONS) {
    assert.equal(parse(version), null, version);
  }
  assert.equal(parse(null), null);
  assert.equal(parse(42), null);
});

test("format round-trips parse", () => {
  for (const { version } of PARSE_CASES) {
    assert.equal(format(parse(version)), version);
  }
});

test("format rejects malformed parts", () => {
  assert.throws(() => format(null), TypeError);
  assert.throws(() => format({ major: -1, minor: 0, patch: 0 }), TypeError);
  assert.throws(() => format({ major: 1, minor: 1.5, patch: 0 }), TypeError);
  assert.throws(() => format({ major: 1, minor: 0, patch: 0, prerelease: ["ok", ""] }), TypeError);
});

test("increments drop the prerelease", () => {
  for (const { version, patch, minor, major } of BUMP_CASES) {
    assert.equal(incPatch(version), patch, `${version} incPatch`);
    assert.equal(incMinor(version), minor, `${version} incMinor`);
    assert.equal(incMajor(version), major, `${version} incMajor`);
  }
});

test("isPrerelease distinguishes pre-release from stable", () => {
  assert.equal(isPrerelease("0.16.0-beta.3"), true);
  assert.equal(isPrerelease("0.16.0"), false);
});

test("invalid input throws a TypeError instead of returning garbage", () => {
  for (const version of INVALID_VERSIONS) {
    assert.throws(() => compare(version, "1.0.0"), TypeError, `compare(${version})`);
    assert.throws(() => compare("1.0.0", version), TypeError, `compare(1.0.0, ${version})`);
    assert.throws(() => incPatch(version), TypeError, `incPatch(${version})`);
    assert.throws(() => incMinor(version), TypeError, `incMinor(${version})`);
    assert.throws(() => incMajor(version), TypeError, `incMajor(${version})`);
    assert.throws(() => isPrerelease(version), TypeError, `isPrerelease(${version})`);
  }
});
