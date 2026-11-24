#!/usr/bin/env node
/**
 * Tests for scripts/check-commit-messages.mjs.
 *
 * Run: `node --test scripts/check-commit-messages.test.mjs` from repo root.
 * Pure Node builtins. Never spawns git or prints key material.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXIT_OK,
  EXIT_VIOLATION,
  EXIT_UNRESOLVABLE,
  checkMessage,
  classifyCommit,
  encodeLog,
  evaluate,
} from "./check-commit-messages.mjs";

const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "style",
  "revert",
];

function recorder() {
  const out = [];
  const err = [];
  return {
    io: { out: (line) => out.push(String(line)), err: (line) => err.push(String(line)) },
    out,
    err,
  };
}

/** A git stub that returns one fixed log for every call. */
const fixedGit = (text) => () => text;

/** A git stub that fails every call. */
const brokenGit = () => {
  throw new Error("unknown revision");
};

describe("classifyCommit", () => {
  it("skips pull request and branch merge commits", () => {
    assert.equal(classifyCommit("Merge pull request #12 from foo/bar"), "skip");
    assert.equal(classifyCommit("Merge branch 'main'"), "skip");
    assert.equal(classifyCommit("Merge remote-tracking branch 'origin/main'"), "skip");
  });

  it("skips release automation commits", () => {
    assert.equal(classifyCommit("chore(release): v0.16.0-beta.4"), "skip");
    assert.equal(classifyCommit("Bump lodash from 4.0.0 to 4.1.0"), "skip");
  });

  it("skips git-generated revert commits", () => {
    assert.equal(classifyCommit('Revert "feat(chat): add voice notes"'), "skip");
  });

  it("treats ordinary commits as normal", () => {
    assert.equal(classifyCommit("fix: handle empty list"), "normal");
    assert.equal(classifyCommit("feat(chat): add reactions"), "normal");
    assert.equal(classifyCommit("revert: feat(chat) remove voice notes"), "normal");
  });
});

describe("checkMessage subject form", () => {
  it("accepts every conventional type", () => {
    for (const type of TYPES) {
      const result = checkMessage(`${type}: do the thing`);
      assert.equal(result.ok, true, type);
      assert.equal(result.skipped, false, type);
    }
  });

  it("accepts an optional scope", () => {
    assert.equal(checkMessage("feat(chat): add reactions").ok, true);
    assert.equal(checkMessage("fix(api,client): align retries").ok, true);
    assert.equal(checkMessage("build(scripts/check): tighten parser").ok, true);
  });

  it("accepts breaking-change markers", () => {
    assert.equal(checkMessage("feat!: replace the transport").ok, true);
    assert.equal(checkMessage("feat(api)!: replace the transport").ok, true);
  });

  it("accepts a subject-only commit with no body", () => {
    const result = checkMessage("refactor: split the relay adapter");
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects unknown types", () => {
    assert.equal(checkMessage("update: refresh dependencies").ok, false);
    assert.equal(checkMessage("WIP: half done").ok, false);
    assert.equal(checkMessage("Add thing").ok, false);
  });

  it("rejects an empty description", () => {
    assert.equal(checkMessage("fix:").ok, false);
    assert.equal(checkMessage("fix: ").ok, false);
  });

  it("rejects a whitespace-only description", () => {
    assert.equal(checkMessage("fix:    ").ok, false);
  });

  it("rejects a description without a letter", () => {
    assert.equal(checkMessage("fix: 123").ok, false);
  });

  it("rejects a subject over the length limit", () => {
    const subject = `feat: ${"x".repeat(72)}`;
    assert.ok(subject.length > 72);
    const result = checkMessage(subject);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(";"), /limit is 72/);
  });

  it("accepts a BREAKING CHANGE footer with a description", () => {
    const result = checkMessage(
      "feat: replace the transport",
      "BREAKING CHANGE: the legacy transport is removed; use the relay client.",
    );
    assert.equal(result.ok, true);
  });

  it("rejects a BREAKING CHANGE footer with no description", () => {
    const result = checkMessage("feat: replace the transport", "BREAKING CHANGE:");
    assert.equal(result.ok, false);
    assert.match(result.errors.join(";"), /must describe the break/);
  });
});

describe("checkMessage skips", () => {
  it("passes merge commits and marks them skipped", () => {
    const result = checkMessage("Merge pull request #12 from foo/bar", "");
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  });

  it("accepts a release commit", () => {
    const result = checkMessage("chore(release): v0.16.0-beta.4", "");
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  });

  it("skips a generated revert and passes the revert type", () => {
    const generated = checkMessage('Revert "feat(chat): add voice notes"', "");
    assert.equal(generated.ok, true);
    assert.equal(generated.skipped, true);

    const typed = checkMessage("revert: feat(chat) remove voice notes", "");
    assert.equal(typed.ok, true);
    assert.equal(typed.skipped, false);
  });
});

