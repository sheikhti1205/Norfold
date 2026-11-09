#!/usr/bin/env node
/**
 * TDD tests for scripts/decide-android-build.mjs.
 *
 * The switch exists so one readable value controls Android work: nothing,
 * build-only, or build-and-publish. These tests pin the matrix, especially the
 * cases that must NOT publish.
 *
 * Run: `node --test scripts/decide-android-build.test.mjs`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODES, DEFAULT_MODE, normalizeMode, decideAndroidBuild, formatDecision } from "./decide-android-build.mjs";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

describe("normalizeMode", () => {
  it("accepts the three documented modes", () => {
    for (const mode of MODES) assert.equal(normalizeMode(mode).mode, mode);
  });

  it("is case and whitespace tolerant", () => {
    assert.equal(normalizeMode("  BUILD ").mode, "build");
  });

  it("treats empty and auto as the default", () => {
    assert.equal(normalizeMode("").mode, DEFAULT_MODE);
    assert.equal(normalizeMode("auto").mode, DEFAULT_MODE);
    assert.equal(normalizeMode(undefined).mode, DEFAULT_MODE);
  });

  it("falls back with a warning instead of silently doing nothing", () => {
    const result = normalizeMode("publsh");
    assert.equal(result.mode, DEFAULT_MODE);
    assert.match(result.warning, /unknown build mode/);
  });
});

describe("decideAndroidBuild: mode none", () => {
  it("skips a successful push", () => {
    const result = decideAndroidBuild({ mode: "none", eventName: "workflow_run", headSha: HEAD });
    assert.equal(result.decision, "skip");
    assert.match(result.reason, /mode is none/);
  });
});

describe("decideAndroidBuild: mode build", () => {
  it("builds without publishing even when the version is already released", () => {
    const result = decideAndroidBuild({
      mode: "build", eventName: "workflow_run", headSha: HEAD, tagSha: HEAD,
    });
    assert.equal(result.decision, "build");
  });

  it("builds on a dispatch", () => {
    const result = decideAndroidBuild({ mode: "build", eventName: "workflow_dispatch", headSha: HEAD });
    assert.equal(result.decision, "build");
  });
});

describe("decideAndroidBuild: mode publish", () => {
  it("publishes when the version has no tag yet", () => {
    const result = decideAndroidBuild({ mode: "publish", headSha: HEAD, tagSha: null, releaseSha: null });
    assert.equal(result.decision, "publish");
  });

  it("skips when this exact commit is already published", () => {
    const result = decideAndroidBuild({ mode: "publish", headSha: HEAD, tagSha: HEAD });
    assert.equal(result.decision, "skip");
    assert.match(result.reason, /already published from this exact commit/);
  });

  it("skips when the version belongs to another commit", () => {
    const result = decideAndroidBuild({ mode: "publish", headSha: HEAD, tagSha: OTHER });
    assert.equal(result.decision, "skip");
    assert.match(result.reason, /bump the app version/);
  });

  it("skips when an existing release targets another commit", () => {
    const result = decideAndroidBuild({ mode: "publish", headSha: HEAD, tagSha: null, releaseSha: OTHER });
    assert.equal(result.decision, "skip");
    assert.match(result.reason, /bump the app version/);
  });
});

describe("decideAndroidBuild: upstream gates", () => {
  it("skips a failed upstream CI run in every mode", () => {
    for (const mode of MODES) {
      const result = decideAndroidBuild({
        mode, eventName: "workflow_run", workflowConclusion: "failure", headSha: HEAD,
      });
      assert.equal(result.decision, "skip", mode);
    }
  });

  it("skips a non-push upstream event", () => {
    const result = decideAndroidBuild({
      mode: "build", eventName: "workflow_run", workflowEvent: "pull_request", headSha: HEAD,
    });
    assert.equal(result.decision, "skip");
  });

  it("skips a fork run", () => {
    const result = decideAndroidBuild({
      mode: "publish", eventName: "workflow_run", sameRepo: false, headSha: HEAD,
    });
    assert.equal(result.decision, "skip");
  });

  it("does not apply upstream gates to a dispatch", () => {
    const result = decideAndroidBuild({
      mode: "publish", eventName: "workflow_dispatch", workflowConclusion: "failure", headSha: HEAD,
    });
    assert.equal(result.decision, "publish");
  });
});

describe("formatDecision", () => {
  it("prints the outcome and the reason", () => {
    assert.equal(
      formatDecision({ decision: "build", reason: "because" }),
      "android-build: build (because)",
    );
  });
});
