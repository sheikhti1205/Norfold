#!/usr/bin/env node
/**
 * Deployed-identity manifest for the web surface (`dist/version.json`).
 *
 * The live site is a static bundle; without this file the only way to learn
 * which commit production serves is to grep a minified asset for the Sentry
 * release string. `GET https://<site>/version.json` answers it in one request.
 *
 * Inputs are the values web.yml already computed — the full commit checked out
 * and the `SENTRY_RELEASE` from its Compute step. Nothing is recomputed here in
 * a divergent way: the release's trailing 12 hex characters must equal the
 * commit prefix, so a disagreement fails closed instead of shipping a manifest
 * that describes a different build.
 *
 * The manifest holds identity only: commit, release, dist tag, build time. No
 * secret, token or DSN component is ever written or logged.
 *
 * Usage:
 *   node scripts/write-web-version.mjs --out apps/mobile/dist/version.json \
 *     --release "findback-mobile@0.15.0-beta.1+c7724e541efd" [--dist web-production]
 *     [--commit "$GIT_COMMIT"] [--built-at 2026-11-10T09:00:00.000Z]
 *   node scripts/write-web-version.mjs --verify apps/mobile/dist/version.json \
 *     --release "$SENTRY_RELEASE" [--dist web-production]
 *
 * Pure Node builtins.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const DEFAULT_WEB_DIST = "web-production";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
// Same shape as apps/mobile/src/services/monitoring/release.ts: the 12-char
// prefix is what `git rev-parse --short=12 HEAD` produces.
const SENTRY_RELEASE = /^findback-mobile@\d+\.\d+\.\d+[-+0-9A-Za-z.]*\+[0-9a-f]{12}$/i;
const DIST_TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHORT_SHA_LENGTH = 12;

function fail(message) {
  throw new Error(`write-web-version: ${message}`);
}

function commitSha(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") fail("commit is empty");
  if (!COMMIT_SHA.test(value)) fail("commit is not a full 40-hex SHA");
  return value.toLowerCase();
}

/** The 12-character prefix the release identity embeds. */
export function shortCommit(commit) {
  return commitSha(commit).slice(0, SHORT_SHA_LENGTH);
}

function releaseIdentity(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") fail("release is empty");
  if (!SENTRY_RELEASE.test(value)) fail("release is not findback-mobile@<version>+<12-char sha>");
  return value;
}

function distTag(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") fail("dist is empty");
  if (!DIST_TAG.test(value)) fail("dist is not a plain lowercase tag");
  return value;
}

function builtAtUtc(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") fail("builtAt is empty");
  if (Number.isNaN(Date.parse(value))) fail("builtAt is not a timestamp");
  return new Date(value).toISOString();
}

/**
 * The manifest document. `release` must describe `commit`: a manifest whose
 * release names a different SHA would make the one-request answer wrong.
 */
export function buildWebVersion({ commit, release, dist = DEFAULT_WEB_DIST, builtAt = new Date().toISOString() } = {}) {
  const fullCommit = commitSha(commit);
  const short = fullCommit.slice(0, SHORT_SHA_LENGTH);
  const identity = releaseIdentity(release);
  const releaseSha = identity.slice(identity.lastIndexOf("+") + 1).toLowerCase();
  if (releaseSha !== short) {
    fail(`release ${identity} does not describe commit ${fullCommit} (expected +${short})`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    commit: fullCommit,
    shortCommit: short,
    release: identity,
    dist: distTag(dist),
    builtAt: builtAtUtc(builtAt),
  };
}

/** Build + write `<out>`; returns the document that was written. */
export function writeWebVersion({ out, ...options } = {}) {
  if (!out) fail("--out is required");
  const target = resolve(out);
  const document = buildWebVersion(options);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

/**
 * Assert a written manifest: exists, parses, and carries the identity this
 * workflow computed. Throws with a specific reason otherwise — the CI step
 * turns that into `exit 1` so a bad manifest stops the deploy.
 */
export function verifyWebVersionFile({ file, release, dist = DEFAULT_WEB_DIST } = {}) {
  if (!file) fail("--verify is required");
  const identity = releaseIdentity(release);
  let raw;
  try {
    raw = readFileSync(resolve(file), "utf8");
  } catch {
    fail(`manifest missing: ${file}`);
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    fail(`manifest is not valid JSON: ${file}`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    fail("manifest is not a JSON object");
  }
  if (document.release !== identity) {
    fail(`manifest release ${String(document.release)} does not equal computed SENTRY_RELEASE ${identity}`);
  }
  if (document.dist !== distTag(dist)) {
    fail(`manifest dist ${String(document.dist)} is not ${dist}`);
  }
  if (!COMMIT_SHA.test(String(document.commit ?? ""))) fail("manifest commit is not a full 40-hex SHA");
  const short = document.commit.toLowerCase().slice(0, SHORT_SHA_LENGTH);
  if (document.shortCommit !== short) fail(`manifest shortCommit is not ${short}`);
  if (identity.slice(identity.lastIndexOf("+") + 1).toLowerCase() !== short) {
    fail("manifest release does not describe manifest commit");
  }
  if (Number.isNaN(Date.parse(String(document.builtAt ?? ""))) || !String(document.builtAt).endsWith("Z")) {
    fail("manifest builtAt is not a UTC timestamp");
  }
  return document;
}

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) fail(`${name} requires a value`);
  return args[index + 1];
}

function optional(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : argValue(args, name);
}

function main(argv) {
  const args = argv.slice(2);
  const release = argValue(args, "--release");
  const dist = optional(args, "--dist") ?? DEFAULT_WEB_DIST;
  const verifyTarget = optional(args, "--verify");
  if (verifyTarget) {
    const document = verifyWebVersionFile({ file: verifyTarget, release, dist });
    console.log(`write-web-version: PASS (${document.dist} commit ${document.shortCommit} release ${document.release})`);
    return;
  }
  const out = argValue(args, "--out");
  const commit = optional(args, "--commit") ?? process.env.GIT_COMMIT;
  const document = writeWebVersion({ out, commit, release, dist, builtAt: optional(args, "--built-at") });
  console.log(
    `write-web-version: wrote ${out} (${document.dist} commit ${document.shortCommit} release ${document.release} builtAt ${document.builtAt})`,
  );
}

function isMainModule() {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return invoked === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
