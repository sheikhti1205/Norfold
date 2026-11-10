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
 *   node scripts/check-edge-parity.mjs --manifest <manifest.json> --strict
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
 * `--strict` rejects a manifest that cannot prove parity:
 *   - legacy index-only entries (they never cover `_shared/*`)
 *   - an entry without its `<fn>/index.ts` entrypoint
 *   - a relative import in the function's source that the entry does not list
 *     (the transitive `./` and `../_shared/` closure, read from the repo)
 *   - unknown function names
 *
 * `--strict` also checks the gateway JWT contract (docs/I-43): the deployed
 * `verify_jwt` must equal the expectation recorded in
 * scripts/edge-jwt-expectations.json (override with --expectations <path>).
 *   MATCH    — deployed verify_jwt equals the derived expectation
 *   MISMATCH — deployed verify_jwt disagrees (a failure in strict mode)
 *   UNKNOWN  — no expectation for the function, the expectation is marked
 *              `unknown`, or the deployed manifest does not state verify_jwt.
 *              Never treated as a pass: an unproven contract is not a proven one.
 * Default (non-strict) mode does not read the expectations file at all.
 * Duplicate function entries and duplicate file paths are rejected in both
 * modes, because either one silently discards evidence.
 *
 * Extra manifest entries for unknown names are ignored in default mode
 * (reported on stderr as warnings, never failures).
 *
 * Pure injectable API (exported for node --test, no I/O inside):
 *   sha256Hex(text), checkParity({ localHashes, localFiles, manifestEntries }),
 *   computeLocalHashes(readSource), computeLocalFileHashes(readFile, entries),
 *   parseManifest(input, { strict }), collectRelativeImports(source),
 *   resolveRelativeImport(importerPath, specifier),
 *   findUndeclaredImports(entries, readFile),
 *   summarize(results), formatParityReport(results)
 *   parseExpectations(input), checkJwtContract(results, expectations),
 *   summarizeJwtContract(rows), formatJwtReport(rows),
 *   evaluateJwtContract({ strict, results, expectations })
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
 * Returns an array of { name, sha256, version, verify_jwt } or
 * { name, files, version, verify_jwt }.
 * Throws on malformed input. Unknown-function entries are kept (caller warns).
 *
 * Duplicates always throw: a second entry for the same function, or the same
 * file listed twice, means the manifest is ambiguous and one copy is silently
 * ignored. `strict` additionally refuses the legacy index-only shape (it can
 * never prove `_shared/*` parity) and an entry without its own entrypoint.
 */
export function parseManifest(input, { strict = false } = {}) {
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
  const seenNames = new Set();
  return list.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`check-edge-parity: manifest entry ${index} is not an object`);
    }
    const { name, sha256, version, verify_jwt, files } = entry;
    if (typeof name !== "string" || !name) {
      throw new Error(`check-edge-parity: manifest entry ${index} has no name`);
    }
    if (seenNames.has(name)) {
      throw new Error(`check-edge-parity: duplicate manifest entry "${name}"`);
    }
    seenNames.add(name);
    if (files !== undefined) {
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error(`check-edge-parity: manifest entry "${name}" has invalid files (expected a non-empty array)`);
      }
      const seenPaths = new Set();
      const parsedFiles = files.map((file, fileIndex) => {
        if (!file || typeof file !== "object") {
          throw new Error(`check-edge-parity: manifest entry "${name}" file ${fileIndex} is not an object`);
        }
        const { path, sha256: fileSha } = file;
        if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
          throw new Error(`check-edge-parity: manifest entry "${name}" file ${fileIndex} has an unsafe path`);
        }
        if (seenPaths.has(path)) {
          throw new Error(`check-edge-parity: manifest entry "${name}" lists "${path}" more than once`);
        }
        seenPaths.add(path);
        if (typeof fileSha !== "string" || !/^[0-9a-f]{64}$/i.test(fileSha)) {
          throw new Error(`check-edge-parity: manifest entry "${name}" file "${path}" has invalid sha256 (expected 64 hex chars)`);
        }
        return { path, sha256: fileSha.toLowerCase() };
      });
      if (strict && !seenPaths.has(`${name}/index.ts`)) {
        throw new Error(`check-edge-parity: strict manifest entry "${name}" is missing its entrypoint ${name}/index.ts`);
      }
      return { name, files: parsedFiles, version, verify_jwt };
    }
    if (strict) {
      throw new Error(
        `check-edge-parity: strict manifest entry "${name}" must use "files" (an index-only sha256 cannot prove _shared/* parity)`,
      );
    }
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`check-edge-parity: manifest entry "${name}" has invalid sha256 (expected 64 hex chars)`);
    }
    return { name, sha256: sha256.toLowerCase(), version, verify_jwt };
  });
}

