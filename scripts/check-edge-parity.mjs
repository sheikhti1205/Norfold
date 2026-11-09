#!/usr/bin/env node
/**
 * check-edge-parity: Edge Function parity checker (SYNC-13/14/15, SYNC0-D09/D11).
 *
 * Compares repo function source hashes (sha256 of
 * supabase/functions/<name>/index.ts) against a deployed manifest supplied
 * by the caller/CI. No network calls in this checker — the manifest is
 * injected (file path via --manifest, or object in tests).
 *
 * Covered functions: current dispatcher, media workers, replies and deletion.
 * The retired server assistant is intentionally excluded (history only).
 *
 * Per-function status:
 *   CURRENT — manifest sha256 matches repo sha256
 *   STALE   — manifest entry exists but sha256 differs
 *   MISSING — no manifest entry for the function (not deployed / unknown)
 *
 * Exit codes: 0 all CURRENT, 1 any STALE/MISSING, 2 usage error.
 *
 * ---------------------------------------------------------------------------
 * DEPLOYMENT PLAN (owner-side; this script only reports, never deploys):
 *   1. push-dispatch: redeploy only after the push-secrets probe
 *      (scripts/check-push-config.mjs) reports all PRESENT. Redeploy command
 *      (owner runs): supabase functions deploy push-dispatch --no-verify-jwt.
 *   2. cleanup-comment-media: deploy ONLY after migration
 *      20261013020000 (comment_media_cleanup_lease) is live on the target
 *      project. Deploy command (owner runs):
 *      supabase functions deploy cleanup-comment-media [--no-verify-jwt per
 *      its invocation contract].
 *   3. reply-comment: redeploy ONLY if this checker proves STALE
 *      (manifest sha256 != repo sha256). Matching (CURRENT) means no
 *      redeploy. Missing (MISSING) means first-time deploy review.
 *   4. delete-account: NOT covered by .github/workflows/backend-deploy.yml
 *      (that workflow patterns only push-dispatch/reply-comment plus
 *      the newly added cleanup-comment-media). delete-account deploys
 *      separately, owner-side, after explicit auth-review — never silently
 *      added to the shared backend pipeline by this change.
 * Actual deploys are owner-side; CI calls this checker read-only.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/check-edge-parity.mjs --manifest <manifest.json>
 *   node scripts/check-edge-parity.mjs --manifest <manifest.json> --root <repo-root>
 *
 * Manifest JSON shape (array or { functions: [...] }):
 *   [{ "name": "<fn>", "sha256": "<64-hex>", "version": "...", "verify_jwt": true|false }, ...]
 *   [{ "name": "<fn>", "files": [{ "path": "<fn>/index.ts", "sha256": "<64-hex>" }, ...], ... }]
 *
 * Two manifest shapes are accepted:
 *   - legacy `sha256`: hashes ONLY `<fn>/index.ts`. Kept for existing callers.
 *   - `files`: hashes EVERY listed repo file, including `_shared/*`. Use this
 *     one: shared-module drift is invisible to the legacy shape and was the
 *     cause of a production worker running stale code for eleven days.
 *   A function entry with `files` is CURRENT only when every file matches.
 *
 * Extra manifest entries for unknown names are ignored (reported on stderr
 * as warnings, never failures).
 *
 * Pure injectable API (exported for node --test, no I/O inside):
 *   sha256Hex(text), checkParity({ localHashes, localFiles, manifestEntries }),
 *   computeLocalHashes(readSource), computeLocalFileHashes(readFile, entries),
 *   parseManifest(input), summarize(results), formatParityReport(results)
 * Importing this module has no side effects; the CLI runs on direct execution.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const EDGE_FUNCTIONS = [
  "chat-media",
  "chat-wake",
  "cleanup-chat-media",
  "cleanup-comment-media",
  "cleanup-report-media",
  "copy-chat-evidence",
  "delete-account",
  "device-enroll",
  "push-dispatch",
  "reply-comment",
  "trust-maintenance",
];

/**
 * sha256 hex of UTF-8 text, with line endings normalised to LF.
 *
 * Deployed sources are stored LF-only. A Windows checkout with
 * core.autocrlf=true gives CRLF on disk, so hashing raw bytes would report
 * every function STALE on every Windows machine. Normalising makes the
 * comparison depend on content, not on the checkout platform.
 */
