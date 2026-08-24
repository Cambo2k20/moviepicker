begin;

-- private.validate_movie_session() required movie_sessions.host_id to be a
-- current group member on EVERY insert and update. Removing a member who hosts
-- a session therefore locked that session: saving a Journal draft, persisting
-- Queue Roulette state or editing the details all failed with "The session host
-- must be an approved member of this group", which says nothing useful to
-- someone who is typing a comment.
--
-- Two changes, together:
--   1. The host must still be a member when the host is SET, but a session
--      whose host later leaves keeps working and keeps its true history.
--   2. Removing a member hands their still-open session to the administrator
--      doing the removal, in the same transaction, so the group's one open
--      session never ends up owned by somebody who can no longer see it.

-- ---------------------------------------------------------------- session validation
-- Identical to 20260823214112 except for the host-membership condition.
create or replace function private.validate_movie_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.group_id <> old.group_id
    or new.created_by <> old.created_by
  ) then
    raise exception 'A movie session cannot be moved to another group or change its creator.';
  end if;

  -- Validate the host when it is assigned, not on every unrelated update. A
  -- session hosted by someone who has since left the group stays editable by an
  -- administrator and keeps showing who actually hosted that night. Row Level
  -- Security still stops the departed member from touching anything, because
  -- private.is_group_member() no longer holds for them.
  if tg_op = 'INSERT' or new.host_id is distinct from old.host_id then
    if not exists (
      select 1
      from public.group_memberships membership
      where membership.group_id = new.group_id
        and membership.user_id = new.host_id
    ) then
      raise exception 'The session host must be an approved member of this group.';
    end if;
  end if;

  if new.selected_queue_item_id is not null and not exists (
    select 1
    from public.queue_items item
    where item.id = new.selected_queue_item_id
      and item.group_id = new.group_id
  ) then
    raise exception 'The selected film must belong to this group.';
  end if;

  if tg_op = 'UPDATE'
    and new.status = 'WATCHED'
    and old.status <> 'WATCHED'
    and coalesce(current_setting('cine_cord.marking_watched', true), '') <> 'true'
  then
    raise exception 'Use mark_movie_session_watched to complete a watch session.';
  end if;

  if new.status = 'CONFIRMED' then
    if nullif(trim(new.selected_title), '') is null then
      raise exception 'A confirmed session requires a selected film.';
    end if;
    new.confirmed_at = coalesce(new.confirmed_at, now());
    new.watched_at = null;
    new.ended_at = null;
  elsif new.status = 'WATCHED' then
    if nullif(trim(new.selected_title), '') is null then
      raise exception 'A watched session requires a selected film.';
    end if;
    new.confirmed_at = coalesce(new.confirmed_at, now());
    new.watched_at = new.watch_date::timestamptz;
    new.ended_at = null;
  elsif new.status = 'ACTIVE' then
    new.confirmed_at = null;
    new.watched_at = null;
    new.ended_at = null;
  elsif new.status = 'ENDED' then
    new.ended_at = coalesce(new.ended_at, now());
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- member removal
-- Unchanged from 20260822104103 except for the open-session transfer.
create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transferred integer;
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can remove members.';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot remove your own website access.';
  end if;

  -- Hand the group's still-open session to the administrator performing the
  -- removal. Only ACTIVE and CONFIRMED sessions move: a WATCHED session is
  -- history, and rewriting its host would misreport who ran that night.
  update public.movie_sessions
  set host_id = (select auth.uid())
  where group_id = p_group_id
    and host_id = p_user_id
    and status in ('ACTIVE', 'CONFIRMED');

  get diagnostics transferred = row_count;

  if transferred > 0 then
    raise notice 'Transferred % open movie session(s) to the administrator performing the removal.', transferred;
  end if;

  delete from public.group_memberships
  where group_id = p_group_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

comment on function public.remove_group_member(uuid, uuid) is
  'Removes a member''s group access. Any ACTIVE or CONFIRMED session they host is transferred to the removing administrator first, so the group''s open session cannot be stranded.';

commit;
