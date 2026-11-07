-- Forward migration: browser push subscriptions and their delivery queue.
--
-- Android reaches the OS through FCM. A browser tab has no equivalent, so the
-- web build stores a standard Web Push subscription (endpoint + encryption
-- keys) and the server sends a content-free wake through it after the tab has
-- closed. The wake reuses the same eligibility rules as the FCM path so a
-- blocked pair, a declined request, an unsent message or a disabled preference
-- suppresses both channels identically.
begin;

create table public.web_push_subscriptions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  -- The browser's own endpoint and its two public encryption keys. No message
  -- content, no token that could be replayed as a credential.
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (endpoint)
);

create index web_push_subscriptions_user on public.web_push_subscriptions(user_id);

alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from public, anon, authenticated;

-- A browser that re-subscribes may keep the same endpoint with rotated keys, so
-- the endpoint is the identity and the row is refreshed in place. Signing into
-- another account on the same browser re-points the endpoint instead of leaving
-- a delivery path to the previous account.
create or replace function public.findback_register_web_push_subscription_client(
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2048 then
    raise exception 'Invalid push endpoint' using errcode = '22023';
  end if;
  if p_p256dh is null or length(p_p256dh) < 40 or length(p_p256dh) > 200
    or p_auth is null or length(p_auth) < 8 or length(p_auth) > 64 then
    raise exception 'Invalid push keys' using errcode = '22023';
  end if;
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
  values (v_uid, p_endpoint, p_p256dh, p_auth, clock_timestamp())
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    updated_at = excluded.updated_at;
  -- Bound the fan-out: the oldest extra browsers for this account are dropped.
  delete from public.web_push_subscriptions s
  where s.user_id = v_uid and s.id not in (
    select keep.id from public.web_push_subscriptions keep
    where keep.user_id = v_uid order by keep.updated_at desc limit 5
  );
end;
$$;

create or replace function public.findback_unregister_web_push_subscription_client(p_endpoint text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := auth.uid()::text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  delete from public.web_push_subscriptions
  where endpoint = p_endpoint and user_id = v_uid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- One send attempt per wake. A killed worker loses at most that attempt; a
-- retry is not needed because the wake is content-free and idempotent.
alter table public.chat_external_wakes
  add column if not exists web_notified_at timestamptz;

/**
 * Eligible wakes with every current browser endpoint for their recipient.
 * One row per subscription so the sender can report a dead endpoint precisely.
 * A wake with no subscription simply never appears and stays unnotified.
 */
create or replace function public.findback_web_push_wakes(p_limit integer default 50)
returns table (
  wake_id text,
  recipient_id text,
  conversation_id text,
  kind text,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  return query
  select w.id, w.recipient_id, w.conversation_id, w.kind, s.endpoint, s.p256dh, s.auth
  from public.chat_external_wakes w
  join public.chat_conversations c on c.id = w.conversation_id
  join public.chat_messages m on m.id = w.message_id and m.conversation_id = w.conversation_id
  join public.web_push_subscriptions s on s.user_id = w.recipient_id
  where w.web_notified_at is null
    and w.expires_at > clock_timestamp()
    and m.unsent_at is null
    and w.recipient_id in (c.user_a, c.user_b)
    and m.sender_id in (c.user_a, c.user_b)
    and m.sender_id <> w.recipient_id
    and exists (
      select 1 from public.chat_message_audience a
      where a.message_id = m.id and a.user_id = w.recipient_id
    )
    and not public.findback_is_blocked_pair(c.user_a, c.user_b)
    and exists (
      select 1 from public.notification_preferences p
      where p.user_id = w.recipient_id and p.push_enabled = 1
    )
    and (w.kind <> 'CHAT_CONNECTED' or exists (
      select 1 from public.notification_preferences p
      where p.user_id = w.recipient_id and p.messages = 1
    ))
    and (w.kind <> 'CHAT_CONNECTED' or (
      c.state = 'CONNECTED' and c.receipt_connection_epoch is not distinct from w.connection_epoch
    ))
    and (w.kind <> 'CHAT_REQUEST' or (
      c.state = 'REQUEST'
      and c.request_epoch is not distinct from w.request_epoch
      and m.first_approach
      and exists (
        select 1 from public.chat_participant_views v
        where v.conversation_id = c.id and v.user_id = w.recipient_id
          and v.request_direction = 'INCOMING' and not v.hidden and not v.declined
      )
    ))
  order by w.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

create or replace function public.findback_finish_web_push_wake(p_wake_id text)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  update public.chat_external_wakes
  set web_notified_at = clock_timestamp()
  where id = p_wake_id and web_notified_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

/** A 404/410 from the push service means the browser is gone for good. */
create or replace function public.findback_prune_web_push_subscription(p_endpoint text)
returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  delete from public.web_push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.findback_register_web_push_subscription_client(text, text, text) from public, anon;
grant execute on function public.findback_register_web_push_subscription_client(text, text, text) to authenticated;
revoke all on function public.findback_unregister_web_push_subscription_client(text) from public, anon;
grant execute on function public.findback_unregister_web_push_subscription_client(text) to authenticated;

revoke all on function public.findback_web_push_wakes(integer) from public, anon, authenticated;
grant execute on function public.findback_web_push_wakes(integer) to service_role;
revoke all on function public.findback_finish_web_push_wake(text) from public, anon, authenticated;
grant execute on function public.findback_finish_web_push_wake(text) to service_role;
revoke all on function public.findback_prune_web_push_subscription(text) from public, anon, authenticated;
grant execute on function public.findback_prune_web_push_subscription(text) to service_role;

commit;
