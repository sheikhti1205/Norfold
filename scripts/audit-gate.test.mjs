#!/usr/bin/env node
/**
 * Tests for scripts/audit-gate.mjs.
 *
 * Run: `node --test scripts/audit-gate.test.mjs` from repo root.
 * Pure Node builtins, no network, no npm invocation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  advisoriesIn,
  evaluateAudit,
  exceptionIsLive,
  formatResult,
  ghsaFromUrl,
  REVIEWED_EXCEPTIONS,
} from "./audit-gate.mjs";

const PICOMATCH = {
  vulnerabilities: {
    picomatch: {
      name: "picomatch",
      severity: "high",
      via: [
        {
          source: 1111111,
          name: "picomatch",
          dependency: "picomatch",
          title: "picomatch vulnerable to ReDoS",
          url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
          severity: "high",
          range: "*",
        },
      ],
    },
  },
};

const OTHER_HIGH = {
  vulnerabilities: {
    "left-pad": {
      name: "left-pad",
      severity: "high",
      via: [
        {
          source: 2222222,
          name: "left-pad",
          title: "Prototype pollution",
          url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          severity: "high",
          range: "<2.0.0",
        },
      ],
    },
  },
};

describe("ghsaFromUrl", () => {
  it("extracts and uppercases the advisory id", () => {
    assert.equal(
      ghsaFromUrl("https://github.com/advisories/ghsa-fc5q-39xc-vjpf"),
      "GHSA-FC5Q-39XC-VJPF",
    );
  });
  it("ignores non-advisory URLs", () => {
    assert.equal(ghsaFromUrl("https://example.com/CVE-2026-1"), null);
    assert.equal(ghsaFromUrl(undefined), null);
  });
});

describe("advisoriesIn", () => {
  it("deduplicates nested copies of the same advisory", () => {
    const report = {
      vulnerabilities: {
        picomatch: PICOMATCH.vulnerabilities.picomatch,
        fdir: {
          name: "fdir",
          severity: "high",
          via: [{ name: "picomatch", url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf", severity: "high" }],
        },
      },
    };
    const { advisories } = advisoriesIn(report);
    assert.deepEqual(advisories.map((entry) => `${entry.package}:${entry.ghsa}`).sort(), [
      "picomatch:GHSA-FC5Q-39XC-VJPF",
    ]);
  });
  it("flags a high entry with no advisory object as unidentified", () => {
    const { unidentified } = advisoriesIn({
      vulnerabilities: { ghost: { name: "ghost", severity: "critical", via: ["other"] } },
    });
    assert.deepEqual(unidentified.map((entry) => entry.package), ["ghost"]);
  });
});

describe("exceptionIsLive", () => {
  it("honours the expiry date", () => {
    const exception = { expires: "2026-12-31" };
    assert.equal(exceptionIsLive(exception, new Date("2026-12-31T12:00:00Z")), true);
    assert.equal(exceptionIsLive(exception, new Date("2027-01-01T00:00:00Z")), false);
  });
  it("fails closed on an unparseable expiry", () => {
    assert.equal(exceptionIsLive({ expires: "not-a-date" }), false);
  });
  it("treats a missing expiry as live", () => {
    assert.equal(exceptionIsLive({}), true);
  });
});

describe("evaluateAudit", () => {  it("passes a clean report", () => {
    const result = evaluateAudit({ vulnerabilities: {} });
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.ignored, []);
  });
  it("blocks a high advisory that is not reviewed", () => {
    const result = evaluateAudit(OTHER_HIGH);
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].ghsa, "GHSA-AAAA-BBBB-CCCC");
    assert.equal(result.blockers[0].kind, "unreviewed");
  });
  it("allows the reviewed picomatch advisory and reports why", () => {
    const result = evaluateAudit(PICOMATCH, REVIEWED_EXCEPTIONS, new Date("2026-11-17T00:00:00Z"));
    assert.deepEqual(result.blockers, []);
    assert.equal(result.ignored.length, 1);
    assert.equal(result.ignored[0].package, "picomatch");
  });
  it("requires the package name to match as well as the advisory id", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          copycat: {
            name: "copycat",
            severity: "high",
            via: [{ name: "copycat", url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf", severity: "high" }],
          },
        },
      },
      REVIEWED_EXCEPTIONS,
      new Date("2026-11-17T00:00:00Z"),
    );
    assert.equal(result.blockers.length, 1);
  });
  it("blocks a reviewed advisory after its expiry", () => {
    const result = evaluateAudit(PICOMATCH, REVIEWED_EXCEPTIONS, new Date("2027-02-01T00:00:00Z"));
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].kind, "expired");
    assert.equal(result.expired.length, 1);
  });
  it("ignores moderate and low advisories", () => {
    const result = evaluateAudit({
      vulnerabilities: {
        mild: {
          name: "mild",
          severity: "moderate",
          via: [{ name: "mild", url: "https://github.com/advisories/GHSA-dddd-eeee-ffff", severity: "moderate" }],
        },
      },
    });
    assert.deepEqual(result.blockers, []);
  });
  it("fails closed on an unidentified high finding", () => {
    const result = evaluateAudit({
      vulnerabilities: { ghost: { name: "ghost", severity: "high", via: [] } },
    });
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].kind, "unidentified");
  });
  it("does not flag a transitive carrier whose named cause is in the report", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          picomatch: PICOMATCH.vulnerabilities.picomatch,
          fdir: { name: "fdir", severity: "high", via: ["picomatch"] },
          vite: { name: "vite", severity: "high", via: ["picomatch", "fdir"] },
        },
      },
      REVIEWED_EXCEPTIONS,
      new Date("2026-11-17T00:00:00Z"),
    );
    assert.deepEqual(result.blockers, []);
    assert.equal(result.ignored.length, 1);
  });
  it("fails closed when the only named cause is not in the report", () => {
    const result = evaluateAudit({
      vulnerabilities: { ghost: { name: "ghost", severity: "high", via: ["absent"] } },
    });
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].kind, "unidentified");
  });
});

describe("formatResult", () => {
  it("never invents a pass while a blocker exists", () => {
    const text = formatResult(evaluateAudit(OTHER_HIGH), { label: "full tree" });
    assert.match(text, /FAIL/);
    assert.match(text, /BLOCK left-pad GHSA-AAAA-BBBB-CCCC/);
  });
  it("prints the review reason for an allowed advisory", () => {
    const text = formatResult(
      evaluateAudit(PICOMATCH, REVIEWED_EXCEPTIONS, new Date("2026-11-17T00:00:00Z")),
      { label: "full tree" },
    );
    assert.match(text, /PASS/);
    assert.match(text, /ALLOW picomatch GHSA-FC5Q-39XC-VJPF until 2027-01-31/);
  });
});
