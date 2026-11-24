#!/usr/bin/env node
/**
 * Version-sync assertions for the release pipeline.
 *
 * Read-only: never bumps, edits, or publishes any version. Fails closed
 * BEFORE any signing step when:
 *   * root package.json version != apps/mobile/package.json version
 *   * the canonical version != both package versions, where the canonical
 *     version is `state.pendingRelease.version` when a release is pending and
 *     `state.version` otherwise
 *   * a pendingRelease.versionCode != state.versionCode + 1
 *   * release/state.json versionCode is not an integer in 1..2100000000
 *   * on a v* tag build: tag != "v" + canonical version, exactly
 *   * on a v* tag build: checkout commit != tagged commit
 *   * the working tree is dirty (never build a release from a dirty tree)
 *
 * `packages/shared` is an independent internal package: nothing is asserted
 * about it. The lockfile is not asserted here either; sync-version.mjs owns
 * writing the four places.
 *
 * Usage:
 *   node scripts/check-version-sync.mjs                    # equality + clean tree
 *   node scripts/check-version-sync.mjs --tag v0.1.0-beta.1 # + tag assertions
 *   node scripts/check-version-sync.mjs --ref refs/tags/vX  # GitHub ref form
 *
 * Pure Node builtins. Test suite: scripts/check-version-sync.test.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const MAX_VERSION_CODE = 2_100_000_000;
const STATE_FILE = "release/state.json";

/**
 * Pure assertion core. Returns a list of failure strings (empty = pass).
 * All inputs are plain data so this is unit-testable without git or files.
 *
 * `state` is the parsed `release/state.json`, or undefined when the file does
 * not exist. Any other value (including null) is rejected as malformed.
 *
 * A release is published in two phases. At prepare time the packages move to
 * the new version and `state.pendingRelease` records it, while `state.version`
 * deliberately stays at the previously assigned version (the resolver requires
 * pendingRelease.version to sort above it). The packages and the tag therefore
 * follow the canonical version below, not `state.version` itself.
 */
export function assertSync({ rootVersion, mobileVersion, tag, headSha, tagSha, dirtyFiles, state } = {}) {
  const errors = [];
  let canonicalVersion = mobileVersion;
  if (!rootVersion) errors.push("root package.json has no version");
  if (!mobileVersion) errors.push("apps/mobile/package.json has no version");
  if (rootVersion && mobileVersion && rootVersion !== mobileVersion) {
    errors.push(
      `version mismatch: root package.json is ${rootVersion} but apps/mobile/package.json is ${mobileVersion}`,
    );
  }
  if (state !== undefined) {
    if (state === null || typeof state !== "object" || Array.isArray(state)) {
      errors.push(`${STATE_FILE} is not a JSON object`);
    } else {
      let canonicalSource = `${STATE_FILE} version`;
      let resolved = state.version;
      if (typeof state.version !== "string" || state.version === "") {
        errors.push(`${STATE_FILE} has no version`);
        resolved = undefined;
      }

      if (state.pendingRelease !== undefined && state.pendingRelease !== null) {
        if (typeof state.pendingRelease !== "object" || Array.isArray(state.pendingRelease)) {
          errors.push(`${STATE_FILE} pendingRelease is not a JSON object`);
          resolved = undefined;
        } else {
          canonicalSource = `${STATE_FILE} pendingRelease`;
          resolved = state.pendingRelease.version;
          if (typeof resolved !== "string" || resolved === "") {
            errors.push(`${STATE_FILE} pendingRelease has no version`);
            resolved = undefined;
          }
          if (state.pendingRelease.versionCode !== state.versionCode + 1) {
            errors.push(
              `versionCode mismatch: ${STATE_FILE} pendingRelease.versionCode is ${JSON.stringify(state.pendingRelease.versionCode)} but state.versionCode is ${JSON.stringify(state.versionCode)} (pendingRelease.versionCode must be exactly state.versionCode + 1)`,
            );
          }
        }
      }

      if (typeof resolved === "string" && resolved !== "") {
        canonicalVersion = resolved;
        if (rootVersion && mobileVersion && (resolved !== rootVersion || resolved !== mobileVersion)) {
          errors.push(
            `version mismatch: canonical version is ${resolved} (from ${canonicalSource}) but root package.json is ${rootVersion} and apps/mobile/package.json is ${mobileVersion}`,
          );
        }
      }

      if (!Number.isInteger(state.versionCode) || state.versionCode < 1 || state.versionCode > MAX_VERSION_CODE) {
        errors.push(
          `${STATE_FILE} versionCode must be an integer in 1..${MAX_VERSION_CODE} (got ${JSON.stringify(state.versionCode)})`,
        );
      }
    }
  }
  if (tag) {
    const expected = `v${canonicalVersion}`;
    if (typeof canonicalVersion === "string" && canonicalVersion !== "" && tag !== expected) {
      errors.push(`tag/version mismatch: tag is ${tag} but canonical version requires ${expected} exactly`);
    }
    if (headSha && tagSha && headSha !== tagSha) {
      errors.push(
        `tag points at ${tagSha} but the checkout is ${headSha} — release must build the exact tagged commit`,
      );
    }
  }
  if (dirtyFiles && dirtyFiles.length > 0) {
    errors.push(`dirty working tree (${dirtyFiles.length} file(s)) — never build a release from a dirty tree`);
  }
  return errors;
}

function readVersion(relativePath) {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8"));
  return pkg.version;
}

/** Parsed release state, or undefined when `release/state.json` is absent. */
function readState() {
  const file = resolve(REPO_ROOT, STATE_FILE);
  if (!existsSync(file)) return undefined;
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`check-version-sync: cannot read ${STATE_FILE} (${error.code ?? error.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`check-version-sync: ${STATE_FILE} is not valid JSON (${error.message})`);
  }
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: REPO_ROOT }).trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    let tag = null;
    const tagIdx = args.indexOf("--tag");
    const refIdx = args.indexOf("--ref");
    if (tagIdx !== -1) {
      tag = args[tagIdx + 1];
      if (!tag) throw new Error("check-version-sync: --tag requires a value");
    } else if (refIdx !== -1) {
      const ref = args[refIdx + 1];
      if (!ref) throw new Error("check-version-sync: --ref requires a value");
      const match = /^refs\/tags\/(v.+)$/.exec(ref.trim());
      if (match) tag = match[1];
    } else if (process.env.GITHUB_REF?.startsWith("refs/tags/v")) {
      tag = process.env.GITHUB_REF.replace("refs/tags/", "");
    }

    const rootVersion = readVersion("package.json");
    const mobileVersion = readVersion("apps/mobile/package.json");
    const state = readState();
    const headSha = git(["rev-parse", "HEAD"]);
    const tagSha = tag ? git(["rev-list", "-n", "1", tag]) : null;
    const porcelain = git(["status", "--porcelain"]);
    const dirtyFiles = porcelain ? porcelain.split("\n").filter(Boolean) : [];

    const errors = assertSync({ rootVersion, mobileVersion, tag, headSha, tagSha, dirtyFiles, state });
    if (errors.length > 0) {
      for (const error of errors) console.error(`check-version-sync: FAIL: ${error}`);
      process.exit(1);
    }
    console.log(
      `check-version-sync: PASS (root=${rootVersion} mobile=${mobileVersion}` +
        (tag ? ` tag=${tag} sha=${headSha}` : " untagged") +
        ")",
    );
  } catch (error) {
    console.error(
      error.message.startsWith("check-version-sync:") ? error.message : `check-version-sync: ${error.message}`,
    );
    process.exit(1);
  }
}
