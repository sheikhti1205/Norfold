#!/usr/bin/env node
/**
 * Dependency audit gate with reviewed, expiring exceptions.
 *
 * `npm audit --audit-level=high` is the authority, but it fails the whole
 * pipeline when a high advisory has no patched release. Waiting for upstream
 * would block every deploy; silently dropping the gate would lose the rest of
 * its coverage. This wrapper keeps the authority and narrows the exemption to
 * a named advisory id plus package:
 *
 *   - Every high/critical advisory still fails the build.
 *   - An exception matches only when BOTH the GHSA id and the package name
 *     match, so a re-used advisory id on another package cannot slip through.
 *   - An exception carries the date it was reviewed. Once `expires` has
 *     passed the gate fails again, so a temporary exemption cannot become
 *     permanent by neglect.
 *   - A high/critical vulnerability entry with no advisory object fails
 *     closed instead of being treated as "nothing to see".
 *
 * Usage:
 *   node scripts/audit-gate.mjs              # full tree
 *   node scripts/audit-gate.mjs --omit=dev   # shipped runtime only
 *
 * Pure core is exported for `node --test`; importing has no side effects.
 */

import { spawnSync } from "node:child_process";

/** Reviewed exceptions. Remove the entry once the advisory is fixed. */
export const REVIEWED_EXCEPTIONS = [
  {
    ghsa: "GHSA-FC5Q-39XC-VJPF",
    package: "picomatch",
    reviewedAt: "2026-11-17",
    expires: "2027-01-31",
    reason:
      "ReDoS through single-branch repeated extglobs. No patched release exists " +
      "(last affected 4.0.7). Reached only through Vite/Vitest glob evaluation " +
      "of static build-time config, never user-supplied globs. Remove this " +
      "exception as soon as picomatch publishes a fixed version.",
  },
];

const HIGH_SEVERITIES = new Set(["high", "critical"]);

/** GHSA id from an advisory URL, or null for anything else. */
export function ghsaFromUrl(url) {
  if (typeof url !== "string") return null;
  const match = /\/(GHSA-[a-z0-9-]+)\b/i.exec(url);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Every distinct advisory object in an `npm audit --json` report.
 * A high/critical entry whose `via` holds no advisory object is returned as
 * `unidentified` so the caller can fail closed.
 */
export function advisoriesIn(report) {
  const advisories = [];
  const unidentified = [];
  const seen = new Set();
  const vulnerabilities = report?.vulnerabilities ?? {};
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(entry?.via) ? entry.via : [];
    const objects = via.filter((item) => item && typeof item === "object");
    for (const item of objects) {
      const ghsa = ghsaFromUrl(item.url);
      if (!ghsa) continue;
      const pkg = item.name ?? name;
      const key = `${ghsa}\u0000${pkg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      advisories.push({
        ghsa,
        package: pkg,
        severity: item.severity ?? entry?.severity ?? "unknown",
        title: item.title ?? "",
      });
    }
    if (HIGH_SEVERITIES.has(entry?.severity) && objects.length === 0) {
      // A transitive "carrier" entry lists the vulnerable package it depends
      // on as a string. That cause is itself an entry in this report, so it is
      // explained elsewhere. An entry with no explanation at all fails closed.
      const named = via.filter((item) => typeof item === "string");
      const explained = named.some((name) => Object.hasOwn(vulnerabilities, name));
      if (!explained) {
        unidentified.push({ package: name, severity: entry.severity, range: entry.range ?? "" });
      }
    }
  }
  return { advisories, unidentified };
}

/** True when the exception has not passed its review expiry date. */
export function exceptionIsLive(exception, now = new Date()) {
  if (!exception?.expires) return true;
  const expiry = new Date(`${exception.expires}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return false;
  return now.getTime() <= expiry.getTime();
}

/**
 * Classify a report into blocking advisories and applied exceptions.
 * `unidentified` entries are always blocking.
 */
export function evaluateAudit(report, exceptions = REVIEWED_EXCEPTIONS, now = new Date()) {
  const { advisories, unidentified } = advisoriesIn(report);
  const blockers = [];
  const ignored = [];
  const expired = [];
  for (const advisory of advisories) {
    if (!HIGH_SEVERITIES.has(advisory.severity)) continue;
    const match = exceptions.find(
      (exception) =>
        String(exception.ghsa ?? "").toUpperCase() === advisory.ghsa &&
        exception.package === advisory.package,
    );
    if (!match) {
      blockers.push({ ...advisory, kind: "unreviewed" });
      continue;
    }
    if (!exceptionIsLive(match, now)) {
      expired.push({ ...advisory, expires: match.expires });
      blockers.push({ ...advisory, kind: "expired" });
      continue;
    }
    ignored.push({ ...advisory, reason: match.reason, expires: match.expires });
  }
  for (const entry of unidentified) blockers.push({ ...entry, kind: "unidentified" });
  return { blockers, ignored, expired };
}

/** Names and reasons only; never a secret or a credential value. */
export function formatResult({ blockers, ignored, expired }, { label }) {
  const lines = [];
  if (blockers.length === 0) {
    lines.push(`audit-gate (${label}): PASS`);
  } else {
    lines.push(`audit-gate (${label}): FAIL (${blockers.length} blocking)`);
    for (const blocker of blockers) {
      const id = blocker.ghsa ?? "no advisory id";
      const pkg = blocker.package ?? "unknown package";
      const why =
        blocker.kind === "expired"
          ? `reviewed exception expired ${blocker.expires}`
          : blocker.kind === "unidentified"
            ? "high/critical finding without an advisory object"
            : "not in the reviewed exception list";
      lines.push(`  BLOCK ${pkg} ${id} (${blocker.severity}): ${why}`);
    }
  }
  for (const entry of ignored) {
    lines.push(
      `  ALLOW ${entry.package} ${entry.ghsa} until ${entry.expires}: ${entry.reason}`,
    );
  }
  for (const entry of expired) {
    lines.push(`  EXPIRED ${entry.package} ${entry.ghsa} (${entry.expires})`);
  }
  return lines.join("\n");
}

/** Run npm audit and parse its JSON. Fails closed on any unreadable result. */
export function runNpmAudit({ omitDev = false, cwd } = {}) {
  const args = ["audit", "--json"];
  if (omitDev) args.push("--omit=dev");
  const result = spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
    timeout: 10 * 60 * 1000,
  });
  if (result.error) throw new Error(`npm audit could not run: ${result.error.message}`);
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!stdout) {
    throw new Error(
      `npm audit returned no JSON (exit ${result.status ?? "unknown"}): ` +
        `${(result.stderr ?? "").trim().slice(0, 400) || "no stderr"}`,
    );
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`npm audit returned unparseable output: ${stdout.slice(0, 400)}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const omitDev = args.includes("--omit=dev");
  const label = omitDev ? "runtime" : "full tree";
  let report;
  try {
    report = runNpmAudit({ omitDev });
  } catch (error) {
    console.error(`audit-gate (${label}): FAIL — ${error.message}`);
    process.exit(1);
  }
  const result = evaluateAudit(report);
  console.log(formatResult(result, { label }));
  if (result.blockers.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
