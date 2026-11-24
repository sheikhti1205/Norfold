#!/usr/bin/env node
/**
 * Cross-artifact release consistency.
 *
 * A release publishes several artifacts that each carry the version: the
 * release state, both `package.json` files, the npm lockfile, the signed APKs,
 * the update catalogue, the git tag and the Sentry release string. This script
 * reads what already exists and fails closed unless all of them agree. It
 * derives nothing it can read and writes nothing.
 *
 * The release being assembled is one canonical pair, read from the state:
 *
 *   canonicalVersion     = pendingRelease ? pendingRelease.version     : state.version
 *   canonicalVersionCode = pendingRelease ? pendingRelease.versionCode : state.versionCode + 1
 *
 * A `pendingRelease` is the release in preparation. It deliberately leaves
 * `state.version` at the previously assigned value (often a prerelease), so
 * every comparison below uses the canonical pair and never `state.version`
 * directly. Without one, the next version code is the only claimable one —
 * `state.versionCode + 1`, the value the Android build stamps — and the
 * version is the top-level one.
 *
 * Usage:
 *   node scripts/release/verify-consistency.mjs \
 *     --state release/state.json \
 *     --package package.json \
 *     --mobile-package apps/mobile/package.json \
 *     --lock package-lock.json \
 *     [--catalogue catalogue.v1.json] \
 *     [--apk-facts apk-facts.json] \
 *     [--tag v1.2.3] \
 *     [--expect-version X.Y.Z] \
 *     [--expect-version-code N] \
 *     [--json]
 *
 * Checks, each reported as one PASS/FAIL line and each fatal:
 *   1. version agreement   the canonical version, both package.json files and
 *                          both lockfile entries name one version.
 *                          `packages/shared` is versioned independently: only
 *                          its existence is asserted, never its version.
 *   2. version shape       the canonical version is plain X.Y.Z, and a
 *                          pendingRelease sorts above the state version.
 *   3. version code        the canonical version code is an integer in
 *                          1..2100000000; a pendingRelease carries exactly
 *                          `state.versionCode + 1`; every APK agrees with the
 *                          canonical code and version.
 *   4. APK identity        package id, signing channel and one signer across
 *                          every ABI.
 *   5. catalogue agreement schemaVersion, per-release tag/version/versionCode
 *                          against the canonical pair, and per-artifact SDK
 *                          levels against apps/mobile/android/variables.gradle.
 *   6. tag agreement       the tag is `v` + the canonical version.
 *   7. expectations        the values the publisher decided must equal the
 *                          canonical pair.
 *   8. Sentry identity     the shared namespace literal and the version token.
 *
 * Shapes read here, and who writes them:
 *   * release/state.json              scripts/release/state.mjs
 *   * package-lock.json               npm workspaces: packages[""] and
 *                                     packages["apps/mobile"]
 *   * apk-facts.json                  scripts/verify-release-apks.sh writes a
 *                                     JSON array of
 *                                     {abi, abis, packageName, versionName,
 *                                     versionCode, minSdk, targetSdk,
 *                                     signerSha256}. A release-manifest object
 *                                     with an `artifacts` array is accepted too
 *                                     because it adds the signingChannel label.
 *   * catalogue.v1.json               scripts/write-android-catalogue.mjs:
 *                                     schemaVersion 1, releases[] with
 *                                     versionName/versionCode/tag, and
 *                                     artifacts[] carrying minSdk/targetSdk.
 *   * variables.gradle                minSdkVersion / targetSdkVersion; the
 *                                     SDK levels are read, never hardcoded.
 *   * release.ts                      apps/mobile/src/services/monitoring/
 *                                     release.ts pins the mobile release
 *                                     string; scripts/build-context.mjs owns
 *                                     the mint and is imported, not copied.
 *
 * Exit codes: 0 everything agrees; 1 at least one disagreement (every failure
 * is printed); 2 a required input was missing or unparseable.
 *
 * Pure Node builtins. Test suite: scripts/release/verify-consistency.test.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SENTRY_RELEASE_MOBILE_NAMESPACE,
  sentryRelease,
} from "../build-context.mjs";
import { compare } from "./semver.mjs";
import { MAX_VERSION_CODE } from "./state.mjs";

export const PACKAGE_NAME = "com.findback.app";
export const SIGNING_CHANNEL = "beta";
export const CATALOGUE_SCHEMA_VERSION = 1;
export const SENTRY_NAMESPACE = "findback-mobile";

const PLAIN_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Any 12-hex token proves the mint's shape; the real SHA comes from git.
const SENTRY_SAMPLE_SHORT12 = "0123456789ab";

const DEFAULTS = Object.freeze({
  state: "release/state.json",
  package: "package.json",
  mobile: "apps/mobile/package.json",
  lock: "package-lock.json",
  shared: "packages/shared/package.json",
  gradle: "apps/mobile/android/variables.gradle",
  releaseSource: "apps/mobile/src/services/monitoring/release.ts",
});

function fail(message) {
  throw new Error(`verify-consistency: ${message}`);
}

function loadJson(file, label, problems) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    problems.push(`${label}: cannot read ${file} (${error.code ?? error.message})`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    problems.push(`${label}: is not valid JSON (${file}: ${error.message})`);
    return undefined;
  }
}

function loadText(file, label, problems) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    problems.push(`${label}: cannot read ${file} (${error.code ?? error.message})`);
    return null;
  }
}

function requireObject(value, label, problems) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${label}: must be a JSON object`);
    return null;
  }
  return value;
}

/** Load a required JSON object, reporting a read/parse failure exactly once. */
function loadObject(file, label, problems) {
  const value = loadJson(file, label, problems);
  if (value === undefined) return null;
  return requireObject(value, label, problems);
}