/**
 * Every relative module specifier in a source file.
 * Handles `import ... from "./x.ts"`, `export ... from "../_shared/y.ts"`, and
 * the side-effect form `import "./z.ts"`. External specifiers (npm:, https:,
 * bare names) are ignored.
 */
export function collectRelativeImports(source) {
  const out = [];
  const text = String(source);
  for (const pattern of [/from\s*["'](\.[^"']+)["']/g, /\bimport\s*["'](\.[^"']+)["']/g]) {
    let match;
    while ((match = pattern.exec(text))) out.push(match[1]);
  }
  return out;
}

/**
 * Resolve a relative specifier against the importing file's path.
 * Both paths are repo-relative inside supabase/functions.
 *   ("chat-media/handler.ts", "../_shared/cors.js") -> "_shared/cors.js"
 *   ("_shared/deviceEnrollment.ts", "./deviceProof.ts") -> "_shared/deviceProof.ts"
 */
export function resolveRelativeImport(importerPath, specifier) {
  const slash = importerPath.lastIndexOf("/");
  const parts = (slash === -1 ? [] : importerPath.slice(0, slash).split("/")).concat(specifier.split("/"));
  const stack = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/**
 * Walk each entry's transitive relative-import closure from `<fn>/index.ts` and
 * report repo files the entry does not declare.
 *
 * This is the completeness check the hash comparison cannot do on its own: a
 * manifest that omits `_shared/x.ts` still reports CURRENT for the files it
 * does list. Returns [{ name, missing: [path, ...] }] (empty when complete).
 */
export function findUndeclaredImports(entries, readFile) {
  const problems = [];
  for (const entry of entries ?? []) {
    if (!entry.files) continue;
    const declared = new Set(entry.files.map((file) => file.path));
    const seen = new Set();
    const queue = [`${entry.name}/index.ts`];
    while (queue.length > 0) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      let source;
      try {
        source = readFile(current);
      } catch {
        continue; // unreadable files are reported by checkParity, not here
      }
      if (typeof source !== "string") continue;
      for (const specifier of collectRelativeImports(source)) {
        const resolved = resolveRelativeImport(current, specifier);
        if (!seen.has(resolved)) queue.push(resolved);
      }
    }
    const missing = [...seen].filter((file) => !declared.has(file));
    if (missing.length > 0) problems.push({ name: entry.name, missing });
  }
  return problems;
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

/** Expectations manifest shipped beside this checker (not a supabase/config.toml). */
export const DEFAULT_EXPECTATIONS_PATH = resolve(HERE, "edge-jwt-expectations.json");

const EXPECTATION_STATUSES = ["DERIVED", "UNKNOWN"];
const EVIDENCE_CLASSES = ["source-auth", "caller", "deploy", "live"];

/**
 * Parse + validate the JWT expectations manifest (object or JSON string).
 * Returns { [name]: { verifyJwt, status, evidence } }.
 *
 * Fail-closed on every ambiguity: a DERIVED entry must carry a boolean, an
 * UNKNOWN entry must say "unknown", and every entry must record at least one
 * evidence item - an expectation with no evidence is an invented value.
 */
export function parseExpectations(input) {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("check-edge-parity: expectations manifest is not valid JSON");
    }
  }
  const functions = data?.functions;
  if (!functions || typeof functions !== "object" || Array.isArray(functions)) {
    throw new Error("check-edge-parity: expectations manifest must be an object with a \"functions\" map");
  }
  const names = Object.keys(functions);
  if (names.length === 0) {
    throw new Error("check-edge-parity: expectations manifest has no functions");
  }
  const out = {};
  for (const name of names) {
    if (!name.trim()) throw new Error("check-edge-parity: expectations manifest has an empty function name");
    const entry = functions[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`check-edge-parity: expectation "${name}" is not an object`);
    }
    const { verifyJwt, status, evidence } = entry;
    if (!EXPECTATION_STATUSES.includes(status)) {
      throw new Error(`check-edge-parity: expectation "${name}" has invalid status (expected DERIVED or UNKNOWN)`);
    }
    if (status === "DERIVED" && typeof verifyJwt !== "boolean") {
      throw new Error(`check-edge-parity: DERIVED expectation "${name}" must set a boolean verifyJwt`);
    }
    if (status === "UNKNOWN" && verifyJwt !== "unknown") {
      throw new Error(`check-edge-parity: UNKNOWN expectation "${name}" must set verifyJwt to "unknown"`);
    }
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error(`check-edge-parity: expectation "${name}" records no evidence`);
    }
    evidence.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        throw new Error(`check-edge-parity: expectation "${name}" evidence ${index} is not an object`);
      }
      for (const field of ["class", "source", "detail"]) {
        if (typeof item[field] !== "string" || !item[field].trim()) {
          throw new Error(`check-edge-parity: expectation "${name}" evidence ${index} has no ${field}`);
        }
      }
      if (!EVIDENCE_CLASSES.includes(item.class)) {
        throw new Error(
          `check-edge-parity: expectation "${name}" evidence ${index} has unknown class "${item.class}" (expected ${EVIDENCE_CLASSES.join("/")})`,
        );
      }
    });
    out[name] = { verifyJwt, status, evidence };
  }
  return out;
}

