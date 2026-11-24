#!/usr/bin/env node
/**
 * Tests for scripts/release/classify.mjs.
 *
 * Run: `node --test scripts/release/classify.test.mjs` from repo root.
 * Pure Node builtins; no git, no filesystem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyCommit, impactRank, isShippedPath, maxImpact } from "./classify.mjs";

const CLASSIFY_CASES = [
  {
    name: "docs-only commit is none",
    input: { subject: "docs: describe the release flow", files: ["docs/RELEASE.md"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "fix is patch",
    input: { subject: "fix: stop the double submit", files: ["apps/mobile/src/foo.ts"] },
    expected: { impact: "patch", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "perf is patch",
    input: { subject: "perf: cut the map re-render", files: ["apps/mobile/src/map.tsx"] },
    expected: { impact: "patch", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "feat is minor",
    input: { subject: "feat: add the offline queue", files: ["apps/mobile/src/queue.ts"] },
    expected: { impact: "minor", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "feat! is major",
    input: { subject: "feat(api)!: drop the legacy ids", files: [] },
    expected: { impact: "major", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "chore! is major",
    input: { subject: "chore!: rework the storage layout", files: [] },
    expected: { impact: "major", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "BREAKING CHANGE footer is major",
    input: { subject: "fix: tighten scope validation", body: "BREAKING CHANGE: empty scopes are rejected", files: [] },
    expected: { impact: "major", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "BREAKING-CHANGE footer is major",
    input: { subject: "refactor: move the store", body: "BREAKING-CHANGE: store shape changed", files: [] },
    expected: { impact: "major", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "hand-written revert is none when nothing shipped changed",
    input: { subject: "revert: undo the offline queue", files: [] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false, revert: false },
  },
  {
    name: "hand-written revert touching shipped code is escalated",
    input: { subject: "revert: undo the offline queue", files: ["apps/mobile/src/foo.ts"] },
    expected: { impact: "patch", escalated: true, unparseable: false, merge: false, revert: false },
  },
  {
    name: "generated revert is none and never escalated",
    input: {
      subject: 'Revert "feat: add the offline queue"',
      body: "This reverts commit 4f2c9a1.",
      files: ["apps/mobile/src/foo.ts", "supabase/migrations/0022_x.sql"],
    },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false, revert: true },
  },
  {
    name: "generated revert of a docs commit is none",
    input: { subject: 'Revert "docs: explain the release flow"', files: ["docs/RELEASE.md"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false, revert: true },
  },
  {
    name: "Revert with trailing text is not the generated form",
    input: { subject: 'Revert "feat: add the offline queue" (again)', files: [] },
    expected: { impact: "none", escalated: false, unparseable: true, merge: false, revert: false },
  },
  {
    name: "build changing dependencies is patch",
    input: { subject: "build: bump capacitor", files: ["apps/mobile/package.json", "package-lock.json"] },
    expected: { impact: "patch", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "build changing shared dependencies is patch",
    input: { subject: "build(deps): bump zod", files: ["packages/shared/package.json"] },
    expected: { impact: "patch", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "build touching no manifest is none",
    input: { subject: "build: retry the gradle cache", files: ["apps/mobile/android/build.gradle"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "chore touching shipped source is escalated to patch",
    input: { subject: "chore: tidy imports", files: ["apps/mobile/src/foo.ts"] },
    expected: { impact: "patch", escalated: true, unparseable: false, merge: false },
  },
  {
    name: "chore touching only docs stays none",
    input: { subject: "chore: refresh the screenshots doc", files: ["docs/SCREENS.md"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "chore touching only scripts stays none",
    input: { subject: "chore: reformat a gate script", files: ["scripts/audit-gate.mjs"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "ci touching workflows stays none",
    input: { subject: "ci: retry flaky android job", files: [".github/workflows/android-builds.yml"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "test touching a test file stays none",
    input: { subject: "test: cover the queue", files: ["apps/mobile/src/queue.test.ts"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "chore touching supabase migrations is escalated",
    input: { subject: "chore: rename an index", files: ["supabase/migrations/0021_index.sql"] },
    expected: { impact: "patch", escalated: true, unparseable: false, merge: false },
  },
  {
    name: "chore touching supabase tests stays none",
    input: { subject: "chore: add an rls test", files: ["supabase/tests/rls.sql"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: false },
  },
  {
    name: "merge commit is none and never escalated",
    input: {
      subject: "Merge pull request #412 from sheikhti1205/feat-queue",
      files: ["apps/mobile/src/foo.ts", "supabase/migrations/0022_x.sql"],
    },
    expected: { impact: "none", escalated: false, unparseable: false, merge: true },
  },
  {
    name: "merge branch commit is none",
    input: { subject: "Merge branch 'release/0.16'", files: ["apps/mobile/src/foo.ts"] },
    expected: { impact: "none", escalated: false, unparseable: false, merge: true },
  },
  {
    name: "unparseable subject is none and flagged",
    input: { subject: "updated some things", files: ["docs/NOTES.md"] },
    expected: { impact: "none", escalated: false, unparseable: true, merge: false },
  },
  {
    name: "unparseable subject touching shipped code is escalated",
    input: { subject: "updated some things", files: ["apps/mobile/src/foo.ts"] },
    expected: { impact: "patch", escalated: true, unparseable: true, merge: false },
  },
  {
    name: "unknown type is unparseable",
    input: { subject: "wip: half a feature", files: [] },
    expected: { impact: "none", escalated: false, unparseable: true, merge: false },
  },
];

const SHIPPED_CASES = [
  { file: "apps/mobile/src/screens/home.tsx", shipped: true },
  { file: "apps/mobile/src/screens/home.test.tsx", shipped: false },
  { file: "apps/mobile/src/services/sync.spec.ts", shipped: false },
  { file: "apps/mobile/src/__tests__/helper.ts", shipped: false },
  { file: "apps/mobile/src/fixtures/item.json", shipped: false },
  { file: "apps/mobile/android/app/src/main/java/app/Main.kt", shipped: true },
  { file: "apps/mobile/android/app/src/test/java/app/MainTest.kt", shipped: false },
  { file: "apps/mobile/android/app/src/androidTest/java/app/UiTest.kt", shipped: false },
  { file: "apps/mobile/public/icon.png", shipped: true },
  { file: "packages/shared/src/schema.ts", shipped: true },
  { file: "packages/shared/src/schema.spec.ts", shipped: false },
  { file: "apps/share-preview/index.html", shipped: true },
  { file: "supabase/migrations/0001_init.sql", shipped: true },
  { file: "supabase/tests/matching.sql", shipped: false },
  { file: "docs/RELEASE.md", shipped: false },
  { file: "scripts/audit-gate.mjs", shipped: false },
  { file: ".github/workflows/ci.yml", shipped: false },
  { file: "release/state.json", shipped: false },
  { file: "package.json", shipped: false },
  { file: "apps/mobile/package.json", shipped: false },
  { file: "apps/mobile/src\\windows\\style.ts", shipped: true },
];

test("classifies commits by type, footer, files and skip shape", () => {
  for (const { name, input, expected } of CLASSIFY_CASES) {
    const result = classifyCommit(input);
    assert.equal(result.impact, expected.impact, `${name}: impact`);
    assert.equal(result.escalated, expected.escalated, `${name}: escalated`);
    assert.equal(result.unparseable, expected.unparseable, `${name}: unparseable`);
    assert.equal(result.merge, expected.merge, `${name}: merge`);
    assert.equal(result.revert, expected.revert ?? false, `${name}: revert`);
    assert.equal(typeof result.reason, "string", `${name}: reason`);
    assert.ok(result.reason.length > 0, `${name}: reason is non-empty`);
  }
});

test("escalation names the shipped path in the reason", () => {
  const result = classifyCommit({ subject: "chore: tidy imports", files: ["apps/mobile/src/foo.ts"] });
  assert.match(result.reason, /apps\/mobile\/src\/foo\.ts/);
});

test("isShippedPath separates shipped code from tests, tooling and docs", () => {
  for (const { file, shipped } of SHIPPED_CASES) {
    assert.equal(isShippedPath(file), shipped, file);
  }
  assert.equal(isShippedPath(""), false);
  assert.equal(isShippedPath(null), false);
});

test("impactRank orders none < patch < minor < major", () => {
  assert.equal(impactRank("none"), 0);
  assert.equal(impactRank("patch"), 1);
  assert.equal(impactRank("minor"), 2);
  assert.equal(impactRank("major"), 3);
  assert.throws(() => impactRank("huge"), TypeError);
});

test("maxImpact returns the highest impact and none for an empty list", () => {
  assert.equal(maxImpact([]), "none");
  assert.equal(maxImpact(["none", "patch"]), "patch");
  assert.equal(maxImpact(["patch", "minor", "none"]), "minor");
  assert.equal(maxImpact(["major", "minor"]), "major");
});
