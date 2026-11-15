#!/usr/bin/env node
// Build budget: fail a production build that ships an oversized chunk, and
// fail a config that smuggles the problem past the warning instead.
//
// Two independent checks, both deterministic and cheap (no network, no build):
//   1. no emitted JavaScript file exceeds INITIAL_CHUNK_CEILING_BYTES after
//      minification — every chunk is checked, not only the preloaded ones, so a
//      fat lazy chunk cannot slip through either;
//   2. apps/mobile/vite.config.ts does not raise `chunkSizeWarningLimit` —
//      silencing the warning is not a fix, and the ceiling above replaces it.
//
// It also prints the document's preload graph (entry + modulepreload) so the
// boot payload stays visible in the build log.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Ceiling for any single emitted chunk, minified bytes. Mirrors vite.config.ts. */
export const INITIAL_CHUNK_CEILING_BYTES = 1200 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");

/**
 * Every JS asset the document loads up front, as paths relative to `dist`
 * (leading slash removed).
 *
 * Attribute order is not assumed: Vite currently emits `type` before `src` and
 * `rel` before `href`, but the report must not silently measure nothing if that
 * changes.
 */
export function initialAssets(html) {
  const out = new Set();
  const attr = (attrs, name) =>
    new RegExp(`\\b${name}\\s*=\\s*"([^"]+\\.js)"`, "i").exec(attrs)?.[1];
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\btype\s*=\s*"module"/i.test(attrs)) continue;
    const src = attr(attrs, "src");
    if (src) out.add(src.replace(/^\/+/, ""));
  }
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (!/\brel\s*=\s*"modulepreload"/i.test(attrs)) continue;
    const href = attr(attrs, "href");
    if (href) out.add(href.replace(/^\/+/, ""));
  }
  return [...out].sort();
}

/**
 * Evaluate a measured asset list against the ceiling.
 * @param {{file: string, bytes: number}[]} assets
 * @param {number} ceiling
 */
export function budgetViolations(assets, ceiling = INITIAL_CHUNK_CEILING_BYTES) {
  return assets.filter((asset) => asset.bytes > ceiling);
}

/** True when the config hides the size warning instead of fixing the size. */
export function raisesChunkSizeWarningLimit(configSource) {
  return /chunkSizeWarningLimit\s*:/.test(configSource);
}

/** Size every emitted JavaScript chunk, largest first. */
export function measureAssets(distDir) {
  const dir = join(distDir, "assets");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => {
      const path = join(dir, name);
      return {
        file: `assets/${name}`,
        bytes: statSync(path).size,
        gzip: gzipSync(readFileSync(path), { level: 9 }).length,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function kib(bytes) {
  return (bytes / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const distDir = process.argv[2] ? resolve(process.argv[2]) : join(mobileRoot, "dist");
    const assets = measureAssets(distDir);
    if (assets.length === 0) throw new Error("no JavaScript assets found in dist/assets");

    const byFile = new Map(assets.map((asset) => [asset.file, asset]));
    const preloaded = initialAssets(readFileSync(join(distDir, "index.html"), "utf8"))
      .map((file) => byFile.get(file))
      .filter(Boolean);
    const preloadBytes = preloaded.reduce((sum, asset) => sum + asset.bytes, 0);
    const preloadGzip = preloaded.reduce((sum, asset) => sum + asset.gzip, 0);

    console.log(`build budget: largest emitted chunk (minified │ gzip)`);
    for (const asset of assets.slice(0, 8)) {
      console.log(`  ${kib(asset.bytes).padStart(9)} kB │ gzip ${kib(asset.gzip).padStart(8)} kB │ ${asset.file}`);
    }
    console.log(
      `  document preload graph: ${preloaded.length} chunks, ${kib(preloadBytes)} kB │ gzip ${kib(preloadGzip)} kB`,
    );
    console.log(`  ceiling: ${kib(INITIAL_CHUNK_CEILING_BYTES)} kB per chunk (minified)`);

    const over = budgetViolations(assets);
    const config = readFileSync(join(mobileRoot, "vite.config.ts"), "utf8");
    const hiding = raisesChunkSizeWarningLimit(config);

    if (over.length > 0) {
      console.error(`build budget: FAIL — ${over.length} chunk(s) over ceiling:`);
      for (const asset of over) console.error(`  ${kib(asset.bytes)} kB  ${asset.file}`);
    }
    if (hiding) {
      console.error("build budget: FAIL — vite.config.ts sets chunkSizeWarningLimit; fix chunking instead of hiding the warning");
    }
    if (over.length > 0 || hiding) process.exitCode = 1;
    else console.log("build budget: PASS");
  } catch (error) {
    console.error(`build budget: ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 1;
  }
}