/**
 * Compare each function's deployed verify_jwt to its expectation. Pure.
 * results: output of checkParity (carries the deployed verify_jwt).
 * Returns [{ name, expected, deployed, verdict, reason? }] where verdict is
 * MATCH, MISMATCH, or UNKNOWN (never a silent pass).
 */
export function checkJwtContract(results, expectations) {
  return (results ?? []).map((row) => {
    const expectation = expectations?.[row.name];
    const deployed = row.verify_jwt;
    if (!expectation) {
      return { name: row.name, expected: undefined, deployed, verdict: "UNKNOWN", reason: "no expectation recorded" };
    }
    if (expectation.verifyJwt === "unknown") {
      return { name: row.name, expected: "unknown", deployed, verdict: "UNKNOWN", reason: "expectation is unresolved" };
    }
    if (typeof deployed !== "boolean") {
      return {
        name: row.name,
        expected: expectation.verifyJwt,
        deployed,
        verdict: "UNKNOWN",
        reason: "deployed manifest does not state verify_jwt",
      };
    }
    if (deployed === expectation.verifyJwt) {
      return { name: row.name, expected: expectation.verifyJwt, deployed, verdict: "MATCH" };
    }
    return {
      name: row.name,
      expected: expectation.verifyJwt,
      deployed,
      verdict: "MISMATCH",
      reason: `deployed verify_jwt=${deployed}, expected ${expectation.verifyJwt}`,
    };
  });
}

/** Count JWT contract verdicts; exitCode 0 only when every row MATCHes. */
export function summarizeJwtContract(rows) {
  const counts = { MATCH: 0, MISMATCH: 0, UNKNOWN: 0 };
  for (const row of rows ?? []) {
    if (counts[row.verdict] !== undefined) counts[row.verdict] += 1;
  }
  const exitCode = counts.MISMATCH === 0 && counts.UNKNOWN === 0 ? 0 : 1;
  return { ...counts, exitCode };
}

function showValue(value) {
  return value === undefined ? "-" : String(value);
}

/** Human-readable verify_jwt contract table. */
export function formatJwtReport(rows) {
  const lines = ["check-edge-parity: verify_jwt contract (name | expected | deployed | verdict) "];
  for (const row of rows ?? []) {
    const reason = row.reason ? ` | ${row.reason}` : "";
    lines.push(`  ${row.name} | ${showValue(row.expected)} | ${showValue(row.deployed)} | ${row.verdict}${reason}`);
  }
  const summary = summarizeJwtContract(rows);
  lines.push(`check-edge-parity: verify_jwt: ${summary.MATCH} MATCH, ${summary.MISMATCH} MISMATCH, ${summary.UNKNOWN} UNKNOWN`);
  return lines.join("\n");
}

/**
 * The strict-only seam: non-strict returns null so default mode keeps its
 * existing behaviour and never reads the expectations file.
 */
export function evaluateJwtContract({ strict, results, expectations }) {
  if (!strict) return null;
  const rows = checkJwtContract(results, expectations);
  return { rows, summary: summarizeJwtContract(rows) };
}

