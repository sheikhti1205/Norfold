#!/usr/bin/env node
/**
 * Tests for scripts/release/verify-consistency.mjs.
 *
 * Every case writes a complete fixture tree to a temp directory and calls the
 * verifier in-process. The mobile release source is copied from the real file
 * so the Sentry-identity parsing is proven against the code that actually
 * ships, not a hand-written imitation. No git, no Gradle, no child processes.
 *
 * Fixtures mirror a prepare-time state: a `pendingRelease` carries the release
 * being assembled while the top-level version stays at the previously assigned
 * prerelease.
 *
 * Run: `node --test scripts/release/verify-consistency.test.mjs` from repo root.
 * Pure Node builtins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyReleaseConsistency } from "./verify-consistency.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_RELEASE_SOURCE = readFileSync(
  join(REPO_ROOT, "apps/mobile/src/services/monitoring/release.ts"),
  "utf8",
);

const STATE_VERSION = "0.16.0-beta.3";
const STATE_CODE = 101077;
const RELEASE_VERSION = "0.16.0";
const RELEASE_CODE = 101078;
const SIGNER = "b".repeat(64);
const OTHER_SIGNER = "c".repeat(64);
const GIT_SHA = "c".repeat(40);

/**
 * The exact record release.yml writes at prepare time: `{ tag, version,
 * versionCode }`, with no commit SHA and no timestamp (nothing is published
 * yet, so a timestamp would be a lie and validateState rejects one).
 */
function pendingRelease(overrides = {}) {
  return {
    tag: `v${RELEASE_VERSION}`,
    version: RELEASE_VERSION,
    versionCode: RELEASE_CODE,
    ...overrides,
  };
}

function state({ version = STATE_VERSION, versionCode = STATE_CODE, pending = pendingRelease() } = {}) {
  return {
    schemaVersion: 1,
    channel: "beta",
    version,
    versionCode,
    classificationBase: "a".repeat(40),
    pendingRelease: pending,
    lastRelease: null,
  };
}

function lock(rootVersion = RELEASE_VERSION, mobileVersion = RELEASE_VERSION) {
  return {
    name: "norfold",
    version: rootVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "norfold", version: rootVersion },
      "apps/mobile": { name: "@norfold/mobile", version: mobileVersion },
      "packages/shared": { name: "@norfold/shared", version: "0.1.0" },
    },
  };
}

/** One fact row in the shape scripts/verify-release-apks.sh writes. */
function fact(abi, overrides = {}) {
  return {
    abi,
    abis: [abi],
    packageName: "com.findback.app",
    versionName: RELEASE_VERSION,
    versionCode: RELEASE_CODE,
    minSdk: 24,
    targetSdk: 36,
    signerSha256: SIGNER,
    ...overrides,
  };
}

/** One catalogue artifact in the shape write-android-catalogue.mjs writes. */
function artifact(overrides = {}) {
  return {
    url: `https://github.com/example/Norfold/releases/download/v${RELEASE_VERSION}/Norfold-v${RELEASE_VERSION}-arm64-v8a.apk`,
    bytes: 2048,
    sha256: "d".repeat(64),
    packageName: "com.findback.app",
    signingChannel: "beta",
    signerSha256: SIGNER,
    abis: ["arm64-v8a"],
    minSdk: 24,
    targetSdk: 36,
    ...overrides,
  };
}

/** One catalogue in the shape write-android-catalogue.mjs writes. */
function catalogue({ release = {}, artifacts = null } = {}) {
  return {
    schemaVersion: 1,
    releases: [
      {
        id: `v${RELEASE_VERSION}`,
        platform: "android",
        versionName: RELEASE_VERSION,
        versionCode: RELEASE_CODE,
        gitSha: GIT_SHA,
        tag: `v${RELEASE_VERSION}`,
        publishedAt: "2026-11-20T10:00:00.000Z",
        summary: "Fixture release.",
        accepted: true,
        ...release,
        artifacts: artifacts ?? [artifact()],
      },
    ],
    history: [],
    features: [],
  };
}