export function sha256Hex(text) {
  return createHash("sha256").update(String(text).replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Compute repo hashes via an injectable reader.
 * readSource(name) -> source text (string). Throw / return null/undefined
 * when the source cannot be read.
 * Returns: { [name]: { sha256 } | { missing: true, reason } }
 */
export function computeLocalHashes(readSource) {
  const out = {};
  for (const name of EDGE_FUNCTIONS) {
    let source;
    try {
      source = readSource(name);
    } catch (error) {
      out[name] = { missing: true, reason: String(error?.message ?? error) };
      continue;
    }
    if (typeof source !== "string") {
      out[name] = { missing: true, reason: "unreadable source" };
      continue;
    }
    out[name] = { sha256: sha256Hex(source) };
  }
  return out;
}

/** Default disk reader: supabase/functions/<name>/index.ts under root. */
export function diskReadSource(root = REPO_ROOT) {
  return (name) => readFileSync(resolve(root, "supabase", "functions", name, "index.ts"), "utf8");
}

/** Default disk reader for per-file manifests: supabase/functions/<path> under root. */
export function diskReadFile(root = REPO_ROOT) {
  return (path) => readFileSync(resolve(root, "supabase", "functions", path), "utf8");
}

/**
 * Hash every repo file listed by a per-file manifest.
 * readFile(path) -> source text. Returns { [name]: { [path]: { sha256 } | { missing } } }.
 */
export function computeLocalFileHashes(readFile, entries) {
  const out = {};
  for (const entry of entries ?? []) {
    const files = {};
    for (const file of entry.files ?? []) {
      try {
        const source = readFile(file.path);
        files[file.path] = typeof source === "string"
          ? { sha256: sha256Hex(source) }
          : { missing: true, reason: "unreadable source" };
      } catch (error) {
        files[file.path] = { missing: true, reason: String(error?.message ?? error) };
      }
    }
    out[entry.name] = files;
  }
  return out;
}

/**
 * Parse + validate a deployed manifest (object or JSON string).
 * Returns an array of { name, sha256, version, verify_jwt }.
 * Throws on malformed input. Unknown-function entries are kept (caller warns).
 */
export function parseManifest(input) {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("check-edge-parity: manifest is not valid JSON");
    }
  }
  const list = Array.isArray(data) ? data : data?.functions;
  if (!Array.isArray(list)) {
    throw new Error("check-edge-parity: manifest must be an array or { functions: [...] }");
  }
  return list.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`check-edge-parity: manifest entry ${index} is not an object`);
    }
    const { name, sha256, version, verify_jwt, files } = entry;
    if (typeof name !== "string" || !name) {
      throw new Error(`check-edge-parity: manifest entry ${index} has no name`);
    }
    if (files !== undefined) {
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error(`check-edge-parity: manifest entry "${name}" has invalid files (expected a non-empty array)`);
      }
      const parsedFiles = files.map((file, fileIndex) => {
        if (!file || typeof file !== "object") {
          throw new Error(`check-edge-parity: manifest entry "${name}" file ${fileIndex} is not an object`);
        }
        const { path, sha256: fileSha } = file;
        if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
          throw new Error(`check-edge-parity: manifest entry "${name}" file ${fileIndex} has an unsafe path`);
        }
        if (typeof fileSha !== "string" || !/^[0-9a-f]{64}$/i.test(fileSha)) {
          throw new Error(`check-edge-parity: manifest entry "${name}" file "${path}" has invalid sha256 (expected 64 hex chars)`);
        }
        return { path, sha256: fileSha.toLowerCase() };
      });
      return { name, files: parsedFiles, version, verify_jwt };
    }
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`check-edge-parity: manifest entry "${name}" has invalid sha256 (expected 64 hex chars)`);
    }
    return { name, sha256: sha256.toLowerCase(), version, verify_jwt };
  });
}

/**
 * Compare local hashes against manifest entries. Pure, no I/O.
 * localHashes: output of computeLocalHashes.
 * manifestEntries: output of parseManifest.
 * Returns: [{ name, status, local, deployed, version, verify_jwt }]
 */