function printHelp() {
  console.log(`check-edge-parity: compare repo Edge Function sources to a deployed manifest

usage:
  node scripts/check-edge-parity.mjs --manifest <manifest.json> [--root <repo-root>] [--strict]
        [--expectations <path>]

options:
  --manifest <path>       deployed manifest JSON (required, read-only input)
  --root <path>           repo root for supabase/functions/* (default: repo root)
  --strict                reject manifests that cannot prove parity: legacy
                          index-only entries, a missing <fn>/index.ts, an import
                          the entry does not list, or an unknown function name;
                          also fail when a deployed verify_jwt disagrees with
                          its recorded expectation or the contract is UNKNOWN
  --expectations <path>   verify_jwt expectations manifest (default:
                          scripts/edge-jwt-expectations.json; strict mode only)
  --help                  print this help and exit 0

exit codes: 0 all CURRENT and contract-proven, 1 any STALE/MISSING or
verify_jwt MISMATCH/UNKNOWN, 2 usage or manifest-rejection error`);
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
  const strict = args.includes("--strict");
  const manifestFlag = args.indexOf("--manifest");
  const manifestPath = manifestFlag !== -1 ? args[manifestFlag + 1] : undefined;
  if (!manifestPath) {
    console.error("check-edge-parity: --manifest <path> is required");
    process.exit(2);
  }
  const rootFlag = args.indexOf("--root");
  const root = rootFlag !== -1 ? (args[rootFlag + 1] ?? REPO_ROOT) : REPO_ROOT;
  const expectationsFlag = args.indexOf("--expectations");
  const expectationsPath = expectationsFlag !== -1
    ? args[expectationsFlag + 1]
    : DEFAULT_EXPECTATIONS_PATH;
  if (strict && !expectationsPath) {
    console.error("check-edge-parity: --expectations requires a path");
    process.exit(2);
  }
  const unknown = args.filter((arg, index) => {
    if (arg === "--manifest" || index === manifestFlag + 1) return false;
    if (arg === "--root" || index === rootFlag + 1) return false;
    if (arg === "--expectations" || index === expectationsFlag + 1) return false;
    if (arg === "--strict") return false;
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
    manifestEntries = parseManifest(manifestRaw, { strict });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const readFile = diskReadFile(resolve(root));
  if (strict) {
    const unknownNames = manifestEntries.filter((entry) => !EDGE_FUNCTIONS.includes(entry.name)).map((entry) => entry.name);
    if (unknownNames.length > 0) {
      console.error(`check-edge-parity: strict: unknown function(s) in manifest: ${unknownNames.join(", ")}`);
      process.exit(2);
    }
    const undeclared = findUndeclaredImports(manifestEntries, readFile);
    if (undeclared.length > 0) {
      for (const problem of undeclared) {
        console.error(`check-edge-parity: strict: "${problem.name}" does not declare imported file(s): ${problem.missing.join(", ")}`);
      }
      process.exit(2);
    }
  } else {
    for (const entry of manifestEntries) {
      if (!EDGE_FUNCTIONS.includes(entry.name)) {
        console.error(`check-edge-parity: warning: ignoring unknown manifest entry "${entry.name}"`);
      }
    }
  }
  const localHashes = computeLocalHashes(diskReadSource(resolve(root)));
  const localFiles = computeLocalFileHashes(readFile, manifestEntries);
  const results = checkParity({ localHashes, localFiles, manifestEntries });
  console.log(formatParityReport(results));
  let exitCode = summarize(results).exitCode;

  if (strict) {
    // Strict mode cannot prove the gateway contract without the expectations
    // manifest, so an unreadable/invalid one is a usage error, not a pass.
    let expectations;
    try {
      expectations = parseExpectations(readFileSync(resolve(expectationsPath), "utf8"));
    } catch (error) {
      console.error(`check-edge-parity: strict: ${error.message}`);
      process.exit(2);
    }
    const stale = Object.keys(expectations).filter((name) => !EDGE_FUNCTIONS.includes(name));
    if (stale.length > 0) {
      console.error(`check-edge-parity: strict: warning: expectation(s) for unknown function(s): ${stale.join(", ")}`);
    }
    const contract = evaluateJwtContract({ strict, results, expectations });
    console.log(formatJwtReport(contract.rows));
    for (const row of contract.rows) {
      if (row.verdict === "MISMATCH") {
        console.error(`check-edge-parity: strict: "${row.name}" verify_jwt mismatch: deployed ${row.deployed}, expected ${row.expected}`);
      } else if (row.verdict === "UNKNOWN") {
        console.error(`check-edge-parity: strict: "${row.name}" verify_jwt UNKNOWN: ${row.reason}`);
      }
    }
    if (contract.summary.exitCode !== 0) exitCode = 1;
  }

  process.exit(exitCode);
}

if (isMainModule()) {
  main();
}