function writeTree({
  stateVersion = STATE_VERSION,
  stateCode = STATE_CODE,
  pending = pendingRelease(),
  version = RELEASE_VERSION,
  rootVersion = version,
  mobileVersion = version,
  lockVersion = version,
  lockMobileVersion = version,
  sharedVersion = "0.1.0",
  files = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "norfold-consistency-"));
  const contents = {
    "release/state.json": JSON.stringify(state({ version: stateVersion, versionCode: stateCode, pending })),
    "package.json": JSON.stringify({
      name: "norfold",
      private: true,
      version: rootVersion,
      workspaces: ["apps/mobile", "packages/shared"],
    }),
    "apps/mobile/package.json": JSON.stringify({ name: "@norfold/mobile", private: true, version: mobileVersion }),
    "package-lock.json": JSON.stringify(lock(lockVersion, lockMobileVersion)),
    "packages/shared/package.json": JSON.stringify({ name: "@norfold/shared", version: sharedVersion }),
    "apps/mobile/android/variables.gradle": [
      "ext {",
      "    minSdkVersion = 24",
      "    compileSdkVersion = 36",
      "    targetSdkVersion = 36",
      "}",
      "",
    ].join("\n"),
    "apps/mobile/src/services/monitoring/release.ts": REAL_RELEASE_SOURCE,
    ...files,
  };
  for (const [relative, body] of Object.entries(contents)) {
    const full = join(root, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/** A tree that also carries a catalogue and APK facts, as a publisher would. */
function releaseTree({ catalogueDoc = catalogue(), facts = [fact("arm64-v8a"), fact("armeabi-v7a")], ...options } = {}) {
  return writeTree({
    ...options,
    files: {
      "catalogue.v1.json": JSON.stringify(catalogueDoc),
      "apk-facts.json": JSON.stringify(facts),
      ...(options.files ?? {}),
    },
  });
}

function verifyWithCatalogue(root, extra = {}) {
  return verifyReleaseConsistency({
    root,
    catalogueFile: "catalogue.v1.json",
    apkFactsFile: "apk-facts.json",
    ...extra,
  });
}

function check(report, name) {
  const found = report.checks.find((entry) => entry.name === name);
  assert.ok(found, `no check named "${name}" in ${JSON.stringify(report.checks.map((entry) => entry.name))}`);
  return found;
}

function assertAllPass(report) {
  for (const entry of report.checks) {
    assert.equal(entry.status, "PASS", `${entry.name} failed: ${entry.detail}`);
  }
  assert.equal(report.exitCode, 0);
}

test("a pending release is verified against the canonical pair: exit 0 with every check PASS", () => {
  const root = releaseTree();
  const report = verifyWithCatalogue(root, {
    tag: `v${RELEASE_VERSION}`,
    expectVersion: RELEASE_VERSION,
    expectVersionCode: RELEASE_CODE,
  });

  assert.deepEqual(
    report.checks.map((entry) => entry.name),
    [
      "version agreement",
      "version shape",
      "version code",
      "APK identity",
      "catalogue agreement",
      "tag agreement",
      "expectations",
      "Sentry identity",
    ],
  );
  assertAllPass(report);
  assert.equal(report.version, RELEASE_VERSION);
  assert.equal(report.versionCode, RELEASE_CODE);
  assert.deepEqual(report.inputProblems, []);
});

test("a package still at the previously assigned version fails and names both values", () => {
  const root = writeTree({ mobileVersion: STATE_VERSION });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 1);
  const agreement = check(report, "version agreement");
  assert.equal(agreement.status, "FAIL");
  assert.match(agreement.detail, /release\/state\.json pendingRelease\.version="0\.16\.0"/);
  assert.match(agreement.detail, /apps\/mobile\/package\.json="0\.16\.0-beta\.3"/);
});

test("a root/mobile version disagreement fails and names both values", () => {
  const root = writeTree({ mobileVersion: "0.16.1" });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 1);
  const agreement = check(report, "version agreement");
  assert.equal(agreement.status, "FAIL");
  assert.match(agreement.detail, /package\.json="0\.16\.0"/);
  assert.match(agreement.detail, /apps\/mobile\/package\.json="0\.16\.1"/);
});

