/**
 * Static guard for the chat-file lifecycle migration
 * (20261115140000_chat_file_budget.sql) and its sweep wiring.
 *
 * No database, no network, no Deno: the migration text is parsed and the
 * properties that keep the lane safe are asserted. The engine proof for the
 * policy belongs to a disposable PostgreSQL; this is the guard that runs
 * everywhere, including where no engine exists.
 *
 * It asserts SHAPE, not prose: the checks read executable text (comments are
 * stripped) so a migration that merely mentions the budget cannot pass.
 *
 * Run: node --test supabase/tests/chat_file_budget_policy.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SUPABASE, "..");
const MIGRATION_PATH = join(SUPABASE, "migrations", "20261115140000_chat_file_budget.sql");
const TRANSPORT_MIGRATION = join(SUPABASE, "migrations", "20261112170000_chat_file_transport.sql");
const WORKFLOW = join(REPO, ".github", "workflows", "chat-media-maintenance.yml");
const DEPLOY_WORKFLOW = join(REPO, ".github", "workflows", "backend-deploy.yml");
const CLIENT_FILES = join(REPO, "apps", "mobile", "src", "services", "messaging", "files.ts");
const HANDLER = join(SUPABASE, "functions", "cleanup-chat-files", "handler.ts");
const PARITY_SCRIPT = join(REPO, "scripts", "check-edge-parity.mjs");
const PARITY_EXPECTATIONS = join(REPO, "scripts", "edge-jwt-expectations.json");

const read = (path) => readFileSync(path, "utf8");
const migration = read(MIGRATION_PATH);

/**
 * Remove `--` comments without touching a string literal or a dollar-quoted
 * body, so prose cannot satisfy an executable-text check and an apostrophe in a
 * COMMENT body cannot swallow the next statement.
 */
