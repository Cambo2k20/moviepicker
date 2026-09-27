begin;

create or replace function private.delete_movie_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.movie_sessions%rowtype;
  current_user_id uuid := (select auth.uid());
begin
  select session.*
  into target
  from public.movie_sessions session
  where session.id = p_session_id;

  if not found then
    raise exception 'That movie session is no longer available.';
  end if;

  if current_user_id is null then
    raise exception 'Sign in to delete a movie session.';
  end if;

  if target.host_id <> current_user_id
    and not private.is_group_admin(target.group_id) then
    raise exception 'Only the session host or a group administrator can delete this session.';
  end if;

  if not private.is_group_member(target.group_id) then
    raise exception 'You must be an approved member of this group.';
  end if;

  if exists (
    select 1
    from public.journal_entries entry
    where entry.movie_session_id = target.id
  ) then
    raise exception 'Delete the linked Journal entry before deleting this session.';
  end if;

  delete from public.movie_sessions
  where id = target.id;

  -- A deleted session should not leave its shared queue item looking watched
  -- when no other watched session still references that item.
  if target.selected_queue_item_id is not null
    and not exists (
      select 1
      from public.movie_sessions remaining
      where remaining.selected_queue_item_id = target.selected_queue_item_id
        and remaining.status = 'WATCHED'
    ) then
    update public.queue_items
    set watched = false
    where id = target.selected_queue_item_id;
  end if;

  return true;
end;
$$;

comment on function private.delete_movie_session(uuid) is
  'Deletes a host- or administrator-owned session without silently orphaning a linked Journal or leaving its queue item watched.';

create or replace function public.delete_movie_session(p_session_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.delete_movie_session(p_session_id);
$$;

revoke all on function public.delete_movie_session(uuid) from public, anon;
grant execute on function public.delete_movie_session(uuid) to authenticated;

create or replace function public.reassign_shared_films_and_remove_member(
  p_group_id uuid,
  p_old_user_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can repair a member account.';
  end if;

  if p_old_user_id is null or p_old_user_id = current_user_id then
    raise exception 'Choose a different legacy member account.';
  end if;

  if not exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = p_group_id
      and membership.user_id = p_old_user_id
  ) then
    raise exception 'That member is not part of this Cine-Cord group.';
  end if;

  update public.queue_items
  set suggested_by = current_user_id
  where group_id = p_group_id
    and suggested_by = p_old_user_id;
  get diagnostics moved = row_count;

  perform public.remove_group_member(p_group_id, p_old_user_id);
  return moved;
end;
$$;

revoke all on function public.reassign_shared_films_and_remove_member(uuid, uuid) from public, anon;
grant execute on function public.reassign_shared_films_and_remove_member(uuid, uuid) to authenticated;

comment on function public.reassign_shared_films_and_remove_member(uuid, uuid) is
  'Moves one legacy member''s shared queue suggestions to the current administrator, then removes that member''s Cine-Cord access.';

commit;
