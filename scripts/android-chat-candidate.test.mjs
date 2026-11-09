import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const workflow = load(readFileSync('.github/workflows/android-builds.yml', 'utf8'));

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
  for (const name of ['Write the update catalogue for exactly these bytes', 'Publish the numbered release']) {
    assert.equal(steps.find((s) => s.name === name).if, "needs.guard.outputs.decision == 'publish'");
  }
});

test('publish mode still enforces release immutability', () => {
  const steps = workflow.jobs.apk.steps;
  const config = steps.find((s) => s.name === 'Strict installable config and build identity');
  assert.match(config.run, /\[ "\$DECISION" = publish \]/);
  assert.equal(config.env.DECISION, '${{ needs.guard.outputs.decision }}');
  assert.match(config.run, /numbered releases are immutable/);
});

test('manual Android candidate runs build an exact-SHA upgrade without changing any numbered release', () => {
  const steps = workflow.jobs.apk.steps;
  assert.ok(steps.some((s) => s.name === 'Verify EVERY APK variant (signature pin, identity, ABI, config)'));
  assert.ok(steps.some((s) => s.name === 'Assert client config in the bundle'));
});
