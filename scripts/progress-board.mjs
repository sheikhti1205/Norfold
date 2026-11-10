#!/usr/bin/env node
/**
 * Regenerate the progress board snapshot from git-bug.
 *
 * Source of truth is git-bug (issues live in git refs under refs/bugs/*), not a
 * sidecar database. This script only rewrites the sentinel block inside
 * docs/progress/board.html so the rest of the page is never touched.
 *
 *   node scripts/progress-board.mjs
 *
 * Env:
 *   GIT_BUG_BIN  path to the git-bug executable (default: `git-bug` on PATH,
 *                falling back to the extracted Windows release location).
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const board = resolve(root, "docs/progress/board.html");
const start = "<!-- BOARD_DATA_START -->";
const end = "<!-- BOARD_DATA_END -->";

const CANDIDATES = [
  process.env.GIT_BUG_BIN,
  "git-bug",
  "E:\\Tools\\git-bug\\git-bug_windows_amd64\\git-bug.exe",
].filter(Boolean);

function run(bin, args) {
  return execFileSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function pickBinary() {
  let last;
  for (const bin of CANDIDATES) {
    try {
      run(bin, ["version"]);
      return bin;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`git-bug is not runnable. Tried: ${CANDIDATES.join(", ")}. Last error: ${last?.message}`);
}

/** The migration wrote "description\n\nAcceptance: ...\n\nMigrated from ...". */
function splitMessage(message = "") {
  const text = String(message).replace(/\r\n/g, "\n").trim();
  const acceptance = text.match(/\n*Acceptance:\s*([\s\S]*?)(?:\n*Migrated from Beads [^\n]*\.?\s*)?$/i);
  const description = text
    .replace(/\n*Acceptance:[\s\S]*$/i, "")
    .replace(/\n*Migrated from Beads [^\n]*\.?\s*$/i, "")
    .trim();
  return { description, acceptance: acceptance ? acceptance[1].trim() : "" };
}

try {
  const bin = pickBinary();

  let listed;
  try {
    listed = JSON.parse(run(bin, ["bug", "--format", "json"]));
  } catch (error) {
    throw new Error(`Cannot read bugs from git-bug: ${error.message}`);
  }
  if (!Array.isArray(listed) || listed.length === 0) {
    throw new Error("git-bug returned no bugs; refusing to write an empty board.");
  }

  const issues = listed.map((bug) => {
    let full = bug;
    try {
      full = JSON.parse(run(bin, ["bug", "show", bug.human_id, "--format", "json"]));
    } catch {
      // A single unreadable bug must not abort the whole snapshot.
    }
    const firstComment = Array.isArray(full.comments) && full.comments.length ? full.comments[0].message : "";
    const { description, acceptance } = splitMessage(firstComment);

    const labels = Array.isArray(bug.labels) ? bug.labels : [];
    const priorityLabel = labels.find((label) => /^p[0-4]$/.test(label));
    const typeLabel = labels.find((label) => label.startsWith("type:"));
    const plainLabels = labels.filter((label) => !/^p[0-4]$/.test(label) && !label.startsWith("type:"));

    return {
      id: bug.human_id,
      title: bug.title,
      description,
      acceptance_criteria: acceptance,
      status: bug.status,
      priority: priorityLabel ? Number(priorityLabel.slice(1)) : 2,
      issue_type: typeLabel ? typeLabel.slice(5) : "task",
      labels: plainLabels,
      created_at: bug.create_time?.time ?? null,
      updated_at: bug.edit_time?.time ?? null,
    };
  });

  const html = await readFile(board, "utf8");
  if (html.split(start).length !== 2 || html.split(end).length !== 2 || html.indexOf(start) > html.indexOf(end)) {
    throw new Error("Board data sentinels are missing, duplicated, or out of order");
  }

  const data = JSON.stringify(issues).replace(/</g, "\\u003c");
  const replacement = `${start}\n<script type="application/json" id="board-data">${data}</script>\n${end}`;
  const updated = html.slice(0, html.indexOf(start)) + replacement + html.slice(html.indexOf(end) + end.length);

  if (updated !== html) await writeFile(board, updated, "utf8");
  console.log(`Progress board: ${issues.length} issues (${updated === html ? "unchanged" : "updated"}).`);
} catch (error) {
  console.error(`Progress board: ${error.message}`);
  process.exitCode = 1;
}
