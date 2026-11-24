#!/usr/bin/env node
/**
 * Tests for scripts/release/sync-version.mjs.
 *
 * Run: `node --test scripts/release/sync-version.test.mjs` from repo root.
 * Pure Node builtins; no process is spawned and the real repository is never
 * touched. Every case works on a fixture tree in a temp directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readVersions, syncVersion, verifyVersion } from "./sync-version.mjs";

const ROOT_PACKAGE = {
  name: "norfold",
  private: true,
  version: "0.15.0",
  workspaces: ["apps/mobile", "packages/shared"],
  devDependencies: { typescript: "~5.9.3" },
};

const MOBILE_PACKAGE = {
  name: "@norfold/mobile",
  private: true,
  version: "0.15.0",
  type: "module",
  dependencies: {
    "@norfold/shared": "*",
    "@supabase/supabase-js": "2.116.0",
  },
};

const LOCKFILE = {
  name: "norfold",
  version: "0.15.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "norfold",
      version: "0.15.0",
      workspaces: ["apps/mobile", "packages/shared"],
      dependencies: { "@supabase/server": "^1.6.0" },
    },
    "apps/mobile": {
      name: "@norfold/mobile",
      version: "0.15.0",
      dependencies: { "@norfold/shared": "*" },
    },
    "packages/shared": {
      name: "@norfold/shared",
      version: "0.1.0",
    },
    "node_modules/zod": {
      version: "4.6.6",
    },
  },
};

const SHARED_PACKAGE = {
  name: "@norfold/shared",
  version: "0.1.0",
  private: true,
  type: "module",
  dependencies: { zod: "^4.6.6" },
};

const TARGET_FILES = ["package.json", "apps/mobile/package.json", "package-lock.json"];
const ALL_FILES = [...TARGET_FILES, "packages/shared/package.json"];

function writeFileAt(repoDir, relativePath, text) {
  const file = join(repoDir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

function writeCrlf(repoDir, relativePath, text) {
  writeFileAt(repoDir, relativePath, text.replace(/\n/g, "\r\n"));
}

/** A fixture tree whose target files are CRLF and whose shared package is LF. */
function fixture() {
  const repoDir = mkdtempSync(join(tmpdir(), "norfold-sync-version-"));
  writeCrlf(repoDir, "package.json", `${JSON.stringify(ROOT_PACKAGE, null, 2)}\n`);
  writeCrlf(repoDir, "apps/mobile/package.json", `${JSON.stringify(MOBILE_PACKAGE, null, 2)}\n`);
  writeCrlf(repoDir, "package-lock.json", `${JSON.stringify(LOCKFILE, null, 2)}\n`);
  writeFileAt(repoDir, "packages/shared/package.json", `${JSON.stringify(SHARED_PACKAGE, null, 2)}\n`);
  return repoDir;
}

function snapshot(repoDir) {
  return Object.fromEntries(ALL_FILES.map((file) => [file, readFileSync(join(repoDir, file))]));
}

