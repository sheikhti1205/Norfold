#!/usr/bin/env node
/**
 * Tests for scripts/release/classify.mjs.
 *
 * Run: `node --test scripts/release/classify.test.mjs` from repo root.
 * Pure Node builtins; no git, no filesystem (the git reader is injected).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyCommit, filesForCommit, impactRank, isShippedPath, maxImpact } from "./classify.mjs";

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
    input: { subject: "build: retry the gradle cache", files: ["scripts/android-build.sh"] },
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
  {
    name: "docs touching a deployed edge function is escalated",
    input: { subject: "docs: explain the push function", files: ["supabase/functions/send-push/index.ts"] },
    expected: { impact: "patch", escalated: true, unparseable: false, merge: false },
  },
  {
    name: "chore touching the auth mail templates is escalated",
    input: { subject: "chore: reword the magic link mail", files: ["supabase/email-templates/magic-link.html"] },
    expected: { impact: "patch", escalated: true, unparseable: false, merge: false },
  },
  {
    name: "chore touching the mobile web shell is escalated",
    input: { subject: "chore: refresh the shell markup", files: ["apps/mobile/index.html"] },
    expected: { impact: "patch", escalated: true, unparseable: false, merge: false },
  },
];

/** Every path added to the shipped inventory by this change. */
const NEWLY_SHIPPED_PATHS = [
  "apps/mobile/index.html",
  "apps/mobile/vite.config.ts",
  "apps/mobile/vite.config.js",
  "apps/mobile/vite.config.mjs",
  "apps/mobile/capacitor.config.ts",
  "apps/mobile/capacitor.config.js",
  "apps/mobile/capacitor.config.mjs",
  "apps/mobile/package.json",
  "apps/mobile/android/variables.gradle",
  "apps/mobile/android/gradle.properties",
  "apps/mobile/android/settings.gradle",
  "apps/mobile/android/settings.gradle.kts",
  "apps/mobile/android/build.gradle",
  "apps/mobile/android/build.gradle.kts",
  "supabase/functions/send-push/index.ts",
  "supabase/email-templates/magic-link.html",
];

/** Manifests and the root lockfile whose contents reach the app. */
const SHIPPED_DEPENDENCY_FILES = [
  "package.json",
  "apps/mobile/package.json",
  "packages/shared/package.json",
  "package-lock.json",
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
  { file: "apps/mobile/android/app/build.gradle", shipped: true },
  { file: "apps/mobile/public/icon.png", shipped: true },
  { file: "packages/shared/src/schema.ts", shipped: true },
  { file: "packages/shared/src/schema.spec.ts", shipped: false },
  { file: "apps/share-preview/index.html", shipped: true },
  { file: "supabase/migrations/0001_init.sql", shipped: true },
  { file: "supabase/functions/send-push/index.ts", shipped: true },
  { file: "supabase/functions/send-push/index.test.ts", shipped: false },
  { file: "supabase/email-templates/magic-link.html", shipped: true },
  { file: "supabase/tests/matching.sql", shipped: false },
  { file: "apps/mobile/index.html", shipped: true },
  { file: "apps/mobile/vite.config.ts", shipped: true },
  { file: "apps/mobile/capacitor.config.mjs", shipped: true },
  { file: "apps/mobile/package.json", shipped: true },
  { file: "apps/mobile/android/variables.gradle", shipped: true },
  { file: "apps/mobile/android/gradle.properties", shipped: true },
  { file: "apps/mobile/android/settings.gradle", shipped: true },
  { file: "apps/mobile/android/settings.gradle.kts", shipped: true },
  { file: "apps/mobile/android/build.gradle", shipped: true },
  { file: "apps/mobile/android/build.gradle.kts", shipped: true },
  { file: "docs/RELEASE.md", shipped: false },
  { file: "scripts/audit-gate.mjs", shipped: false },
  { file: ".github/workflows/ci.yml", shipped: false },
  { file: "release/state.json", shipped: false },
  { file: "package.json", shipped: false },
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

test("each newly shipped path escalates a chore commit to patch", () => {
  for (const file of NEWLY_SHIPPED_PATHS) {
    const result = classifyCommit({ subject: "chore: touch a shipped file", files: [file] });
    assert.equal(result.impact, "patch", file);
    assert.equal(result.unparseable, false, file);
  }
});

test("a shipped dependency manifest or lockfile is patch whatever the type", () => {
  for (const subject of ["chore(deps): bump lodash", "docs: note the lodash bump", "test: pin lodash"]) {
    for (const file of SHIPPED_DEPENDENCY_FILES) {
      const result = classifyCommit({ subject, files: [file] });
      assert.equal(result.impact, "patch", `${subject} ${file}`);
      assert.equal(result.unparseable, false, `${subject} ${file}`);
    }
  }
});

test("a test file under a shipped tree still does not escalate", () => {
  for (const file of ["apps/mobile/src/screens/home.test.tsx", "apps/mobile/src/services/sync.spec.ts"]) {
    const result = classifyCommit({ subject: "chore: cover the dock", files: [file] });
    assert.equal(result.impact, "none", file);
    assert.equal(result.escalated, false, file);
  }
});

test("a test-only or docs-only manifest does not escalate", () => {
  for (const file of ["apps/mobile/src/fixtures/package.json", "docs/package.json", "supabase/tests/package.json"]) {
    const result = classifyCommit({ subject: "chore(deps): bump the fixture tooling", files: [file] });
    assert.equal(result.impact, "none", file);
    assert.equal(result.escalated, false, file);
  }
});

test("a breaking mark is honoured for a type outside the impact table", () => {
  for (const subject of ["dock!: replace the tab shell", "release-config(api)!: drop the live channel key"]) {
    const result = classifyCommit({ subject, files: [] });
    assert.equal(result.impact, "major", subject);
    assert.equal(result.escalated, false, subject);
    assert.match(result.reason, /breaking/, subject);
  }
});

test("a BREAKING CHANGE footer is honoured for a type outside the impact table", () => {
  const result = classifyCommit({
    subject: "dock: replace the tab shell",
    body: "BREAKING CHANGE: the dock API is gone",
    files: [],
  });
  assert.equal(result.impact, "major");
  assert.equal(result.escalated, false);
  assert.match(result.reason, /breaking/);
});

test("filesForCommit throws naming the commit when git cannot read it", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const failing = () => {
    throw Object.assign(new Error("fatal: bad object"), { stderr: "fatal: bad object\n" });
  };
  assert.throws(
    () => filesForCommit("C:/repo", sha, failing),
    (error) => {
      assert.equal(error.code, "COMMIT_UNREADABLE");
      assert.match(error.message, new RegExp(sha));
      assert.match(error.message, /fatal: bad object/);
      return true;
    },
  );
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
