#!/usr/bin/env node
/**
 * Tests for scripts/release/resolve-release.mjs (decision core only).
 *
 * Git and the clock are injected, so these tests never shell out and never
 * depend on the machine's repository or real time.
 *
 * Run: `node --test scripts/release/resolve-release.test.mjs` from repo root.
 * Pure Node builtins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BATCH_INTERVAL_HOURS,
  parseBatchInterval,
  resolveRelease,
} from "./resolve-release.mjs";

const PUBLISHED_AT = "2026-11-01T00:00:00Z";
const PUBLISHED_MS = Date.parse(PUBLISHED_AT);
const NINE_DAYS_LATER = PUBLISHED_MS + 9 * 24 * 3_600_000;
const ONE_HOUR_LATER = PUBLISHED_MS + 3_600_000;

const SHA = "c".repeat(40);

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    channel: "beta",
    version: "0.16.0-beta.3",
    versionCode: 101077,
    classificationBase: "a".repeat(40),
    pendingRelease: null,
    lastRelease: {
      tag: "v0.15.0-beta.1",
      version: "0.15.0-beta.1",
      versionCode: 101077,
      commit: "f2fdbe70fb8306dab6596e8d9ac525b1af00fa05",
      publishedAt: PUBLISHED_AT,
    },
    ...overrides,
  };
}

// A pending release records only tag, version and versionCode: the bump commit
// does not exist yet and nothing has been published.
const PENDING = {
  tag: "v0.17.0",
  version: "0.17.0",
  versionCode: 101078,
};

function pendingState(overrides = {}) {
  return state({ pendingRelease: { ...PENDING, ...overrides } });
}

function range(impact, overrides = {}) {
  const commits =
    impact === "none"
      ? []
      : [
          {
            sha: SHA,
            subject: "fix: something shipped",
            impact,
            reason: `test fixture: ${impact}`,
            files: ["apps/mobile/src/foo.ts"],
            unparseable: false,
            escalated: false,
            merge: false,
            revert: false,
          },
        ];
  return { impact, commits, unparseable: [], escalated: [], ...overrides };
}

const ENABLED = { RELEASE_PUBLICATION_ENABLED: "true" };

test("publication disabled means no release", () => {
  const decision = resolveRelease({ state: state(), range: range("patch"), env: {}, now: NINE_DAYS_LATER });
  assert.equal(decision.release_required, false);
  assert.equal(decision.reason, "publication disabled");
  assert.equal(decision.publication_enabled, false);
});

test("a docs-only range means no release", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("none"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.version, null);
  assert.equal(decision.version_code, null);
  assert.equal(decision.reason, "no releasable changes");
  assert.equal(decision.commits_total, 0);
});

test("a fix produces the next plain version and the next version code", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.version, "0.16.0");
  assert.equal(decision.version_code, 101078);
  assert.equal(decision.impact, "patch");
  assert.equal(decision.classification_base, "a".repeat(40));
  assert.equal(decision.last_release_tag, "v0.15.0-beta.1");
  assert.deepEqual(decision.impact_breakdown, { none: 0, patch: 1, minor: 0, major: 0 });
});

test("an existing tag means no release and no further invented version", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
    tagExists: (tag) => tag === "v0.16.0",
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.reason, "tag already exists");
  assert.equal(decision.version, null);
  assert.equal(decision.version_code, null);
});

test("an unelapsed batch interval postpones the release", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("patch"),
    env: ENABLED,
    now: ONE_HOUR_LATER,
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.reason, "batch interval not elapsed");
  assert.equal(decision.version, "0.16.0");
});

test("urgent publication overrides the batch interval", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("patch"),
    env: { ...ENABLED, RELEASE_URGENT: "true" },
    now: ONE_HOUR_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.match(decision.reason, /urgent/);
});

test("a major impact publishes without waiting for the interval", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("major"),
    env: ENABLED,
    now: ONE_HOUR_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.version, "0.17.0");
  assert.match(decision.reason, /major/);
});

test("a longer batch interval keeps the release postponed", () => {
  const decision = resolveRelease({
    state: state(),
    range: range("patch"),
    env: { ...ENABLED, RELEASE_BATCH_INTERVAL_HOURS: "240" },
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.reason, "batch interval not elapsed");
  assert.equal(decision.batch_interval_hours, 240);
});

test("a null lastRelease skips the interval and reports no last tag", () => {
  const decision = resolveRelease({
    state: state({ lastRelease: null }),
    range: range("patch"),
    env: ENABLED,
    now: PUBLISHED_MS,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.last_release_tag, null);
  assert.equal(decision.version, "0.16.0");
  assert.equal(decision.version_code, 101078);
  assert.equal(decision.batch_interval_hours, DEFAULT_BATCH_INTERVAL_HOURS);
});

test("a pending release resumes its recorded version when the tag is absent", () => {
  const decision = resolveRelease({
    state: pendingState(),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.version, "0.17.0");
  assert.equal(decision.version_code, 101078);
  assert.equal(decision.impact, "patch");
  assert.equal(decision.reason, "resuming pending release");
});

test("a pending release with no commit key resumes without it", () => {
  const pendingRelease = { tag: "v0.17.0", version: "0.17.0", versionCode: 101078 };
  assert.ok(!("commit" in pendingRelease), "the fixture really has no commit key");
  const decision = resolveRelease({
    state: state({ pendingRelease }),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.version, "0.17.0");
  assert.equal(decision.version_code, 101078);
  assert.equal(decision.reason, "resuming pending release");
});

test("a pending release is resumed without recomputing it", () => {
  // The range alone would produce 0.16.0/101078; the pending record wins.
  const decision = resolveRelease({
    state: pendingState(),
    range: range("none"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.version, "0.17.0");
  assert.equal(decision.version_code, 101078);
  assert.equal(decision.impact, "none");
  assert.equal(decision.reason, "resuming pending release");
});

test("a pending release with publication disabled is not required", () => {
  const decision = resolveRelease({
    state: pendingState(),
    range: range("patch"),
    env: {},
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.publication_enabled, false);
  assert.equal(decision.version, "0.17.0");
  assert.equal(decision.version_code, 101078);
  assert.match(decision.reason, /RELEASE_PUBLICATION_ENABLED/);
});

test("a pending release whose tag already exists still resumes", () => {
  const decision = resolveRelease({
    state: pendingState(),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
    tagExists: (tag) => tag === "v0.17.0",
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.version, "0.17.0");
  assert.equal(decision.version_code, 101078);
  assert.equal(decision.reason, "resuming pending release (tag already created)");
});

test("a pending release with a tag and publication disabled names the switch", () => {
  const decision = resolveRelease({
    state: pendingState(),
    range: range("patch"),
    env: {},
    now: NINE_DAYS_LATER,
    tagExists: (tag) => tag === "v0.17.0",
  });
  assert.equal(decision.release_required, false);
  assert.match(decision.reason, /RELEASE_PUBLICATION_ENABLED/);
});

test("a pending release is not postponed by the batch interval", () => {
  const decision = resolveRelease({
    state: pendingState(),
    range: range("patch"),
    env: ENABLED,
    now: ONE_HOUR_LATER,
  });
  assert.equal(decision.release_required, true);
  assert.equal(decision.reason, "resuming pending release");
});

test("a pending release whose code is not the next code is a blocking problem", () => {
  const decision = resolveRelease({
    state: pendingState({ versionCode: 101079 }),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.blocking_problems.length, 1);
  assert.match(decision.blocking_problems[0], /pendingRelease\.versionCode/);
});

test("a pending release whose version does not sort above the state is a blocking problem", () => {
  const decision = resolveRelease({
    state: pendingState({ tag: "v0.16.0-beta.3", version: "0.16.0-beta.3" }),
    range: range("patch"),
    env: ENABLED,
    now: NINE_DAYS_LATER,
  });
  assert.equal(decision.release_required, false);
  assert.equal(decision.blocking_problems.length, 1);
  assert.match(decision.blocking_problems[0], /pendingRelease\.version/);
  assert.match(decision.blocking_problems[0], /does not sort above/);
});

test("a pending release decision is deterministic", () => {
  const inputs = { state: pendingState(), range: range("patch"), env: ENABLED, now: NINE_DAYS_LATER };
  assert.equal(JSON.stringify(resolveRelease(inputs)), JSON.stringify(resolveRelease(inputs)));
});

test("a bad interval is a blocking problem", () => {
  for (const value of ["abc", "-1", ""]) {
    const decision = resolveRelease({
      state: state(),
      range: range("patch"),
      env: { ...ENABLED, RELEASE_BATCH_INTERVAL_HOURS: value },
      now: NINE_DAYS_LATER,
    });
    assert.equal(decision.blocking_problems.length, 1, JSON.stringify(value));
    assert.match(decision.blocking_problems[0], /RELEASE_BATCH_INTERVAL_HOURS/);
    assert.equal(decision.batch_interval_hours, null);
  }
});

test("the default interval is 24 hours", () => {
  assert.deepEqual(parseBatchInterval(undefined), { hours: DEFAULT_BATCH_INTERVAL_HOURS, problem: null });
  assert.equal(DEFAULT_BATCH_INTERVAL_HOURS, 24);
  assert.deepEqual(parseBatchInterval("0"), { hours: 0, problem: null });
  assert.equal(parseBatchInterval("6").hours, 6);
});

test("the decision is deterministic for the same inputs", () => {
  const inputs = { state: state(), range: range("minor"), env: ENABLED, now: NINE_DAYS_LATER };
  const first = JSON.stringify(resolveRelease(inputs));
  const second = JSON.stringify(resolveRelease(inputs));
  assert.equal(first, second);
});

test("the decision carries every documented key", () => {
  const decision = resolveRelease({ state: state(), range: range("patch"), env: ENABLED, now: NINE_DAYS_LATER });
  assert.deepEqual(Object.keys(decision), [
    "release_required",
    "version",
    "version_code",
    "impact",
    "classification_base",
    "last_release_tag",
    "commits_total",
    "impact_breakdown",
    "escalated",
    "unparseable",
    "reason",
    "blocking_problems",
    "batch_interval_hours",
    "publication_enabled",
  ]);
});
