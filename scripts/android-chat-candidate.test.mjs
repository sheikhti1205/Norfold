import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const workflow = load(readFileSync('.github/workflows/android-builds.yml', 'utf8'));

/** Step runs that would create, edit or upload a numbered release. */
const RELEASE_COMMANDS = [/gh release/i, /release create/i, /release upload/i, /catalogue/i];

test('the Android workflow is driven by one explicit mode', () => {
  const dispatch = workflow.on.workflow_dispatch;
  assert.deepEqual(dispatch.inputs.mode.options, ['auto', 'none', 'build', 'publish']);
  assert.equal(dispatch.inputs.mode.default, 'auto');
  assert.match(workflow.jobs.guard.steps.at(-1).run, /node scripts\/decide-android-build\.mjs/);
  assert.equal(workflow.jobs.apk.if, "needs.guard.outputs.decision != 'skip'");
});

test('build mode produces artifacts and never touches a release', () => {
  const steps = workflow.jobs.apk.steps;
  const artifact = steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(artifact.if, "needs.guard.outputs.decision == 'build'");
  for (const step of steps) {
    const label = step.name ?? step.uses ?? 'unnamed step';
    for (const command of RELEASE_COMMANDS) assert.doesNotMatch(step.run ?? '', command, label);
  }
});

test('the guard decides and its decision is the only thing the build actions read', () => {
  const steps = workflow.jobs.apk.steps;
  const config = steps.find((s) => s.name === 'Strict installable config and build identity');
  for (const command of RELEASE_COMMANDS) assert.doesNotMatch(config.run, command);
  assert.equal(workflow.jobs.guard.outputs.decision, '${{ steps.check.outputs.decision }}');
  assert.ok(workflow.jobs.guard.steps.some((s) => s.id === 'check'));
  assert.equal(workflow.jobs.apk.if, "needs.guard.outputs.decision != 'skip'");
});

test('manual Android candidate runs build an exact-SHA upgrade without changing any numbered release', () => {
  const steps = workflow.jobs.apk.steps;
  assert.ok(steps.some((s) => s.name === 'Verify EVERY APK variant (signature pin, identity, ABI, config)'));
  assert.ok(steps.some((s) => s.name === 'Assert client config in the bundle'));
});