describe("evaluate range and exit codes", () => {
  it("returns 0 when every commit in the range passes", () => {
    const { io, out } = recorder();
    const git = fixedGit(
      encodeLog([
        { sha: "aaaaaaa1", subject: "feat: add a thing" },
        { sha: "bbbbbbb2", subject: "fix: repair the thing" },
      ]),
    );
    const code = evaluate(["--range", "origin/main...HEAD"], git, io);
    assert.equal(code, EXIT_OK);
    assert.match(out.join("\n"), /2 checked, 0 skipped, 2 total/);
  });

  it("returns 0 and reports zero commits for an empty but valid range", () => {
    const { io, out } = recorder();
    const code = evaluate(["--range", "origin/main...HEAD"], fixedGit(""), io);
    assert.equal(code, EXIT_OK);
    assert.match(out.join("\n"), /0 checked, 0 skipped, 0 total/);
  });

  it("returns 1 and names a bad commit in the middle of a valid range", () => {
    const { io, err } = recorder();
    const git = fixedGit(
      encodeLog([
        { sha: "aaaaaaa1", subject: "feat: add a thing" },
        { sha: "bbbbbbb2", subject: "update: nope" },
        { sha: "ccccccc3", subject: "fix: repair the thing" },
      ]),
    );
    const code = evaluate(["--range", "origin/main...HEAD"], git, io);
    assert.equal(code, EXIT_VIOLATION);
    const text = err.join("\n");
    assert.match(text, /bbbbbbb/);
    assert.match(text, /update: nope/);
    assert.match(text, /3 checked, 0 skipped, 3 total/);
  });

  it("counts merge commits as skipped rather than violations", () => {
    const { io, out } = recorder();
    const git = fixedGit(
      encodeLog([
        { sha: "aaaaaaa1", subject: "Merge pull request #9 from foo/bar" },
        { sha: "bbbbbbb2", subject: "fix: repair the thing" },
      ]),
    );
    const code = evaluate(["--range", "origin/main...HEAD"], git, io);
    assert.equal(code, EXIT_OK);
    assert.match(out.join("\n"), /1 checked, 1 skipped, 2 total/);
  });

  it("counts a generated revert as skipped rather than checked", () => {
    const { io, out } = recorder();
    const git = fixedGit(
      encodeLog([
        { sha: "aaaaaaa1", subject: 'Revert "feat(chat): add voice notes"' },
        { sha: "bbbbbbb2", subject: "fix: repair the thing" },
      ]),
    );
    const code = evaluate(["--range", "origin/main...HEAD"], git, io);
    assert.equal(code, EXIT_OK);
    assert.match(out.join("\n"), /1 checked, 1 skipped, 2 total/);
  });

  it("keeps the --count and --rev selectors working", () => {
    const { io, out } = recorder();
    const log = encodeLog([{ sha: "aaaaaaa1", subject: "fix: repair the thing" }]);
    assert.equal(evaluate(["--count", "1"], fixedGit(log), io), EXIT_OK);
    assert.equal(evaluate(["--rev", "v0.1.0-beta.1"], fixedGit(log), io), EXIT_OK);
    const summaries = out.filter((line) => line.includes("1 checked, 0 skipped, 1 total"));
    assert.equal(summaries.length, 2);
  });

  it("returns 3 and prints the fallback line when the range is unresolvable", () => {
    const { io, err } = recorder();
    const code = evaluate(["--range", "deadbeef...HEAD"], brokenGit, io);
    assert.equal(code, EXIT_UNRESOLVABLE);
    const text = err.join("\n");
    assert.match(text, /range unresolvable, falling back to the last commit only/);
  });

  it("returns 3 with no fallback under --strict-range", () => {
    const { io, err } = recorder();
    const code = evaluate(["--range", "deadbeef...HEAD", "--strict-range"], brokenGit, io);
    assert.equal(code, EXIT_UNRESOLVABLE);
    const text = err.join("\n");
    assert.doesNotMatch(text, /falling back/);
  });

  it("never silently passes a violation when the range is unresolvable", () => {
    const { io, err } = recorder();
    let calls = 0;
    const git = (args) => {
      calls += 1;
      if (args.some((arg) => arg.includes("..."))) throw new Error("unknown revision");
      return encodeLog([{ sha: "badc0de9", subject: "update: nope" }]);
    };
    const code = evaluate(["--range", "deadbeef...HEAD"], git, io);
    assert.equal(code, EXIT_VIOLATION);
    assert.notEqual(code, EXIT_OK);
    assert.ok(calls >= 2);
    assert.match(err.join("\n"), /badc0de/);
    assert.match(err.join("\n"), /update: nope/);
  });
});