export function checkParity({ localHashes, localFiles, manifestEntries }) {
  const deployedByName = new Map();
  for (const entry of manifestEntries ?? []) {
    if (!deployedByName.has(entry.name)) deployedByName.set(entry.name, entry);
  }
  return EDGE_FUNCTIONS.map((name) => {
    const deployed = deployedByName.get(name) ?? null;
    // Per-file manifests compare every deployed file, so drift in `_shared/*`
    // cannot hide behind a matching `index.ts`.
    if (deployed?.files) {
      const local = localFiles?.[name];
      if (!local) {
        return { name, status: "MISSING", local: null, deployed: null, version: deployed.version, verify_jwt: deployed.verify_jwt, detail: "no local file hashes" };
      }
      const diffs = [];
      for (const file of deployed.files) {
        const localFile = local[file.path];
        if (!localFile || localFile.missing) diffs.push(`${file.path} (repo unreadable)`);
        else if (localFile.sha256 !== file.sha256) diffs.push(file.path);
      }
      const status = diffs.length === 0 ? "CURRENT" : "STALE";
      return {
        name,
        status,
        local: null,
        deployed: null,
        version: deployed.version,
        verify_jwt: deployed.verify_jwt,
        detail: diffs.length === 0 ? `${deployed.files.length} files match` : `differs: ${diffs.join(", ")}`,
      };
    }
    const local = localHashes?.[name];
    if (!local || local.missing || !local.sha256) {
      return { name, status: "MISSING", local: null, deployed: deployed?.sha256 ?? null, version: deployed?.version, verify_jwt: deployed?.verify_jwt, detail: "repo source unreadable" };
    }
    if (!deployed) {
      return { name, status: "MISSING", local: local.sha256, deployed: null, version: undefined, verify_jwt: undefined };
    }
    if (String(deployed.sha256).toLowerCase() === String(local.sha256).toLowerCase()) {
      return { name, status: "CURRENT", local: local.sha256, deployed: deployed.sha256, version: deployed.version, verify_jwt: deployed.verify_jwt };
    }
    return { name, status: "STALE", local: local.sha256, deployed: deployed.sha256, version: deployed.version, verify_jwt: deployed.verify_jwt };
  });
}

/** Count statuses; exitCode 0 when all CURRENT, else 1. */
export function summarize(results) {
  const counts = { CURRENT: 0, STALE: 0, MISSING: 0 };
  for (const row of results) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  const exitCode = counts.STALE === 0 && counts.MISSING === 0 ? 0 : 1;
  return { ...counts, exitCode };
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 12)}…` : "-";
}

/** Human-readable table. Hashes are of public source (not secrets). */
export function formatParityReport(results) {
  const lines = ["check-edge-parity: per-function status (name | status | local | deployed | detail) "];
  for (const row of results) {
    const detail = row.detail ? ` | ${row.detail}` : "";
    lines.push(`  ${row.name} | ${row.status} | ${shortHash(row.local)} | ${shortHash(row.deployed)}${detail}`);
  }
  const summary = summarize(results);
  lines.push(
    `check-edge-parity: ${summary.CURRENT} CURRENT, ${summary.STALE} STALE, ${summary.MISSING} MISSING`,
  );
  return lines.join("\n");
}

function printHelp() {
  console.log(`check-edge-parity: compare repo Edge Function sources to a deployed manifest

usage:
  node scripts/check-edge-parity.mjs --manifest <manifest.json> [--root <repo-root>]

options:
  --manifest <path>  deployed manifest JSON (required, read-only input)
  --root <path>      repo root for supabase/functions/* (default: repo root)
  --help             print this help and exit 0

exit codes: 0 all CURRENT, 1 any STALE/MISSING, 2 usage error`);
}

function isMainModule() {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return invoked === fileURLToPath(import.meta.url);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  const manifestFlag = args.indexOf("--manifest");
  const manifestPath = manifestFlag !== -1 ? args[manifestFlag + 1] : undefined;
  if (!manifestPath) {
    console.error("check-edge-parity: --manifest <path> is required");
    process.exit(2);
  }
  const rootFlag = args.indexOf("--root");
  const root = rootFlag !== -1 ? (args[rootFlag + 1] ?? REPO_ROOT) : REPO_ROOT;
  const unknown = args.filter((arg, index) => {
    if (arg === "--manifest" || index === manifestFlag + 1) return false;
    if (arg === "--root" || index === rootFlag + 1) return false;
    return arg.startsWith("--");
  });
  if (unknown.length > 0) {
    console.error(`check-edge-parity: unknown flag(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
  let manifestRaw;
  try {
    manifestRaw = readFileSync(resolve(manifestPath), "utf8");
  } catch (error) {
    console.error(`check-edge-parity: cannot read manifest ${manifestPath} (${error.message})`);
    process.exit(2);
  }
  let manifestEntries;
  try {
    manifestEntries = parseManifest(manifestRaw);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  for (const entry of manifestEntries) {
    if (!EDGE_FUNCTIONS.includes(entry.name)) {
      console.error(`check-edge-parity: warning: ignoring unknown manifest entry "${entry.name}"`);
    }
  }
  const localHashes = computeLocalHashes(diskReadSource(resolve(root)));
  const localFiles = computeLocalFileHashes(diskReadFile(resolve(root)), manifestEntries);
  const results = checkParity({ localHashes, localFiles, manifestEntries });
  console.log(formatParityReport(results));
  process.exit(summarize(results).exitCode);
}

if (isMainModule()) {
  main();
}
