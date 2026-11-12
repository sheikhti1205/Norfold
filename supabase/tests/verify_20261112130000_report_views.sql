-- Transactional report-view deduplication and retention checks.
begin;
insert into public.users(id, username, email, phone, email_verified, created_at, updated_at)
values
 ('00000000-0000-4000-9630-000000000001','views_test_one','views_one@example.invalid','+8801964300001',1,'2026-11-12','2026-11-12'),
 ('00000000-0000-4000-9630-000000000002','views_test_two','views_two@example.invalid','+8801964300002',1,'2026-11-12','2026-11-12');
insert into public.item_posts(id, user_id, type, title, description, category, status, event_date, created_at, updated_at)
values ('00000000-0000-4000-9630-000000000003', '00000000-0000-4000-9630-000000000001',
  'LOST', 'View test', 'View test', 'OTHER', 'OPEN', '2026-11-12', '2026-11-12', '2026-11-12');

do $$
declare
  v_report constant uuid := '00000000-0000-4000-9630-000000000003';
  v_one constant text := '00000000-0000-4000-9630-000000000001';
  v_two constant text := '00000000-0000-4000-9630-000000000002';
begin
  perform set_config('request.jwt.claim.sub', v_one, true);
  perform public.findback_record_report_view(v_report);
  if (select view_count from public.item_posts where id = v_report::text) <> 1 then raise exception 'first view not counted'; end if;
  perform public.findback_record_report_view(v_report);
  if (select view_count from public.item_posts where id = v_report::text) <> 1 then raise exception 'duplicate counted'; end if;
  perform set_config('request.jwt.claim.sub', v_two, true);
  perform public.findback_record_report_view(v_report);
  if (select view_count from public.item_posts where id = v_report::text) <> 2 then raise exception 'second viewer not counted'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.findback_record_report_view(v_report);
    raise exception 'anonymous view accepted';
  exception when insufficient_privilege then null; end;
  if (select view_count from public.item_posts where id = v_report::text) <> 2 then raise exception 'anonymous view counted'; end if;
  update public.report_views set viewed_on = current_date - 91 where report_id = v_report::text and viewer_id = v_one;
  perform public.findback_prune_report_views();
  if exists (select 1 from public.report_views where report_id = v_report::text and viewer_id = v_one)
    or not exists (select 1 from public.report_views where report_id = v_report::text and viewer_id = v_two)
    or (select view_count from public.item_posts where id = v_report::text) <> 2 then
    raise exception 'retention incorrect';
  end if;
end $$;
rollback;
