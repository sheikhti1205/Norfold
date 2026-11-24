-- Audit 2026-11-15 (P2): make report-view retention operational.
--
-- WHAT WAS MISSING. 20261112130000 created the deduplication table, its
-- increment trigger and findback_prune_report_views(90), but nothing ever
-- called the prune function: the live project has no pg_cron extension and no
-- cron.job relation, so the 90-day retention was a comment, not a policy.
--
-- WHAT THIS ADDS.
--   1. A viewer_id index. The primary key is (report_id, viewer_id, viewed_on),
--      so a cascade from auth.users deletes rows by viewer_id alone and cannot
--      use the leading report_id column.
--   2. A daily pg_cron job at 03:23 UTC that prunes rows older than 90 days.
--      The extension is created only when the platform exposes it, and every
--      failure is a warning rather than a migration abort: pg_cron is a
--      deployment capability, not part of the schema contract, and a missing
--      extension must not block a forward migration.
--
-- UNIQUENESS, STATED EXACTLY. One row per (report, viewer, calendar day). The
-- lifetime counter on item_posts is accumulated daily-unique account views and
-- is deliberately never decremented when rows age out; it is a popularity
-- signal, not a unique-visitor count.
begin;

create index if not exists report_views_viewer_id_idx
  on public.report_views (viewer_id);

do $do$
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise warning 'pg_cron is unavailable (%); report-view retention stays manual', sqlerrm;
  end;

  if to_regclass('cron.job') is not null then
    begin
      execute $sql$select cron.unschedule(jobid) from cron.job where jobname = 'findback-prune-report-views'$sql$;
      execute $sql$select cron.schedule('findback-prune-report-views', '23 3 * * *', 'select public.findback_prune_report_views(90)')$sql$;
    exception when others then
      raise warning 'report-view prune job was not scheduled (%)', sqlerrm;
    end;
  end if;
end;
$do$;

comment on table public.report_views is
  'One row per (report, viewer, calendar day). Drives the accumulated item_posts.view_count; rows older than 90 days are pruned by the findback-prune-report-views pg_cron job when pg_cron is available. The lifetime counter is intentionally not decremented.';

commit;
