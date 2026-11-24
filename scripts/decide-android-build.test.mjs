#!/usr/bin/env node
/**
 * TDD tests for scripts/decide-android-build.mjs.
 *
 * The switch exists so one readable value controls Android work: nothing, or
 * build-and-upload-artifacts. Numbered releases are produced by release.yml, so
 * no mode may decide to publish. These tests pin the matrix, especially that the
 * legacy `publish` value never publishes.
 *
 * Run: `node --test scripts/decide-android-build.test.mjs`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODES, DEFAULT_MODE, DEPRECATED_MODES, normalizeMode, decideAndroidBuild, formatDecision } from "./decide-android-build.mjs";

describe("normalizeMode", () => {
  it("accepts only the documented modes", () => {
    assert.deepEqual(MODES, ["none", "build"]);
    for (const mode of MODES) assert.equal(normalizeMode(mode).mode, mode);
  });

  it("is case and whitespace tolerant", () => {
    assert.equal(normalizeMode("  BUILD ").mode, "build");
  });

  it("treats empty and auto as the default", () => {
    assert.equal(DEFAULT_MODE, "build");
    assert.equal(normalizeMode("").mode, DEFAULT_MODE);
    assert.equal(normalizeMode("auto").mode, DEFAULT_MODE);
    assert.equal(normalizeMode(undefined).mode, DEFAULT_MODE);
  });

  it("demotes the deprecated publish mode to build with a notice", () => {
    assert.equal(DEPRECATED_MODES.publish, "build");
    const result = normalizeMode("publish");
    assert.equal(result.mode, "build");
    assert.match(result.warning, /deprecated/);
    assert.match(result.warning, /release\.yml/);
  });

  it("falls back with a warning instead of silently doing nothing", () => {
    const result = normalizeMode("publsh");
    assert.equal(result.mode, DEFAULT_MODE);
    assert.match(result.warning, /unknown build mode/);
  });
});

describe("decideAndroidBuild: mode none", () => {
  it("skips a successful push", () => {
    const result = decideAndroidBuild({ mode: "none", eventName: "workflow_run" });
    assert.equal(result.decision, "skip");
    assert.match(result.reason, /mode is none/);
  });
});

describe("decideAndroidBuild: mode build", () => {
  it("builds without any release step", () => {
    const result = decideAndroidBuild({ mode: "build", eventName: "workflow_run" });
    assert.equal(result.decision, "build");
    assert.notEqual(result.decision, "publish");
  });

  it("builds on a dispatch", () => {
    const result = decideAndroidBuild({ mode: "build", eventName: "workflow_dispatch" });
    assert.equal(result.decision, "build");
  });
});

describe("decideAndroidBuild: deprecated publish mode", () => {
  it("behaves exactly like build and never publishes", () => {
    const result = decideAndroidBuild({ mode: "publish", eventName: "workflow_run" });
    assert.equal(result.decision, "build");
    assert.notEqual(result.decision, "publish");
    assert.ok(result.warnings.some((warning) => /deprecated/.test(warning)));
  });
});

describe("decideAndroidBuild: upstream gates", () => {
  it("skips a failed upstream CI run in every mode", () => {
    for (const mode of [...MODES, "publish"]) {
      const result = decideAndroidBuild({
        mode, eventName: "workflow_run", workflowConclusion: "failure",
      });
      assert.equal(result.decision, "skip", mode);
    }
  });

  it("skips a non-push upstream event", () => {
    const result = decideAndroidBuild({
      mode: "build", eventName: "workflow_run", workflowEvent: "pull_request",
    });
    assert.equal(result.decision, "skip");
  });

  it("skips a fork run", () => {
    const result = decideAndroidBuild({
      mode: "build", eventName: "workflow_run", sameRepo: false,
    });
    assert.equal(result.decision, "skip");
  });

  it("does not apply upstream gates to a dispatch", () => {
    const result = decideAndroidBuild({
      mode: "build", eventName: "workflow_dispatch", workflowConclusion: "failure",
    });
    assert.equal(result.decision, "build");
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
