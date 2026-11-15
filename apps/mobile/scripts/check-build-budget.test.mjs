// @vitest-environment node
/**
 * Build-budget tests.
 *
 * The budget is the replacement for `chunkSizeWarningLimit`: it fails a build
 * that ships an oversized chunk instead of printing a warning nobody reads.
 * These tests pin the pure decision logic and the end-to-end read of a dist
 * directory, so the script cannot silently stop checking anything.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  budgetViolations,
  initialAssets,
  measureAssets,
  raisesChunkSizeWarningLimit,
  INITIAL_CHUNK_CEILING_BYTES,
} from "./check-build-budget.mjs";
import { INITIAL_CHUNK_CEILING_BYTES as CONFIG_CEILING } from "../vite.config";

let dir = "";

afterEach(async () => {
  if (dir) await rm(dir, { force: true, recursive: true });
  dir = "";
});

describe("initialAssets", () => {
  it("collects the module entry and every modulepreload, ignoring unrelated links", () => {
    const html = [
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-react-def.js">',
      '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">',
      '<link rel="icon" href="/icons/favicon.ico">',
    ].join("\n");
    expect(initialAssets(html)).toEqual(["assets/index-abc.js", "assets/vendor-react-def.js"]);
  });

  it("does not depend on attribute order", () => {
    const html = [
      '<script src="/assets/entry.js" type="module"></script>',
      '<link href="/assets/dep.js" rel="modulepreload">',
    ].join("\n");
    expect(initialAssets(html)).toEqual(["assets/dep.js", "assets/entry.js"]);
  });

  it("ignores scripts that are not module scripts", () => {
    expect(initialAssets('<script src="/assets/legacy.js"></script>')).toEqual([]);
  });
});

describe("budgetViolations", () => {
  const assets = [
    { file: "assets/small.js", bytes: 10 * 1024 },
    { file: "assets/edge.js", bytes: INITIAL_CHUNK_CEILING_BYTES },
    { file: "assets/huge.js", bytes: INITIAL_CHUNK_CEILING_BYTES + 1 },
  ];

  it("fails only the chunk strictly over the ceiling", () => {
    expect(budgetViolations(assets).map((a) => a.file)).toEqual(["assets/huge.js"]);
  });

  it("honours an explicit ceiling", () => {
    expect(budgetViolations(assets, 5 * 1024).map((a) => a.file)).toEqual([
      "assets/small.js",
      "assets/edge.js",
      "assets/huge.js",
    ]);
  });
});

describe("raisesChunkSizeWarningLimit", () => {
  it("detects the warning being raised in the config", () => {
    expect(raisesChunkSizeWarningLimit("build: { chunkSizeWarningLimit: 4000 }")).toBe(true);
  });

  it("leaves a config that only mentions the name in prose alone", () => {
    expect(raisesChunkSizeWarningLimit("// never set chunkSizeWarningLimit here")).toBe(false);
  });
});

describe("measureAssets", () => {
  it("measures every emitted chunk, largest first", async () => {
    dir = await mkdtemp(join(tmpdir(), "norfold-budget-"));
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "assets", "entry.js"), "x".repeat(2048));
    await writeFile(join(dir, "assets", "lazy.js"), "z".repeat(8192));
    await writeFile(join(dir, "assets", "entry.css"), "c".repeat(4096));

    const assets = measureAssets(dir);
    expect(assets.map((a) => a.file)).toEqual(["assets/lazy.js", "assets/entry.js"]);
    expect(assets.map((a) => a.bytes)).toEqual([8192, 2048]);
    // gzip of a repeated byte is tiny; the point is that it is measured.
    expect(assets.every((a) => a.gzip > 0 && a.gzip < a.bytes)).toBe(true);
  });

  it("fails loudly when there is nothing to measure", async () => {
    dir = await mkdtemp(join(tmpdir(), "norfold-budget-"));
    expect(() => measureAssets(dir)).toThrow();
  });
});

describe("ceiling source of truth", () => {
  it("matches the exported config constant", () => {
    expect(INITIAL_CHUNK_CEILING_BYTES).toBe(CONFIG_CEILING);
  });
});
