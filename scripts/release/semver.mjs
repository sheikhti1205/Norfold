#!/usr/bin/env node
/**
 * Dependency-free SemVer subset for the release pipeline.
 *
 * Deliberately narrow — only what a version bump needs:
 *   parse, compare, incPatch, incMinor, incMajor, format, isPrerelease
 *
 * Accepted input is exactly `X.Y.Z` or `X.Y.Z-pre`, where `pre` is
 * dot-separated identifiers of `[0-9A-Za-z-]+` and numeric identifiers carry
 * no leading zeros. Build metadata (`+...`) is not part of this subset.
 *
 * `parse` returns null for anything it cannot read. Every other export throws
 * a TypeError on invalid input instead of returning a plausible-looking value.
 *
 * Pure Node builtins. Test suite: scripts/release/semver.test.mjs
 */

// SemVer 2.0.0's reference grammar, minus build metadata.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

const IDENTIFIER_RE = /^[0-9A-Za-z-]+$/;
const NUMERIC_RE = /^\d+$/;

/** Parse a version string. Returns { major, minor, patch, prerelease } or null. */
export function parse(version) {
  if (typeof version !== "string") return null;
  const match = SEMVER_RE.exec(version);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function mustParse(version, label) {
  const parts = parse(version);
  if (parts === null) {
    throw new TypeError(`semver: ${label} ${JSON.stringify(version)} is not a valid SemVer version`);
  }
  return parts;
}

function compareNumeric(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Precedence of two prerelease identifier lists. An empty list means "no
 * prerelease", which outranks every list.
 */
function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left[index];
    const b = right[index];
    const aNumeric = NUMERIC_RE.test(a);
    const bNumeric = NUMERIC_RE.test(b);
    if (aNumeric && bNumeric) {
      const result = compareNumeric(Number(a), Number(b));
      if (result !== 0) return result;
    } else if (aNumeric) {
      // Numeric identifiers always have lower precedence than alphanumeric.
      return -1;
    } else if (bNumeric) {
      return 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  // Every shared identifier is equal: fewer identifiers sorts lower.
  return compareNumeric(left.length, right.length);
}

/** Full SemVer precedence. Returns -1, 0 or 1. Throws TypeError on invalid input. */
export function compare(a, b) {
  const left = mustParse(a, "left version");
  const right = mustParse(b, "right version");
  const core =
    compareNumeric(left.major, right.major) ||
    compareNumeric(left.minor, right.minor) ||
    compareNumeric(left.patch, right.patch);
  if (core !== 0) return core;
  return comparePrerelease(left.prerelease, right.prerelease);
}

/** Serialise { major, minor, patch, prerelease? } back to a string. */
export function format(parts) {
  if (parts === null || typeof parts !== "object") {
    throw new TypeError("semver: format() needs { major, minor, patch, prerelease }");
  }
  const { major, minor, patch } = parts;
  for (const [name, value] of [["major", major], ["minor", minor], ["patch", patch]]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`semver: format() ${name} ${JSON.stringify(value)} is not a non-negative integer`);
    }
  }
  const prerelease = parts.prerelease ?? [];
  if (!Array.isArray(prerelease)) {
    throw new TypeError("semver: format() prerelease must be an array of identifiers");
  }
  for (const identifier of prerelease) {
    if (typeof identifier !== "string" || !IDENTIFIER_RE.test(identifier)) {
      throw new TypeError(`semver: format() prerelease identifier ${JSON.stringify(identifier)} is invalid`);
    }
  }
  const core = `${major}.${minor}.${patch}`;
  return prerelease.length === 0 ? core : `${core}-${prerelease.join(".")}`;
}

/** True when the version carries a prerelease. Throws TypeError on invalid input. */
export function isPrerelease(version) {
  return mustParse(version, "version").prerelease.length > 0;
}

/** Increment the patch, dropping any prerelease: 1.2.3-beta.4 -> 1.2.4. */
export function incPatch(version) {
  const { major, minor, patch } = mustParse(version, "version");
  return `${major}.${minor}.${patch + 1}`;
}

/** Increment the minor and zero the patch, dropping any prerelease. */
export function incMinor(version) {
  const { major, minor } = mustParse(version, "version");
  return `${major}.${minor + 1}.0`;
}

/** Increment the major and zero minor/patch, dropping any prerelease. */
export function incMajor(version) {
  const { major } = mustParse(version, "version");
  return `${major + 1}.0.0`;
}
