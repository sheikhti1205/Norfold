import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { load } from "js-yaml";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("retained workflow regression selections resolve to real test files", () => {
  const workflow = load(read(".github/workflows/local-intelligence-models.yml"));
  const step = workflow.jobs["model-smoke"].steps.find((step) => step.name === "Local tools and separate cloud Chat behavioral regressions");
  assert.ok(step?.run.includes("--maxWorkers=2"));
  const tests = step.run.match(/src\/[^\s]+\.test\.tsx?/g);
  assert.ok(tests.length >= 20);
  for (const file of tests) assert.ok(existsSync(resolve(root, "apps/mobile", file)), file);
  assert.equal(workflow.jobs["model-smoke"].steps.find((step) => step.uses === "actions/setup-node@v5").with["node-version"], 24);
});

test("retired model-lab gate and acquisition tools are not executable queues", () => {
  for (const file of ["ai-release-gate.mjs", "check-ai-manifest.mjs", "check-ai-promotion.mjs", "fetch-lab-models.mjs", "fetch-smolvlm-model.mjs", "build-fbmodel-local.py"]) {
    assert.equal(existsSync(resolve(root, "scripts", file)), false, file);
  }
  for (const path of [".github/workflows/ci.yml", ".github/workflows/local-intelligence-models.yml", ".github/workflows/local-intelligence-native.yml"]) {
    assert.doesNotMatch(read(path), /ai-release-gate|check-ai-manifest|check-ai-promotion/);
  }
});

test("historical legal snapshot remains byte-identical after archival", () => {
  const packet = readFileSync(resolve(root, "docs/licenses/model-license-packet.json"));
  assert.equal(createHash("sha256").update(packet).digest("hex"), "f248b28de1936d27f49f34607dc38db6d93b28bf79112cba4678539ad5aefec2");
});