function linesWithEndings(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** The 1-based lines that are expected to change for a fixture file. */
function versionLineNumbers(file, text) {
  const indent = file === "package-lock.json" ? 6 : 2;
  const expected = `${" ".repeat(indent)}"version": "0.15.0",`;
  return linesWithEndings(text)
    .map((line, index) => ({ line: line.replace(/\r?\n$/, ""), number: index + 1 }))
    .filter(({ line }) => line === expected)
    .map(({ number }) => number);
}

function writeState(repoDir, version) {
  writeFileAt(
    repoDir,
    "release/state.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        channel: "beta",
        version,
        versionCode: 101077,
        classificationBase: "a".repeat(40),
        pendingRelease: null,
        lastRelease: null,
      },
      null,
      2,
    )}\n`,
  );
}

test("writes the version to all four places", () => {
  const repoDir = fixture();
  try {
    const result = syncVersion(repoDir, "0.16.0");
    assert.equal(result.already, false);
    assert.equal(result.version, "0.16.0");
    assert.deepEqual(result.changedFiles, [
      "package.json",
      "apps/mobile/package.json",
      "package-lock.json",
    ]);
    assert.deepEqual(readVersions(repoDir), {
      root: "0.16.0",
      mobile: "0.16.0",
      lockRoot: "0.16.0",
      lockMobile: "0.16.0",
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("changes only the version lines and leaves every other byte alone", () => {
  const repoDir = fixture();
  try {
    const before = snapshot(repoDir);
    syncVersion(repoDir, "0.16.0");
    const after = snapshot(repoDir);

    assert.deepEqual(after["packages/shared/package.json"], before["packages/shared/package.json"]);

    for (const file of TARGET_FILES) {
      const beforeText = before[file].toString("utf8");
      const afterText = after[file].toString("utf8");
      const beforeLines = linesWithEndings(beforeText);
      const afterLines = linesWithEndings(afterText);
      assert.equal(afterLines.length, beforeLines.length, `${file} keeps its line count`);

      const changed = [];
      for (let index = 0; index < beforeLines.length; index += 1) {
        if (beforeLines[index] === afterLines[index]) continue;
        changed.push(index + 1);
        assert.equal(
          afterLines[index],
          beforeLines[index].replace('"0.15.0"', '"0.16.0"'),
          `${file} line ${index + 1} differs only by the version`,
        );
      }
      assert.deepEqual(changed, versionLineNumbers(file, beforeText), `${file} version lines only`);
    }

    // The lockfile's own top-level version is outside the four places.
    assert.equal(JSON.parse(after["package-lock.json"].toString("utf8")).version, "0.15.0");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("verify passes after a sync and fails after editing any of the four places", () => {
  const edits = [
    { file: "package.json", before: '"version": "0.16.0"', after: '"version": "0.16.1"' },
    { file: "apps/mobile/package.json", before: '"version": "0.16.0"', after: '"version": "0.16.1"' },
    {
      file: "package-lock.json",
      before: '"": {\r\n      "name": "norfold",\r\n      "version": "0.16.0",',
      after: '"": {\r\n      "name": "norfold",\r\n      "version": "0.16.1",',
    },
    {
      file: "package-lock.json",
      before: '"apps/mobile": {\r\n      "name": "@norfold/mobile",\r\n      "version": "0.16.0",',
      after: '"apps/mobile": {\r\n      "name": "@norfold/mobile",\r\n      "version": "0.16.1",',
    },
  ];

  for (const edit of edits) {
    const repoDir = fixture();
    try {
      syncVersion(repoDir, "0.16.0");
      assert.deepEqual(verifyVersion(repoDir, "0.16.0").errors, [], `${edit.file} starts in sync`);

      const file = join(repoDir, edit.file);
      const text = readFileSync(file, "utf8");
      const edited = text.replace(edit.before, edit.after);
      assert.notEqual(edited, text, `${edit.file} fixture carries the edit anchor`);
      writeFileSync(file, edited, "utf8");

      const result = verifyVersion(repoDir, "0.16.0");
      assert.equal(result.ok, false, edit.file);
      assert.equal(result.errors.length, 1, edit.file);
      assert.ok(result.errors[0].includes(edit.file), `${edit.file} is named in ${result.errors[0]}`);
      assert.equal(result.entries.filter((entry) => entry.ok).length, 3, `${edit.file} leaves the others intact`);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }
});

test("rejects a prerelease version", () => {
  const repoDir = fixture();
  try {
    const before = snapshot(repoDir);
    assert.throws(() => syncVersion(repoDir, "0.16.0-beta.3"), /prerelease suffix/);
    assert.deepEqual(snapshot(repoDir), before);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("rejects build metadata", () => {
  const repoDir = fixture();
  try {
    const before = snapshot(repoDir);
    assert.throws(() => syncVersion(repoDir, "0.16.0+build.1"), /build metadata/);
    assert.deepEqual(snapshot(repoDir), before);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("a second run is a byte-identical no-op", () => {
  const repoDir = fixture();
  try {
    syncVersion(repoDir, "0.16.0");
    const first = snapshot(repoDir);
    const second = syncVersion(repoDir, "0.16.0");
    assert.equal(second.already, true);
    assert.deepEqual(second.changedFiles, []);
    assert.deepEqual(snapshot(repoDir), first);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("never touches packages/shared", () => {
  const repoDir = fixture();
  try {
    const before = snapshot(repoDir);
    syncVersion(repoDir, "0.16.0");
    const after = snapshot(repoDir);
    assert.deepEqual(after["packages/shared/package.json"], before["packages/shared/package.json"]);
    assert.equal(JSON.parse(after["packages/shared/package.json"].toString("utf8")).version, "0.1.0");
    assert.equal(
      JSON.parse(after["package-lock.json"].toString("utf8")).packages["packages/shared"].version,
      "0.1.0",
    );
    assert.deepEqual(Object.keys(readVersions(repoDir)).sort(), ["lockMobile", "lockRoot", "mobile", "root"]);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("CRLF fixtures stay CRLF", () => {
  const repoDir = fixture();
  try {
    syncVersion(repoDir, "0.16.0");
    for (const file of TARGET_FILES) {
      const text = readFileSync(join(repoDir, file), "utf8");
      assert.ok(text.endsWith("\r\n"), `${file} keeps its trailing CRLF`);
      assert.doesNotMatch(text, /(^|[^\r])\n/, `${file} has no bare LF`);
    }
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("verify without a version compares the four places and release/state.json", () => {
  const repoDir = fixture();
  try {
    syncVersion(repoDir, "0.16.0");

    const withoutState = verifyVersion(repoDir);
    assert.equal(withoutState.ok, true);
    assert.equal(withoutState.reference, "0.16.0");
    assert.equal(withoutState.entries.length, 4);

    writeState(repoDir, "0.16.0");
    const withState = verifyVersion(repoDir);
    assert.equal(withState.ok, true);
    assert.equal(withState.entries.length, 5);
    assert.ok(withState.entries.some((entry) => entry.file === "release/state.json"));

    writeState(repoDir, "0.17.0");
    const disagreeing = verifyVersion(repoDir);
    assert.equal(disagreeing.ok, false);
    assert.equal(disagreeing.errors.length, 1);
    assert.match(disagreeing.errors[0], /release\/state\.json/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
