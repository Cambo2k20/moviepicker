
create or replace function public.create_journal_entry(
  p_group_id uuid,
  p_title text,
  p_release_year integer,
  p_watched_at date,
  p_status text,
  p_comment text,
  p_viewer_ids uuid[]
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_entry public.journal_entries;
  requested_viewers integer;
  valid_viewers integer;
begin
  requested_viewers := coalesce(array_length(p_viewer_ids, 1), 0);
  if requested_viewers = 0 then
    raise exception 'Choose at least one viewer.';
  end if;

  select count(distinct viewer_id)
  into valid_viewers
  from unnest(p_viewer_ids) as viewer_id
  where exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = p_group_id
      and membership.user_id = viewer_id
  );

  if valid_viewers <> requested_viewers then
    raise exception 'Every viewer must be an approved member of this group.';
  end if;

  insert into public.journal_entries (
    group_id, title, release_year, watched_at, status, comment, created_by
  ) values (
    p_group_id, trim(p_title), p_release_year, p_watched_at,
    upper(p_status), nullif(trim(p_comment), ''), (select auth.uid())
  )
  returning * into new_entry;

  insert into public.entry_viewers (entry_id, profile_id)
  select new_entry.id, viewer_id
  from unnest(p_viewer_ids) as viewer_id;

  return new_entry.entry_number;
end;
$$;

revoke all on function public.create_journal_entry(uuid, text, integer, date, text, text, uuid[]) from public, anon;
grant execute on function public.create_journal_entry(uuid, text, integer, date, text, text, uuid[]) to authenticated;