function requireString(object, field, label, problems) {
  const value = object?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${label}: ${field} must be a non-empty string`);
    return null;
  }
  return value;
}

function lockEntryVersion(lock, key, problems) {
  const label = `package-lock.json packages[${JSON.stringify(key)}]`;
  const packages = lock?.packages;
  if (packages === null || typeof packages !== "object" || Array.isArray(packages)) {
    problems.push('package-lock.json: "packages" is missing');
    return null;
  }
  const entry = packages[key];
  if (entry === undefined || entry === null || typeof entry !== "object") {
    problems.push(`${label} is missing`);
    return null;
  }
  if (typeof entry.version !== "string" || entry.version.trim() === "") {
    problems.push(`${label}: version must be a non-empty string`);
    return null;
  }
  return entry.version;
}

/**
 * The release being assembled: the canonical version/versionCode pair and the
 * state values it was derived from.
 *
 * A `pendingRelease` owns both values while the top-level version stays at the
 * previously assigned value. Without one, the only claimable code is
 * `state.versionCode + 1`, which is what the Android build stamps.
 */
function readStateRelease(stateDoc, problems) {
  const stateVersion = stateDoc === null ? null : requireString(stateDoc, "version", "release/state.json", problems);
  const stateVersionCode = stateDoc?.versionCode;
  const rawPending = stateDoc?.pendingRelease;
  const hasPending = rawPending !== null && rawPending !== undefined;
  let pending = null;
  let pendingVersion = null;
  if (hasPending) {
    pending = requireObject(rawPending, "release/state.json pendingRelease", problems);
    if (pending !== null) {
      pendingVersion = requireString(pending, "version", "release/state.json pendingRelease", problems);
      if (!Number.isInteger(pending.versionCode)) {
        problems.push(
          "release/state.json pendingRelease: versionCode must be an integer " +
            `(got ${JSON.stringify(pending.versionCode)})`,
        );
      }
    }
  }
  let version = stateVersion;
  let versionCode = null;
  let codeSource = "state.versionCode";
  if (hasPending) {
    version = pendingVersion;
    versionCode = pending === null ? null : pending.versionCode;
    codeSource = "pendingRelease";
  } else if (Number.isInteger(stateVersionCode)) {
    versionCode = stateVersionCode + 1;
    codeSource = `state.versionCode ${stateVersionCode} + 1`;
  }
  return {
    stateVersion,
    stateVersionCode,
    hasPending,
    pending,
    pendingVersion,
    version,
    versionCode,
    codeSource,
  };
}

/** Fact rows from either facts shape, with every field this verifier needs. */
function loadFacts(file, problems) {
  const document = loadJson(file, "apk-facts", problems);
  if (document === undefined) return null;
  const rows = Array.isArray(document)
    ? document
    : Array.isArray(document?.artifacts)
      ? document.artifacts
      : null;
  if (rows === null) {
    problems.push(`apk-facts: ${file} must be a JSON array of fact rows (or an object with "artifacts")`);
    return null;
  }
  if (rows.length === 0) {
    problems.push(`apk-facts: ${file} contains no APK rows`);
    return null;
  }
  const facts = [];
  rows.forEach((row, index) => {
    const at = `apk-facts[${index}]`;
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`${at} must be an object`);
      return;
    }
    for (const field of ["packageName", "versionName", "signerSha256"]) {
      if (typeof row[field] !== "string" || row[field].trim() === "") {
        problems.push(`${at}.${field} must be a non-empty string`);
      }
    }
    if (!Number.isInteger(row.versionCode)) {
      problems.push(`${at}.versionCode must be an integer`);
    }
    if (row.signingChannel !== undefined && typeof row.signingChannel !== "string") {
      problems.push(`${at}.signingChannel must be a string when present`);
    }
    facts.push({
      abi: typeof row.abi === "string" && row.abi.trim() !== "" ? row.abi : `${at}`,
      packageName: row.packageName,
      versionName: row.versionName,
      versionCode: row.versionCode,
      signerSha256: row.signerSha256,
      signingChannel: row.signingChannel,
    });
  });
  return facts;
}

/** minSdkVersion / targetSdkVersion from variables.gradle, as Gradle declares them. */
function loadGradleSdk(file, problems) {
  const text = loadText(file, "variables.gradle", problems);
  if (text === null) return null;
  const minSdk = /^\s*minSdkVersion\s*=\s*['"]?(\d+)['"]?\s*$/m.exec(text);
  const targetSdk = /^\s*targetSdkVersion\s*=\s*['"]?(\d+)['"]?\s*$/m.exec(text);
  if (minSdk === null || targetSdk === null) {
    problems.push(`variables.gradle: cannot derive minSdkVersion and targetSdkVersion from ${file}`);
    return null;
  }
  return { minSdk: Number(minSdk[1]), targetSdk: Number(targetSdk[1]) };
}

/** The independent workspace: it must still exist, its version is not compared. */
function readSharedVersion(file, label) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { version: null, problem: `${label} is missing (the independent workspace must still exist)` };
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return { version: null, problem: `${label} is not valid JSON` };
  }
  if (document === null || typeof document !== "object" || typeof document.version !== "string" || document.version.trim() === "") {
    return { version: null, problem: `${label} has no version string` };
  }
  return { version: document.version, problem: null };
}

function versionShapeProblem(version) {
  if (typeof version !== "string" || version.trim() === "") return "is empty";
  const plus = version.indexOf("+");
  if (plus !== -1) return `carries build metadata ${JSON.stringify(version.slice(plus))}`;
  const dash = version.indexOf("-");
  if (dash !== -1) return `carries prerelease ${JSON.stringify(version.slice(dash))}`;
  if (!PLAIN_VERSION_RE.test(version)) return "is not plain X.Y.Z (no leading zeros, no extra parts)";
  return null;
}

function signerSummary(signer) {
  return typeof signer === "string" ? `${signer.slice(0, 12)}…` : "?";
}

/**
 * Verify one release's artifacts agree. Never throws for a disagreement:
 * every problem becomes a FAIL line. Missing or unreadable required input
 * stops before any check runs, because there is nothing to compare.
 */
export function verifyReleaseConsistency(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const resolvePath = (candidate, fallback) => resolve(root, candidate ?? fallback);
  const inputProblems = [];

  const stateDoc = loadObject(resolvePath(options.stateFile, DEFAULTS.state), "release/state.json", inputProblems);
  const packageDoc = loadObject(resolvePath(options.packageFile, DEFAULTS.package), "package.json", inputProblems);
  const mobileDoc = loadObject(
    resolvePath(options.mobilePackageFile, DEFAULTS.mobile),
    "apps/mobile/package.json",
    inputProblems,
  );
  const lockDoc = loadObject(resolvePath(options.lockFile, DEFAULTS.lock), "package-lock.json", inputProblems);

  let catalogueDoc = null;
  if (options.catalogueFile !== undefined && options.catalogueFile !== null) {
    catalogueDoc = loadObject(resolvePath(options.catalogueFile), "catalogue", inputProblems);
  }

  const facts = options.apkFactsFile !== undefined && options.apkFactsFile !== null
    ? loadFacts(resolvePath(options.apkFactsFile), inputProblems)
    : null;

  // The SDK levels are only needed by the catalogue check, so the Gradle file
  // is only a required input when a catalogue is being verified.
  const gradleSdk = catalogueDoc === null
    ? null
    : loadGradleSdk(resolvePath(options.gradleFile, DEFAULTS.gradle), inputProblems);

  const releaseSource = loadText(
    resolvePath(options.releaseSourceFile, DEFAULTS.releaseSource),
    "apps/mobile/src/services/monitoring/release.ts",
    inputProblems,
  );

  const release = readStateRelease(stateDoc, inputProblems);
  const rootVersion = packageDoc === null ? null : requireString(packageDoc, "version", "package.json", inputProblems);
  const mobileVersion = mobileDoc === null
    ? null
    : requireString(mobileDoc, "version", "apps/mobile/package.json", inputProblems);
  const lockRootVersion = lockDoc === null ? null : lockEntryVersion(lockDoc, "", inputProblems);
  const lockMobileVersion = lockDoc === null ? null : lockEntryVersion(lockDoc, "apps/mobile", inputProblems);

  if (inputProblems.length > 0) {
    return {
      ok: false,
      exitCode: 2,
      version: null,
      versionCode: null,
      checks: [],
      inputProblems,
    };
  }

  const {
    stateVersion,
    stateVersionCode,
    hasPending,
    pending,
    version: canonicalVersion,
    versionCode: canonicalVersionCode,
    codeSource,
  } = release;

  const checks = [];
  const addCheck = (status, name, detail) => {
    checks.push({ name, status, detail });
  };

  // 1. Version agreement. `packages/shared` rides along as an existence
  // assertion; it is deliberately versioned on its own.
  {
    const stateLabel = `${options.stateFile ?? DEFAULTS.state} ${hasPending ? "pendingRelease.version" : "version"}`;
    const versionSources = [
      [stateLabel, canonicalVersion],
      ["package.json", rootVersion],
      ["apps/mobile/package.json", mobileVersion],
      ['package-lock.json packages[""]', lockRootVersion],
      ['package-lock.json packages["apps/mobile"]', lockMobileVersion],
    ];
    const shared = readSharedVersion(
      resolvePath(options.sharedPackageFile, DEFAULTS.shared),
      "packages/shared/package.json",
    );
    const problems = [];
    if (new Set(versionSources.map(([, value]) => value)).size > 1) {
      problems.push(
        `disagreement: ${versionSources
          .map(([label, value]) => `${label}=${JSON.stringify(value)}`)
          .join(", ")}`,
      );
    }
    if (shared.problem !== null) problems.push(shared.problem);
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "version agreement",
      problems.length === 0
        ? `${canonicalVersion} across ${versionSources.length} sources; packages/shared independent at ${shared.version}`
        : problems.join("; "),
    );
  }

  // 2. Version shape: a published release version is plain X.Y.Z, and a
  // pendingRelease must move forward from the version it replaces.
  {
    const problems = [];
    const shape = versionShapeProblem(canonicalVersion);
    if (shape !== null) {
      problems.push(`${canonicalVersion} ${shape}; a release version carries no prerelease or build metadata`);
    }
    if (hasPending && pending !== null) {
      try {
        if (compare(canonicalVersion, stateVersion) !== 1) {
          problems.push(
            `pendingRelease.version ${JSON.stringify(canonicalVersion)} does not sort above ` +
              `state.version ${JSON.stringify(stateVersion)}`,
          );
        }
      } catch {
        problems.push(
          `pendingRelease.version ${JSON.stringify(canonicalVersion)} cannot be compared with ` +
            `state.version ${JSON.stringify(stateVersion)}`,
        );
      }
    }
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "version shape",
      problems.length === 0
        ? `${canonicalVersion} is plain X.Y.Z` +
          (hasPending ? `; pendingRelease sorts above state.version ${stateVersion}` : "")
        : problems.join("; "),
    );
  }

  // 3. Version code: the canonical code is the build's code. A pending release
  // may only carry the one claimable code above the distributed floor.
  {
    const problems = [];
    if (!Number.isInteger(stateVersionCode)) {
      problems.push(`state.versionCode must be an integer (got ${JSON.stringify(stateVersionCode)})`);
    } else if (stateVersionCode < 1 || stateVersionCode > MAX_VERSION_CODE) {
      problems.push(`state.versionCode ${stateVersionCode} is outside 1..${MAX_VERSION_CODE}`);
    }

    if (hasPending && pending !== null && Number.isInteger(stateVersionCode)) {
      if (pending.versionCode !== stateVersionCode + 1) {
        problems.push(
          `pendingRelease.versionCode ${JSON.stringify(pending.versionCode)} is not the ` +
            `expected versionCode ${stateVersionCode + 1} (state.versionCode ${stateVersionCode} + 1)`,
        );
      }
    }

    if (canonicalVersionCode === null) {
      problems.push("expected versionCode cannot be derived from release/state.json");
    } else if (
      !Number.isInteger(canonicalVersionCode) ||
      canonicalVersionCode < 1 ||
      canonicalVersionCode > MAX_VERSION_CODE
    ) {
      problems.push(
        `expected versionCode ${JSON.stringify(canonicalVersionCode)} is outside 1..${MAX_VERSION_CODE}`,
      );
    }

    for (const row of facts ?? []) {
      if (Number.isInteger(canonicalVersionCode) && row.versionCode !== canonicalVersionCode) {
        problems.push(
          `${row.abi} reports versionCode ${JSON.stringify(row.versionCode)}, ` +
            `expected versionCode ${canonicalVersionCode} (${codeSource})`,
        );
      }
      if (row.versionName !== canonicalVersion) {
        problems.push(`${row.abi} reports versionName ${JSON.stringify(row.versionName)}, agreed version is ${canonicalVersion}`);
      }
    }

    const apkDetail = facts === null
      ? " (no --apk-facts)"
      : `; ${facts.length} APK(s) agree on versionName ${canonicalVersion}`;
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "version code",
      problems.length === 0
        ? `versionCode ${canonicalVersionCode} (${codeSource}) is in 1..${MAX_VERSION_CODE}${apkDetail}`
        : problems.join("; "),
    );
  }

  // 4. APK identity: one package, one signing channel, one signer.
  if (facts !== null) {
    const problems = [];
    const signers = new Map();
    for (const row of facts) {
      if (row.packageName !== PACKAGE_NAME) {
        problems.push(`${row.abi}: packageName ${JSON.stringify(row.packageName)} is not ${PACKAGE_NAME}`);
      }
      if (row.signingChannel !== undefined && row.signingChannel !== SIGNING_CHANNEL) {
        problems.push(`${row.abi}: signingChannel ${JSON.stringify(row.signingChannel)} is not ${SIGNING_CHANNEL}`);
      }
      if (!signers.has(row.signerSha256)) signers.set(row.signerSha256, []);
      signers.get(row.signerSha256).push(row.abi);
    }
    if (signers.size > 1) {
      problems.push(
        `${signers.size} different signer fingerprints across the ABIs: ${[...signers]
          .map(([signer, abis]) => `${JSON.stringify(signer)} (${abis.join(", ")})`)
          .join("; ")}`,
      );
    }
    // The published catalogue is the only record that always carries the
    // signing-channel label; the facts file from verify-release-apks.sh does
    // not. Assert it wherever it is declared.
    let channelDeclared = facts.some((row) => row.signingChannel !== undefined);
    for (const [releaseIndex, entry] of (Array.isArray(catalogueDoc?.releases) ? catalogueDoc.releases : []).entries()) {
      const artifacts = Array.isArray(entry?.artifacts) ? entry.artifacts : [];
      if (artifacts.length > 0) channelDeclared = true;
      artifacts.forEach((artifact, artifactIndex) => {
        if (artifact?.signingChannel !== SIGNING_CHANNEL) {
          problems.push(
            `catalogue releases[${releaseIndex}].artifacts[${artifactIndex}].signingChannel ` +
              `${JSON.stringify(artifact?.signingChannel)} is not ${SIGNING_CHANNEL}`,
          );
        }
      });
    }
    const [signer] = signers.keys();
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "APK identity",
      problems.length === 0
        ? `${facts.length} APK(s) ${PACKAGE_NAME}, signer ${signerSummary(signer)} across ${facts.length} ABI row(s)` +
          (channelDeclared ? `, channel ${SIGNING_CHANNEL}` : ", signingChannel not declared by the supplied inputs")
        : problems.join("; "),
    );
  }

  // 5. Catalogue agreement.
  if (catalogueDoc !== null) {
    const problems = [];
    if (catalogueDoc.schemaVersion !== CATALOGUE_SCHEMA_VERSION) {
      problems.push(
        `schemaVersion is ${JSON.stringify(catalogueDoc.schemaVersion)}, the client expects ${CATALOGUE_SCHEMA_VERSION}`,
      );
    }
    if (canonicalVersionCode === null) {
      problems.push(
        "expected versionCode cannot be derived from release/state.json, so catalogue versionCodes cannot be compared",
      );
    }
    const releases = Array.isArray(catalogueDoc.releases) ? catalogueDoc.releases : null;
    if (releases === null) {
      problems.push('"releases" must be an array');
    } else if (releases.length === 0) {
      problems.push("no releases are described (a published catalogue must describe this release)");
    } else {
      releases.forEach((entry, index) => {
        const at = `releases[${index}]`;
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          problems.push(`${at} must be an object`);
          return;
        }
        if (entry.versionName !== canonicalVersion) {
          problems.push(`${at}.versionName ${JSON.stringify(entry.versionName)} is not the agreed ${canonicalVersion}`);
        }
        if (entry.tag !== `v${entry.versionName}`) {
          problems.push(`${at}.tag ${JSON.stringify(entry.tag)} is not v${entry.versionName}`);
        }
        if (canonicalVersionCode !== null && entry.versionCode !== canonicalVersionCode) {
          problems.push(
            `${at}.versionCode ${JSON.stringify(entry.versionCode)} is not ` +
              `expected versionCode ${canonicalVersionCode} (${codeSource})`,
          );
        }
        const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
        if (artifacts.length === 0) {
          problems.push(`${at}.artifacts is empty (no SDK levels to compare with variables.gradle)`);
        }
        artifacts.forEach((artifact, artifactIndex) => {
          const artifactAt = `${at}.artifacts[${artifactIndex}]`;
          if (artifact?.minSdk !== gradleSdk.minSdk) {
            problems.push(`${artifactAt}.minSdk ${JSON.stringify(artifact?.minSdk)} is not variables.gradle ${gradleSdk.minSdk}`);
          }
          if (artifact?.targetSdk !== gradleSdk.targetSdk) {
            problems.push(
              `${artifactAt}.targetSdk ${JSON.stringify(artifact?.targetSdk)} is not variables.gradle ${gradleSdk.targetSdk}`,
            );
          }
        });
      });
    }
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "catalogue agreement",
      problems.length === 0
        ? `schemaVersion ${CATALOGUE_SCHEMA_VERSION}; ${releases.length} release(s) at ` +
          `${canonicalVersion}/${canonicalVersionCode}; SDK ${gradleSdk.minSdk}/${gradleSdk.targetSdk}`
        : problems.join("; "),
    );
  }

  // 6. Tag agreement.
  if (options.tag !== undefined && options.tag !== null) {
    const expectedTag = `v${canonicalVersion}`;
    addCheck(
      options.tag === expectedTag ? "PASS" : "FAIL",
      "tag agreement",
      options.tag === expectedTag
        ? `${options.tag} matches the agreed version`
        : `tag ${JSON.stringify(options.tag)} is not ${JSON.stringify(expectedTag)}`,
    );
  }

  // 7. Expectations: the values the publisher decided before building.
  if (
    (options.expectVersion !== undefined && options.expectVersion !== null) ||
    (options.expectVersionCode !== undefined && options.expectVersionCode !== null)
  ) {
    const problems = [];
    if (options.expectVersion !== undefined && options.expectVersion !== null && options.expectVersion !== canonicalVersion) {
      problems.push(`expected version ${JSON.stringify(options.expectVersion)}, agreed version is ${canonicalVersion}`);
    }
    if (options.expectVersionCode !== undefined && options.expectVersionCode !== null) {
      if (canonicalVersionCode === null) {
        problems.push("expected versionCode cannot be derived from release/state.json");
      } else if (options.expectVersionCode !== canonicalVersionCode) {
        problems.push(
          `expected versionCode ${JSON.stringify(options.expectVersionCode)}, ` +
            `agreed versionCode is ${canonicalVersionCode} (${codeSource})`,
        );
      }
    }
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "expectations",
      problems.length === 0
        ? `publisher expectations ${canonicalVersion}/${canonicalVersionCode} match the release`
        : problems.join("; "),
    );
  }

  // 8. Sentry identity: one namespace, and the version token is the agreed
  // version. The mint itself is imported from its canonical owner so this
  // check can never drift into a second implementation.
  {
    const problems = [];
    if (SENTRY_RELEASE_MOBILE_NAMESPACE !== SENTRY_NAMESPACE) {
      problems.push(
        `scripts/build-context.mjs mints namespace ${JSON.stringify(SENTRY_RELEASE_MOBILE_NAMESPACE)} instead of ${SENTRY_NAMESPACE}`,
      );
    }
    let minted = null;
    try {
      minted = sentryRelease({ version: canonicalVersion, short12: SENTRY_SAMPLE_SHORT12 });
    } catch {
      problems.push(
        `scripts/build-context.mjs cannot mint ${SENTRY_NAMESPACE}@${canonicalVersion} ` +
          "(the version is not a token it accepts)",
      );
    }
    if (minted !== null && minted !== `${SENTRY_NAMESPACE}@${canonicalVersion}+${SENTRY_SAMPLE_SHORT12}`) {
      problems.push(
        `scripts/build-context.mjs minted ${JSON.stringify(minted)} instead of ` +
          `${SENTRY_NAMESPACE}@${canonicalVersion}+<short12>`,
      );
    }
    const prefix = /export const SENTRY_RELEASE_PREFIX = "([^"]*)"/.exec(releaseSource ?? "");
    if (prefix === null) {
      problems.push("apps/mobile/src/services/monitoring/release.ts no longer declares SENTRY_RELEASE_PREFIX");
    } else if (prefix[1] !== SENTRY_NAMESPACE) {
      problems.push(
        `apps/mobile/src/services/monitoring/release.ts mints ${JSON.stringify(`${prefix[1]}@…`)} instead of ${JSON.stringify(`${SENTRY_NAMESPACE}@…`)}`,
      );
    }
    // The mint template, anchored on the namespace constant and the two
    // interpolated tokens; the surrounding backticks are not part of the claim.
    const template = /SENTRY_RELEASE_PREFIX\}@\$\{([^}]+)\}\+\$\{([^}]+)\}/.exec(releaseSource ?? "");
    if (template === null) {
      problems.push("apps/mobile/src/services/monitoring/release.ts no longer builds `<namespace>@<version>+<sha>`");
    } else {
      if (!/version/i.test(template[1])) {
        problems.push(`apps/mobile/src/services/monitoring/release.ts puts \${${template[1]}} where the version belongs`);
      }
      if (!/sha/i.test(template[2])) {
        problems.push(`apps/mobile/src/services/monitoring/release.ts puts \${${template[2]}} where the commit sha belongs`);
      }
    }
    addCheck(
      problems.length === 0 ? "PASS" : "FAIL",
      "Sentry identity",
      problems.length === 0
        ? `${SENTRY_NAMESPACE}@${canonicalVersion}+<short12> in scripts/build-context.mjs and release.ts`
        : problems.join("; "),
    );
  }

  const failed = checks.some((check) => check.status === "FAIL");
  return {
    ok: !failed,
    exitCode: failed ? 1 : 0,
    version: canonicalVersion,
    versionCode: canonicalVersionCode,
    checks,
    inputProblems: [],
  };
}

/** One line per check, in check order. */
export function formatReport(report) {
  return report.checks.map((check) => `${check.status} ${check.name}: ${check.detail}`);
}

const FLAG_TO_OPTION = Object.freeze({
  "--state": "stateFile",
  "--package": "packageFile",
  "--mobile-package": "mobilePackageFile",
  "--lock": "lockFile",
  "--catalogue": "catalogueFile",
  "--apk-facts": "apkFactsFile",
  "--tag": "tag",
  "--expect-version": "expectVersion",
  "--expect-version-code": "expectVersionCode",
});

const REQUIRED_FLAGS = Object.freeze(["--state", "--package", "--mobile-package", "--lock"]);

function parseArgs(argv) {
  const options = { json: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const option = FLAG_TO_OPTION[arg];
    if (option === undefined) fail(`unknown argument ${JSON.stringify(arg)}`);
    const value = argv[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      fail(`${arg} requires a value`);
    }
    index += 1;
    seen.add(arg);
    if (arg === "--expect-version-code") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        fail(`--expect-version-code must be a positive integer (got ${JSON.stringify(value)})`);
      }
      options.expectVersionCode = parsed;
      continue;
    }
    options[option] = value;
  }
  for (const flag of REQUIRED_FLAGS) {
    if (!seen.has(flag)) fail(`${flag} is required`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = verifyReleaseConsistency(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }

  for (const problem of report.inputProblems) process.stderr.write(`verify-consistency: ${problem}\n`);
  for (const line of formatReport(report)) process.stdout.write(`${line}\n`);
  if (report.exitCode === 1) {
    const failed = report.checks.filter((check) => check.status === "FAIL").length;
    process.stderr.write(`verify-consistency: FAIL (${failed} of ${report.checks.length} checks disagree on the release)\n`);
  } else if (report.exitCode === 0) {
    process.stdout.write(`verify-consistency: PASS (${report.checks.length} checks agree on ${report.version})\n`);
  }
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error.message.startsWith("verify-consistency:") ? error.message : `verify-consistency: ${error.message}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}
