-- A dislike is engagement the report owner must see: it belongs in Activity and
-- on the device exactly like a like. This restores the reaction trigger without
-- the DISLIKE exclusion, so the reaction notification function runs for every
-- inserted reaction and forwards LIKE/DISLIKE verbatim (other kinds as
-- REACTION). A switch from like to dislike replaces the owner's unread reaction
-- row for that actor and post instead of adding a second one.
--
-- History is preserved; only new reactions notify. Reactions recorded before
-- this migration are not backfilled into notifications, and nothing already in
-- the inbox is rewritten or deleted.
drop trigger if exists trg_findback_notify_reaction on public.reactions;
create trigger trg_findback_notify_reaction
  after insert on public.reactions
  for each row
  execute function public.findback_notify_reaction();