test("a stale lockfile apps/mobile version is a disagreement", () => {
  const root = writeTree({ lockMobileVersion: "0.15.9" });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 1);
  const agreement = check(report, "version agreement");
  assert.equal(agreement.status, "FAIL");
  assert.match(agreement.detail, /package-lock\.json packages\["apps\/mobile"\]="0\.15\.9"/);
});

test("the agreed version must be plain X.Y.Z: a prerelease fails", () => {
  const root = writeTree({ pending: null, stateVersion: "0.16.0-beta.1", version: "0.16.0-beta.1" });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 1);
  assert.equal(check(report, "version agreement").status, "PASS");
  const shape = check(report, "version shape");
  assert.equal(shape.status, "FAIL");
  assert.match(shape.detail, /prerelease "-beta\.1"/);
});

test("the agreed version must be plain X.Y.Z: build metadata fails", () => {
  const root = writeTree({ pending: null, stateVersion: "0.16.0+build.7", version: "0.16.0+build.7" });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 1);
  const shape = check(report, "version shape");
  assert.equal(shape.status, "FAIL");
  assert.match(shape.detail, /build metadata "\+build\.7"/);
});

test("an APK carrying the already distributed versionCode fails and names the expected one", () => {
  const root = releaseTree({ facts: [fact("arm64-v8a", { versionCode: 101077 })] });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 1);
  const versionCode = check(report, "version code");
  assert.equal(versionCode.status, "FAIL");
  assert.match(versionCode.detail, /arm64-v8a reports versionCode 101077, expected versionCode 101078 \(pendingRelease\)/);
});

test("two APKs with different signer fingerprints fail and name both", () => {
  const root = releaseTree({
    facts: [
      fact("arm64-v8a", { signerSha256: SIGNER }),
      fact("armeabi-v7a", { signerSha256: OTHER_SIGNER }),
    ],
  });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 1);
  const identity = check(report, "APK identity");
  assert.equal(identity.status, "FAIL");
  assert.match(identity.detail, /2 different signer fingerprints/);
  assert.ok(identity.detail.includes(SIGNER), "the arm64 signer must be named");
  assert.ok(identity.detail.includes(OTHER_SIGNER), "the armeabi signer must be named");
  assert.match(identity.detail, /arm64-v8a/);
  assert.match(identity.detail, /armeabi-v7a/);
});

test("a catalogue tag that is not v+versionName fails", () => {
  const root = releaseTree({ catalogueDoc: catalogue({ release: { tag: "android-latest" } }) });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 1);
  const agreement = check(report, "catalogue agreement");
  assert.equal(agreement.status, "FAIL");
  assert.match(agreement.detail, /releases\[0\]\.tag "android-latest" is not v0\.16\.0/);
});

test("a catalogue minSdk that disagrees with variables.gradle fails", () => {
  const root = releaseTree({ catalogueDoc: catalogue({ artifacts: [artifact({ minSdk: 23 })] }) });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 1);
  const agreement = check(report, "catalogue agreement");
  assert.equal(agreement.status, "FAIL");
  assert.match(agreement.detail, /releases\[0\]\.artifacts\[0\]\.minSdk 23 is not variables\.gradle 24/);
});

test("a tag that does not match the agreed version fails", () => {
  const root = releaseTree();
  const report = verifyWithCatalogue(root, { tag: "v0.15.0" });

  assert.equal(report.exitCode, 1);
  const tag = check(report, "tag agreement");
  assert.equal(tag.status, "FAIL");
  assert.match(tag.detail, /tag "v0\.15\.0" is not "v0\.16\.0"/);
});

