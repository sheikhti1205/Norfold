/**
 * Account deletion must sweep every Storage namespace that holds user bytes.
 *
 * The chat-file bucket (20261112170000) shipped without a registry entry and
 * nothing noticed: the Deno test in supabase/functions/delete-account asserts
 * the hand-maintained list, and no CI job runs Deno. This guard is Node-only,
 * runs in the existing script-test step, and discovers buckets from the
 * migrations instead of trusting the list it is checking.
 *
 * Run: node --test supabase/tests/delete_account_bucket_coverage.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const DELETE_ACCOUNT = join(ROOT, "supabase", "functions", "delete-account", "index.ts");

/** Bucket ids created by any migration, parsed from storage.buckets inserts. */
function bucketsCreatedByMigrations() {
  const buckets = new Set();
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, name), "utf8");
    for (const block of sql.split(/insert\s+into\s+storage\.buckets/i).slice(1)) {
      const statement = block.split(";")[0] ?? "";
      for (const match of statement.matchAll(/'([a-z0-9][a-z0-9-]{2,})'/gi)) buckets.add(match[1]);
    }
  }
  return buckets;
}

/** Bucket names the delete-account registry claims to sweep. */
function registeredBuckets() {
  const source = readFileSync(DELETE_ACCOUNT, "utf8");
  const start = source.indexOf("OWNED_STORAGE_NAMESPACES");
  assert.ok(start >= 0, "delete-account declares OWNED_STORAGE_NAMESPACES");
  const end = source.indexOf("];", start);
  assert.ok(end > start, "the registry list is closed");
  return new Set([...source.slice(start, end).matchAll(/bucket:\s*"([^"]+)"/g)].map((m) => m[1]));
}

/**
 * Buckets whose bytes are removed by a different owner. Anything else must be
 * in the account sweep: a new bucket without a sweep is how the chat-file
 * bucket escaped account deletion in the first place.
 */
const OTHER_OWNER = new Map([
  ["findback-chat-media", "the M7P chat-media erasure queue removes these bytes"],
  ["findback-chat-moderation-evidence", "service-owned moderation copies"],
]);

describe("account deletion covers every migrated Storage bucket", () => {
  it("sweeps the chat-file bucket", () => {
    assert.ok(
      registeredBuckets().has("findback-chat-files"),
      "findback-chat-files must be swept by delete-account",
    );
  });

  it("leaves no migrated bucket without a deletion owner", () => {
    const created = bucketsCreatedByMigrations();
    assert.ok(created.size >= 5, `expected the migrated buckets, saw ${[...created].join(", ")}`);
    const registered = registeredBuckets();
    const missing = [...created].filter((bucket) => !registered.has(bucket) && !OTHER_OWNER.has(bucket));
    assert.deepEqual(
      missing,
      [],
      `a migration creates a bucket that no deletion path covers: ${missing.join(", ")}`,
    );
  });

  it("catches a bucket that a migration adds later", () => {
    const created = new Set([...bucketsCreatedByMigrations(), "findback-unlisted-bucket"]);
    const registered = registeredBuckets();
    const missing = [...created].filter((bucket) => !registered.has(bucket) && !OTHER_OWNER.has(bucket));
    assert.deepEqual(missing, ["findback-unlisted-bucket"], "an unlisted bucket is drift");
  });
});
