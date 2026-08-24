-- Rollback for 20260824104512_protect_sessions_on_member_removal.
--
-- Restores private.validate_movie_session() as 20260823214112 defined it and
-- public.remove_group_member() as 20260822104103 defined it.
--
-- Destructive effects:
-- - Host transfers already performed by the newer remove_group_member are NOT
--   reversed; those sessions keep the administrator as host.
-- - Any session whose host is no longer a group member becomes unwritable
--   again, including Journal drafts and Queue Roulette state, until an
--   administrator transfers the host. Check for these before rolling back:
--
--     select s.id, s.status, s.host_id
--     from public.movie_sessions s
--     left join public.group_memberships m
--       on m.group_id = s.group_id and m.user_id = s.host_id
--     where m.user_id is null;

begin;

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

  if not exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = new.group_id
      and membership.user_id = new.host_id
  ) then
    raise exception 'The session host must be an approved member of this group.';
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

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if not private.is_group_admin(p_group_id) then raise exception 'Only a group administrator can remove members.'; end if;
  if p_user_id = (select auth.uid()) then raise exception 'You cannot remove your own website access.'; end if;
  delete from public.group_memberships where group_id = p_group_id and user_id = p_user_id;
end;
$$;

revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

comment on function public.remove_group_member(uuid, uuid) is null;

commit;