function stripComments(source) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === "'") {
      out += ch;
      index += 1;
      while (index < source.length) {
        out += source[index];
        if (source[index] === "'") {
          if (source[index + 1] === "'") {
            out += source[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (ch === "$") {
      const opener = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(index));
      if (opener) {
        const end = source.indexOf(opener[0], index + opener[0].length);
        const stop = end === -1 ? source.length : end + opener[0].length;
        out += source.slice(index, stop);
        index = stop;
        continue;
      }
    }
    if (ch === "-" && source[index + 1] === "-") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

const code = stripComments(migration);
const flat = code.replace(/\s+/g, " ");

/** Header and body of one declared function, split at its dollar-quoted body. */
function functionParts(name) {
  const marker = `create or replace function public.${name}(`;
  const start = code.indexOf(marker);
  if (start < 0) return null;
  const asAt = code.indexOf("as $$", start);
  if (asAt < 0) return null;
  const bodyStart = asAt + "as $$".length;
  const bodyEnd = code.indexOf("$$;", bodyStart);
  if (bodyEnd < 0) return null;
  return { header: code.slice(start, asAt), body: code.slice(bodyStart, bodyEnd) };
}

const BUDGET = 104857600;

describe("the chat-file budget migration is shaped for the hosted schema", () => {
  it("measures the account total with a definer, pinned search path and no client grant", () => {
    const parts = functionParts("findback_chat_file_bytes_used");
    assert.ok(parts, "public.findback_chat_file_bytes_used is declared");
    assert.match(parts.header, /returns\s+bigint/i);
    assert.match(parts.header, /security\s+definer/i);
    assert.match(parts.header, /set\s+search_path\s*=\s*public,\s*pg_temp\s*$/i);
    assert.match(parts.body, /from\s+storage\.objects\s+o/i, "the total is read from storage.objects");
    assert.match(parts.body, /o\.bucket_id\s*=\s*'findback-chat-files'/i);
    assert.match(
      parts.body,
      /starts_with\(o\.name,\s*'files\/'\s*\|\|\s*p_user_id\s*\|\|\s*'\/'\)/i,
      "the total is scoped to the account's own prefix",
    );
    assert.match(parts.body, /metadata\s*->>\s*'size'/i, "the size comes from object metadata");
    assert.match(parts.body, /coalesce/i, "an empty account totals zero");
    assert.match(
      flat,
      /revoke all on function public\.findback_chat_file_bytes_used\(text\) from public, anon, authenticated;/i,
      "the aggregate is not executable by any client role",
    );
  });

  it("enforces the cumulative 100 MB budget and refuses anything it cannot scope to the caller", () => {
    const parts = functionParts("findback_chat_file_budget_ok");
    assert.ok(parts, "public.findback_chat_file_budget_ok is declared");
    assert.match(parts.header, /p_user_id\s+text/i);
    assert.match(parts.header, /p_incoming\s+bigint/i);
    assert.match(parts.header, /security\s+definer/i);
    assert.match(parts.header, /set\s+search_path\s*=\s*public,\s*pg_temp\s*$/i);
    assert.ok(parts.body.includes(String(BUDGET)), `the 100 MB constant (${BUDGET}) is present`);
    assert.match(
      parts.body,
      /public\.findback_chat_file_bytes_used\(p_user_id\)\s*\+\s*p_incoming\s*<=\s*104857600/i,
      "used + incoming is compared against the budget",
    );
    assert.match(
      parts.body,
      /p_user_id\s*=\s*auth\.uid\(\)::text/i,
      "a direct call can only ask about its own account",
    );
    assert.match(parts.body, /p_incoming\s*>=\s*0/i, "a negative size is refused");
    assert.match(parts.body, /coalesce\(\s*[\s\S]*false\s*\)/i, "an unknown answer fails closed");
    assert.match(
      flat,
      /revoke all on function public\.findback_chat_file_budget_ok\(text, bigint\) from public, anon, authenticated;/i,
      "the predicate starts revoked from every client role",
    );
    assert.match(
      flat,
      /grant execute on function public\.findback_chat_file_budget_ok\(text, bigint\) to authenticated;/i,
      "the Storage policy runs as authenticated, so the predicate is granted back to exactly that role",
    );
  });

  it("offers the sweeper an exact, service-only reference probe", () => {
    const parts = functionParts("findback_chat_file_marker_present");
    assert.ok(parts, "public.findback_chat_file_marker_present is declared");
    assert.match(parts.header, /returns\s+boolean/i);
    assert.match(parts.header, /security\s+definer/i);
    assert.match(parts.header, /set\s+search_path\s*=\s*public,\s*pg_temp\s*$/i);
    assert.match(parts.body, /from\s+public\.chat_messages\s+m/i);
    assert.match(parts.body, /position\(p_marker in m\.body\)\s*>\s*0/i,
      "the match is an exact substring (LIKE would read the base64url underscore as a wildcard)");
    assert.doesNotMatch(parts.body, /\blike\b/i, "the probe does not use a wildcard match");
    assert.match(parts.body, /length\(p_marker\)\s*>=\s*16/i,
      "a short fragment is refused instead of matching everything");
    assert.match(
      flat,
      /revoke all on function public\.findback_chat_file_marker_present\(text\) from public, anon, authenticated;/i,
    );
    assert.match(
      flat,
      /grant execute on function public\.findback_chat_file_marker_present\(text\) to service_role;/i,
      "only the sweep may ask",
    );
  });

  it("re-creates the insert policy with the budget AND the unchanged participant check", () => {
    const dropAt = code.search(/drop policy if exists findback_chat_files_insert_own on storage\.objects;/i);
    const createAt = code.search(/create policy findback_chat_files_insert_own\s+on storage\.objects for insert to authenticated/i);
    assert.ok(dropAt >= 0, "the prior policy is dropped first");
    assert.ok(createAt > dropAt, "the policy is re-created after the drop");
    const policy = code.slice(createAt, code.indexOf(";", createAt));
    assert.match(policy, /bucket_id\s*=\s*'findback-chat-files'/);
    assert.match(policy, /\(storage\.foldername\(name\)\)\[1\]\s*=\s*'files'/);
    assert.match(
      policy,
      /\(storage\.foldername\(name\)\)\[2\]\s*=\s*\(select auth\.uid\(\)\)::text/,
      "a sender still writes only under their own uid",
    );
    assert.match(
      policy,
      /public\.findback_chat_file_participant\(\(storage\.foldername\(name\)\)\[3\]\)/,
      "the participant predicate is carried over unchanged",
    );
    assert.match(
      policy,
      /public\.findback_chat_file_budget_ok\(\s*\(select auth\.uid\(\)\)::text,\s*case\s+when\s+\(metadata ->> 'size'\) ~ '\^\[0-9\]\{1,12\}\$'\s+then\s+\(metadata ->> 'size'\)::bigint\s+end\s*\)/,
      "the incoming size is the row's own metadata, safely cast",
    );
    assert.doesNotMatch(code, /create policy (?!findback_chat_files_insert_own)/i,
      "this migration creates no other policy");
  });

  it("leaves the bucket definition and the other policies alone", () => {
    assert.doesNotMatch(code, /insert into storage\.buckets/i, "the bucket is not redefined here");
    assert.doesNotMatch(code, /drop policy if exists findback_chat_files_select_participant/i);
    assert.doesNotMatch(code, /drop policy if exists findback_chat_files_delete_own/i);
    // The per-file ceiling belongs to the transport migration; this lane only
    // adds the cumulative budget.
    assert.match(read(TRANSPORT_MIGRATION), /20971520/, "the 20 MB per-file ceiling stays where it was");
  });

  it("is static and forward-only", () => {
    assert.match(code, /^\s*begin;/im, "the migration opens a transaction");
    assert.match(code, /commit;\s*$/im, "the migration commits");
    assert.doesNotMatch(code, /\bdo\s+\$/i, "no DO block");
    assert.doesNotMatch(code, /\bexecute\s+(?:format\s*\(|'|\$)/i, "no dynamic SQL execution");
    assert.doesNotMatch(code, /\bformat\s*\(/i, "no format() DDL");
    assert.doesNotMatch(code, /drop\s+(table|column|function)\s+(if\s+exists\s+)?public\./i, "nothing is dropped");
  });
});

describe("the client and the sweeper agree on the marker", () => {
  it("both sides declare the same marker prefix", () => {
    const clientPrefix = /export const CHAT_FILE_MARKER_PREFIX = "([^"]+)"/.exec(read(CLIENT_FILES))?.[1];
    assert.equal(clientPrefix, "norfold-file:v1:", "the client writes the v1 marker prefix");
    const handler = read(HANDLER);
    assert.ok(
      handler.includes(`const MARKER_PREFIX = "${clientPrefix}";`),
      "the sweeper uses the same prefix literal",
    );
    assert.match(handler, /JSON\.stringify\(\{ k: objectKey \}\)/i,
      "the fragment is built from the object key with the client JSON shape");
    assert.match(handler, /3 \* Math\.floor\(/, "the fragment is byte-aligned to the base64 group size");
  });
});

describe("the sweep is scheduled and deployable", () => {
  it("the maintenance workflow POSTs to cleanup-chat-files after cleanup-chat-media", () => {
    const workflow = read(WORKFLOW);
    const mediaAt = workflow.indexOf("/functions/v1/cleanup-chat-media");
    const filesAt = workflow.indexOf("/functions/v1/cleanup-chat-files");
    assert.ok(mediaAt >= 0, "the media sweep is still there");
    assert.ok(filesAt > mediaAt, "the file sweep runs after it");
    // Split into steps and keep the whole step that names the endpoint, so the
    // assertions see the curl line above the endpoint string too.
    const steps = workflow.split(/\n(?= {6}- name:)/);
    const step = steps.find((block) => block.includes("/functions/v1/cleanup-chat-files"));
    assert.ok(step, "the file sweep step exists");
    assert.match(step, /--fail-with-body/, "a non-2xx answer fails the job");
    assert.match(step, /-H "apikey: \$\{SUPABASE_SECRET_KEY\}"/, "the same secret apikey header");
    assert.match(step, /GITHUB_STEP_SUMMARY/, "the counts land in the step summary");
    assert.doesNotMatch(step, /Authorization:/, "no user JWT is invented for a service lane");
  });

  it("the backend deploy workflow can deploy it, on by default", () => {
    const workflow = read(DEPLOY_WORKFLOW);
    const input = /deploy_cleanup_chat_files:[\s\S]{0,220}?default:\s*true/.exec(workflow);
    assert.ok(input, "the dispatch input exists and defaults to true");
    assert.match(
      workflow,
      /supabase functions deploy cleanup-chat-files --no-verify-jwt --yes/,
      "the deploy step mirrors the other secret-auth sweepers",
    );
  });

  it("the function is registered in the edge-parity gate", () => {
    assert.match(read(PARITY_SCRIPT), /"cleanup-chat-files"/,
      "a function directory that the parity walk cannot see fails CI");
    const expectations = JSON.parse(read(PARITY_EXPECTATIONS));
    const entry = expectations.functions["cleanup-chat-files"];
    assert.ok(entry, "the JWT contract manifest names the function");
    assert.equal(entry.verifyJwt, false, "a secret-auth sweep is deployed with --no-verify-jwt");
    assert.ok(entry.evidence.some((item) => item.class === "deploy"));
  });
});
