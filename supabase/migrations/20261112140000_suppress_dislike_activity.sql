-- Preserve existing notification history; only suppress future DISLIKE events.
-- Reactions themselves remain unchanged. Other reaction notifications retain
-- the existing trigger's switching and deduplication behavior.
drop trigger if exists trg_findback_notify_reaction on public.reactions;
create trigger trg_findback_notify_reaction
  after insert on public.reactions
  for each row when (new.type <> 'DISLIKE')
  execute function public.findback_notify_reaction();
