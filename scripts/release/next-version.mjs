#!/usr/bin/env node
/**
 * Derive the next version and version code from the release state.
 *
 * Versions are plain `X.Y.Z`. This pipeline never emits a prerelease suffix,
 * and `assertPlainVersion` throws if a result would contain `-`.
 *
 * The legacy seed `0.16.0-beta.3` is the only prerelease the code can see: a
 * patch bump from it drops the suffix, and minor/major operate on the core
 * `major.minor.patch` value.
 *
 * `channel` does not participate in the arithmetic. `beta` and `stable`
 * produce exactly the same version string; the channel only tells the release
 * workflow whether to flag the GitHub release as a prerelease and how to label
 * its title.
 *
 * The result must sort strictly above the current version; anything else is a
 * bug and throws rather than publishing a duplicate.
 *
 * Pure Node builtins. Test suite: scripts/release/next-version.test.mjs
 */
import { compare, incMajor, incMinor, incPatch, parse } from "./semver.mjs";
import { MAX_VERSION_CODE } from "./state.mjs";

const IMPACTS = ["none", "patch", "minor", "major"];
const INT32_MAX = 2_147_483_647;

function coreOf(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

/** Throw unless `version` is a plain `X.Y.Z` with no prerelease suffix. */
export function assertPlainVersion(version) {
  if (typeof version !== "string" || version.includes("-")) {
    throw new Error(`next-version: ${JSON.stringify(version)} carries a prerelease suffix; versions are plain X.Y.Z`);
  }
  return version;
}

/**
 * Next version for an impact. Returns { required: false, version: null } for
 * `none`, otherwise { required: true, version }.
 */
export function nextVersion(state, impact) {
  if (!IMPACTS.includes(impact)) {
    throw new TypeError(`next-version: unknown impact ${JSON.stringify(impact)}`);
  }
  if (impact === "none") return { required: false, version: null };
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("next-version: state must be an object");
  }
  // Validated only: the channel labels a release, it never changes a version.
  const { channel } = state;
  if (channel !== "beta" && channel !== "stable") {
    throw new TypeError(`next-version: state.channel ${JSON.stringify(channel)} is not beta or stable`);
  }
  const current = parse(state.version);
  if (current === null) {
    throw new TypeError(`next-version: state.version ${JSON.stringify(state.version)} is not a SemVer version`);
  }

  const base = coreOf(current);
  let next;
  if (current.prerelease.length > 0) {
    // Legacy seed: dropping the suffix is the patch bump.
    if (impact === "patch") next = base;
    else if (impact === "minor") next = incMinor(base);
    else next = current.major === 0 ? incMinor(base) : incMajor(base);
  } else if (impact === "patch") {
    next = incPatch(state.version);
  } else if (impact === "minor") {
    next = incMinor(state.version);
  } else {
    // Pre-1.0, a breaking change is still a minor bump.
    next = current.major === 0 ? incMinor(state.version) : incMajor(state.version);
  }

  assertPlainVersion(next);
  if (compare(next, state.version) !== 1) {
    throw new Error(`next-version: ${next} does not sort above ${state.version}`);
  }
  return { required: true, version: next };
}

/**
 * The only claimable version code: exactly one more than the state holds.
 * Never derived from commit counts — a squash or a rebase would reuse a code.
 */
export function nextVersionCode(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("next-version: state must be an object");
  }
  const current = state.versionCode;
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new TypeError(`next-version: state.versionCode ${JSON.stringify(current)} is not a non-negative integer`);
  }
  const next = current + 1;
  if (next > MAX_VERSION_CODE) {
    throw new RangeError(`next-version: versionCode ${next} exceeds MAX_VERSION_CODE ${MAX_VERSION_CODE}`);
  }
  if (next > INT32_MAX) {
    throw new RangeError(`next-version: versionCode ${next} does not fit a signed 32-bit integer`);
  }
  return next;
}