test("an --expect-version mismatch fails", () => {
  const root = releaseTree();
  const report = verifyWithCatalogue(root, { expectVersion: "0.15.0" });

  assert.equal(report.exitCode, 1);
  const expectations = check(report, "expectations");
  assert.equal(expectations.status, "FAIL");
  assert.match(expectations.detail, /expected version "0\.15\.0", agreed version is 0\.16\.0/);
});

test("--expect-version-code must equal the canonical code", () => {
  const pass = verifyWithCatalogue(releaseTree(), { expectVersionCode: RELEASE_CODE });
  assert.equal(pass.exitCode, 0);
  assert.equal(check(pass, "expectations").status, "PASS");

  const fail = verifyWithCatalogue(releaseTree(), { expectVersionCode: STATE_CODE });
  assert.equal(fail.exitCode, 1);
  const expectations = check(fail, "expectations");
  assert.equal(expectations.status, "FAIL");
  assert.match(expectations.detail, /expected versionCode 101077, agreed versionCode is 101078 \(pendingRelease\)/);
});

test("a pending release whose code is not state.versionCode + 1 fails", () => {
  const root = releaseTree({
    pending: pendingRelease({ versionCode: 101079 }),
    facts: [fact("arm64-v8a", { versionCode: 101079 })],
    catalogueDoc: catalogue({ release: { versionCode: 101079 } }),
  });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 1);
  const versionCode = check(report, "version code");
  assert.equal(versionCode.status, "FAIL");
  assert.match(
    versionCode.detail,
    /pendingRelease\.versionCode 101079 is not the expected versionCode 101078 \(state\.versionCode 101077 \+ 1\)/,
  );
});

test("a pending release whose version does not sort above state.version fails", () => {
  const root = releaseTree({ stateVersion: "0.17.0" });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 1);
  const shape = check(report, "version shape");
  assert.equal(shape.status, "FAIL");
  assert.match(shape.detail, /pendingRelease\.version "0\.16\.0" does not sort above state\.version "0\.17\.0"/);
});

test("without a pending release the agreed code is state.versionCode + 1", () => {
  const root = releaseTree({ pending: null, stateVersion: RELEASE_VERSION });
  const report = verifyWithCatalogue(root);

  assert.equal(report.exitCode, 0);
  assert.equal(report.version, RELEASE_VERSION);
  assert.equal(report.versionCode, RELEASE_CODE);
  const versionCode = check(report, "version code");
  assert.equal(versionCode.status, "PASS");
  assert.match(versionCode.detail, /state\.versionCode 101077 \+ 1/);
});

test("a missing catalogue file is an unparseable required input", () => {
  const root = releaseTree();
  const report = verifyReleaseConsistency({ root, catalogueFile: "catalogue-missing.v1.json" });

  assert.equal(report.exitCode, 2);
  assert.deepEqual(report.checks, []);
  assert.equal(report.inputProblems.length > 0, true);
  assert.match(report.inputProblems.join("\n"), /catalogue: cannot read/);
});

test("malformed JSON is an unparseable required input", () => {
  const root = writeTree({ files: { "release/state.json": "{ not json" } });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 2);
  assert.deepEqual(report.checks, []);
  assert.match(report.inputProblems.join("\n"), /release\/state\.json: is not valid JSON/);
});

test("packages/shared at a different version is not compared", () => {
  const root = writeTree({ sharedVersion: "9.9.9" });
  const report = verifyReleaseConsistency({ root });

  assert.equal(report.exitCode, 0);
  const agreement = check(report, "version agreement");
  assert.equal(agreement.status, "PASS");
  assert.match(agreement.detail, /packages\/shared independent at 9\.9\.9/);
});
