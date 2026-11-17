import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20261117130000_feed_hide_moderated_posts.sql"),
  "utf8",
);

describe("feed moderation visibility migration", () => {
  it("gates both definer feed readers with the canonical atom", () => {
    // A definer function runs the security_invoker view as its owner, so the
    // item_posts SELECT policy is bypassed. The atom must be explicit.
    expect(sql.match(/public\.findback_can_read_post\(p\.id\)/g)).toHaveLength(2);
    expect(sql.match(/language sql\s+stable\s+security definer/g)).toHaveLength(2);
  });

  it("keeps the ordinary and nearby readers on their exact signatures", () => {
    expect(sql).toMatch(/function public\.findback_query_posts_client\(/);
    expect(sql).toMatch(/function public\.findback_query_posts_nearby_client\(/);
    expect(sql).toMatch(/p_near_lat double precision default null/);
    expect(sql).toMatch(/p_post_id text default null/);
  });

  it("keeps execute authenticated-only and never re-grants the visibility column", () => {
    expect(sql).toMatch(/revoke all on function public\.findback_query_posts_client\([^)]*\) from public, anon/);
    expect(sql).toMatch(/revoke all on function public\.findback_query_posts_nearby_client\([^)]*\) from public, anon/);
    expect(sql.match(/grant execute on function public\.findback_query_posts_(?:client|nearby_client)\([^)]*\) to authenticated/g))
      .toHaveLength(2);
    expect(sql).not.toMatch(/grant select \(moderation_visibility\)/i);
  });
});
