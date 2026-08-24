begin;

-- Phase 1 keeps the three historical Discord channels untouched. Their exported
-- messages are imported as immutable archive records, while website-created
-- entries keep their existing lifecycle and gain creator-owned editing.

-- ---------------------------------------------------------------- Discord identity
-- This is a server-synchronised projection of auth.identities. Browser clients
-- can read only the non-sensitive card fields and cannot supply or alter any of
-- the Discord values themselves.
create table public.discord_identities (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  discord_user_id text not null unique check (discord_user_id ~ '^[0-9]+$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text check (
    avatar_url is null
    or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://')
  ),
  provider_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

alter table public.discord_identities enable row level security;

create policy discord_identities_select_shared_group
on public.discord_identities for select
to authenticated
using (
  profile_id = (select auth.uid())
  or private.shares_group_with(profile_id)
);

revoke all on table public.discord_identities from public, anon, authenticated;
grant select (profile_id, display_name, avatar_url, synced_at)
  on table public.discord_identities to authenticated;
grant select on table public.discord_identities to service_role;
grant select on table public.entry_viewers to service_role;

create or replace function private.sync_my_discord_identity()
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text,
  synced_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  provider_user_id text;
  provider_data jsonb;
  provider_changed_at timestamptz;
  resolved_display_name text;
  resolved_avatar_url text;
begin
  if caller_id is null then
    raise exception 'Sign in to synchronise a Discord identity.';
  end if;

  if not exists (
    select 1
    from public.group_memberships membership
    where membership.user_id = caller_id
  ) then
    raise exception 'Approved Cine-Cord membership is required.';
  end if;

  select
    identity.provider_id,
    identity.identity_data,
    identity.updated_at
  into provider_user_id, provider_data, provider_changed_at
  from auth.identities identity
  where identity.user_id = caller_id
    and identity.provider = 'discord'
  order by identity.updated_at desc, identity.created_at desc
  limit 1;

  -- Email/password members can keep using Cine-Cord without a Discord identity.
  if nullif(trim(provider_user_id), '') is null then
    return;
  end if;

  if provider_user_id !~ '^[0-9]+$' then
    raise exception 'Discord returned an invalid account identifier.';
  end if;

  select left(coalesce(
    nullif(trim(provider_data ->> 'full_name'), ''),
    nullif(trim(provider_data ->> 'global_name'), ''),
    nullif(trim(provider_data ->> 'name'), ''),
    nullif(trim(provider_data ->> 'preferred_username'), ''),
    nullif(trim(provider_data ->> 'username'), ''),
    nullif(trim(profile.display_name), ''),
    'Discordian'
  ), 80)
  into resolved_display_name
  from public.profiles profile
  where profile.id = caller_id;

  resolved_avatar_url := nullif(trim(coalesce(
    provider_data ->> 'avatar_url',
    provider_data ->> 'picture',
    ''
  )), '');

  if resolved_avatar_url is not null and (
    char_length(resolved_avatar_url) > 2048
    or resolved_avatar_url !~ '^https://'
  ) then
    resolved_avatar_url := null;
  end if;

  insert into public.discord_identities as discord_identity (
    profile_id,
    discord_user_id,
    display_name,
    avatar_url,
    provider_updated_at,
    synced_at
  ) values (
    caller_id,
    provider_user_id,
    resolved_display_name,
    resolved_avatar_url,
    provider_changed_at,
    now()
  )
  on conflict on constraint discord_identities_pkey do update
  set discord_user_id = excluded.discord_user_id,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      provider_updated_at = excluded.provider_updated_at,
      synced_at = excluded.synced_at;

  return query
  select
    identity.profile_id,
    identity.display_name,
    identity.avatar_url,
    identity.synced_at
  from public.discord_identities identity
  where identity.profile_id = caller_id;
end;
$$;

revoke all on function private.sync_my_discord_identity() from public, anon, authenticated;
grant execute on function private.sync_my_discord_identity() to authenticated;

create or replace function public.sync_my_discord_identity()
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text,
  synced_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.sync_my_discord_identity();
$$;

revoke all on function public.sync_my_discord_identity() from public, anon;
grant execute on function public.sync_my_discord_identity() to authenticated;

-- ---------------------------------------------------------------- archive provenance
create table public.journal_volumes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  discord_guild_id text not null,
  discord_channel_id text not null,
  channel_name text not null check (char_length(channel_name) between 1 and 100),
  display_name text not null check (char_length(display_name) between 1 and 100),
  sort_order smallint not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  unique (discord_guild_id, discord_channel_id),
  unique (id, group_id),
  unique (group_id, sort_order)
);

create table public.journal_archive_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  volume_id uuid not null,
  discord_message_id text not null unique check (discord_message_id ~ '^[0-9]+$'),
  discord_jump_url text not null check (
    char_length(discord_jump_url) <= 2048
    and discord_jump_url ~ '^https://discord\.com/channels/'
  ),
  entry_label text not null check (char_length(entry_label) between 1 and 200),
  entry_sort_number numeric(14, 3),
  title text not null check (char_length(title) between 1 and 300),
  release_year integer check (release_year between 1888 and 2200),
  watched_at date,
  status text not null default 'UNKNOWN'
    check (status in ('FINISHED', 'DNF', 'UNKNOWN')),
  comment text,
  viewer_names text[] not null default '{}'::text[],
  author_discord_user_id text check (
    author_discord_user_id is null or author_discord_user_id ~ '^[0-9]+$'
  ),
  author_display_name text not null check (char_length(author_display_name) between 1 and 100),
  author_avatar_url text check (
    author_avatar_url is null
    or (char_length(author_avatar_url) <= 2048 and author_avatar_url ~ '^https://')
  ),
  message_created_at timestamptz not null,
  message_edited_at timestamptz,
  raw_content text not null,
  parser_status text not null default 'PARSED'
    check (parser_status in ('PARSED', 'REVIEW')),
  parser_notes text[] not null default '{}'::text[],
  source_schema_version integer,
  imported_at timestamptz not null default now(),
  constraint journal_archive_entries_volume_group_fk
    foreign key (volume_id, group_id)
    references public.journal_volumes(id, group_id)
    on delete restrict
);

create index journal_archive_entries_group_sort_idx
  on public.journal_archive_entries (group_id, entry_sort_number desc nulls last, message_created_at desc);
create index journal_archive_entries_volume_created_idx
  on public.journal_archive_entries (volume_id, message_created_at desc);
create index journal_archive_entries_title_search_idx
  on public.journal_archive_entries (group_id, lower(title));

alter table public.journal_volumes enable row level security;
alter table public.journal_archive_entries enable row level security;

create policy journal_volumes_select_group
on public.journal_volumes for select
to authenticated
using (private.is_group_member(group_id));

create policy journal_archive_entries_select_group
on public.journal_archive_entries for select
to authenticated
using (private.is_group_member(group_id));

revoke all on table public.journal_volumes from public, anon, authenticated;
revoke all on table public.journal_archive_entries from public, anon, authenticated;
grant select on table public.journal_volumes to authenticated;
grant select on table public.journal_archive_entries to authenticated;
grant select, insert, update on table public.journal_volumes to service_role;
grant select, insert, update on table public.journal_archive_entries to service_role;

insert into public.journal_volumes (
  group_id,
  discord_guild_id,
  discord_channel_id,
  channel_name,
  display_name,
  sort_order
)
select group_row.id, seed.discord_guild_id, seed.discord_channel_id, seed.channel_name, seed.display_name, seed.sort_order
from public.groups group_row
cross join (values
  ('272427070779293697', '713935563912118293', 'the-journal', 'The Journal', 1::smallint),
  ('272427070779293697', '995528992985710682', 'the-journal-strikes-back', 'The Journal Strikes Back', 2::smallint),
  ('272427070779293697', '1353823481413763132', 'return-of-the-journal', 'Return of the Journal', 3::smallint)
) as seed(discord_guild_id, discord_channel_id, channel_name, display_name, sort_order)
where group_row.slug = 'the-discordians'
on conflict (discord_guild_id, discord_channel_id) do update
set channel_name = excluded.channel_name,
    display_name = excluded.display_name,
    sort_order = excluded.sort_order;

-- ---------------------------------------------------------------- current entry ownership and freshness
create or replace function private.protect_journal_entry_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id <> old.group_id
    or new.created_by is distinct from old.created_by
    or new.movie_session_id is distinct from old.movie_session_id
  then
    raise exception 'A Journal entry cannot change its group, creator or source session.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_journal_entry_identity() from public, anon, authenticated;

create trigger journal_entries_protect_identity
before update on public.journal_entries
for each row execute function private.protect_journal_entry_identity();

create or replace function private.touch_journal_entry_from_viewer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_entry_id uuid := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
begin
  update public.journal_entries
  set updated_at = clock_timestamp()
  where id = target_entry_id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.touch_journal_entry_from_viewer() from public, anon, authenticated;

create trigger entry_viewers_touch_journal_entry
after insert or update or delete on public.entry_viewers
for each row execute function private.touch_journal_entry_from_viewer();

drop policy if exists journal_entries_update_owner_or_admin on public.journal_entries;
create policy journal_entries_update_owner_or_admin
on public.journal_entries for update
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_group_admin(group_id)
)
with check (
  private.is_group_member(group_id)
  and (
    created_by = (select auth.uid())
    or private.is_group_admin(group_id)
  )
);

drop policy if exists journal_entries_delete_owner_or_admin on public.journal_entries;
create policy journal_entries_delete_owner_or_admin
on public.journal_entries for delete
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_group_admin(group_id)
);

drop policy if exists entry_viewers_insert_owner_or_admin on public.entry_viewers;
create policy entry_viewers_insert_owner_or_admin
on public.entry_viewers for insert
to authenticated
with check (
  exists (
    select 1
    from public.journal_entries entry
    join public.group_memberships membership
      on membership.group_id = entry.group_id
     and membership.user_id = entry_viewers.profile_id
    where entry.id = entry_viewers.entry_id
      and (
        entry.created_by = (select auth.uid())
        or private.is_group_admin(entry.group_id)
      )
  )
);

drop policy if exists entry_viewers_delete_owner_or_admin on public.entry_viewers;
create policy entry_viewers_delete_owner_or_admin
on public.entry_viewers for delete
to authenticated
using (
  exists (
    select 1
    from public.journal_entries entry
    where entry.id = entry_viewers.entry_id
      and (
        entry.created_by = (select auth.uid())
        or private.is_group_admin(entry.group_id)
      )
  )
);

create or replace function public.update_journal_entry(
  p_entry_id uuid,
  p_entry_number bigint,
  p_title text,
  p_release_year integer,
  p_watched_at date,
  p_status text,
  p_comment text,
  p_viewer_ids uuid[]
)
returns public.journal_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.journal_entries;
  saved public.journal_entries;
  requested_viewers integer;
  valid_viewers integer;
  viewer_names text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to edit a Journal entry.';
  end if;

  select * into target
  from public.journal_entries
  where id = p_entry_id;

  if target.id is null then
    raise exception 'That Journal entry does not exist, or you cannot view it.';
  end if;

  if not (
    target.created_by = (select auth.uid())
    or private.is_group_admin(target.group_id)
  ) then
    raise exception 'Only the entry creator or a website administrator can edit this Journal entry.';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'Enter a Journal title.';
  end if;

  if p_watched_at is null then
    raise exception 'Choose the date the film was watched.';
  end if;

  if p_release_year is not null and (p_release_year < 1888 or p_release_year > 2200) then
    raise exception 'Choose a release year between 1888 and 2200.';
  end if;

  if upper(p_status) not in ('FINISHED', 'DNF') then
    raise exception 'Journal status must be Finished or DNF.';
  end if;

  if p_entry_number is not null and p_entry_number < 1 then
    raise exception 'Entry number must be positive.';
  end if;

  if char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'Journal comments cannot exceed 2000 characters.';
  end if;

  requested_viewers := coalesce(array_length(p_viewer_ids, 1), 0);
  if requested_viewers = 0 then
    raise exception 'Choose at least one viewer.';
  end if;

  if requested_viewers <> (
    select count(distinct viewer_id)
    from unnest(p_viewer_ids) as viewer_id
  ) then
    raise exception 'Each viewer may only be added once.';
  end if;

  select count(*) into valid_viewers
  from public.group_memberships membership
  where membership.group_id = target.group_id
    and membership.user_id = any(p_viewer_ids);

  if valid_viewers <> requested_viewers then
    raise exception 'Every viewer must be an approved member of this group.';
  end if;

  if p_entry_number is not null and exists (
    select 1
    from public.journal_entries existing
    where existing.group_id = target.group_id
      and existing.entry_number = p_entry_number
      and existing.id <> target.id
  ) then
    raise exception 'Journal entry #% already exists in this group. Choose a different number.', p_entry_number;
  end if;

  update public.journal_entries
  set entry_number = coalesce(p_entry_number, entry_number),
      title = trim(p_title),
      release_year = p_release_year,
      watched_at = p_watched_at,
      status = upper(p_status),
      comment = nullif(trim(p_comment), '')
  where id = target.id
  returning * into saved;

  delete from public.entry_viewers
  where entry_id = target.id;

  insert into public.entry_viewers (entry_id, profile_id)
  select target.id, requested.id
  from unnest(p_viewer_ids) with ordinality as requested(id, position)
  order by requested.position;

  if p_entry_number is not null then
    perform private.sync_journal_entry_number_sequence();
  end if;

  select string_agg(profile.display_name, ', ' order by requested.position)
  into viewer_names
  from unnest(p_viewer_ids) with ordinality as requested(id, position)
  join public.profiles profile on profile.id = requested.id;

  if target.movie_session_id is not null then
    update public.movie_sessions
    set journal_draft = jsonb_build_object(
      'sessionId', target.movie_session_id,
      'entryNumber', saved.entry_number::text,
      'title', saved.title,
      'year', coalesce(saved.release_year::text, ''),
      'viewerIds', to_jsonb(p_viewer_ids),
      'viewers', coalesce(viewer_names, ''),
      'status', case when saved.status = 'DNF' then 'DNF' else 'Finished' end,
      'comment', coalesce(saved.comment, '')
    )
    where id = target.movie_session_id;
  end if;

  -- Viewer triggers touch updated_at after the initial UPDATE, so return the
  -- final row that Discord freshness comparisons will observe.
  select * into saved
  from public.journal_entries
  where id = target.id;

  return saved;

exception
  when unique_violation then
    if position('journal_entries_group_id_entry_number_key' in sqlerrm) > 0 then
      raise exception 'Journal entry #% already exists in this group. Choose a different number.', p_entry_number
        using errcode = 'unique_violation';
    end if;
    raise;
end;
$$;

revoke all on function public.update_journal_entry(uuid, bigint, text, integer, date, text, text, uuid[]) from public, anon;
grant execute on function public.update_journal_entry(uuid, bigint, text, integer, date, text, text, uuid[]) to authenticated;

alter table public.discord_publications
  drop constraint discord_publications_status_check,
  drop constraint discord_publications_message_identity_complete;

alter table public.discord_publications
  add column poster_display_name text not null default 'Discordian'
    check (char_length(poster_display_name) between 1 and 80),
  add column poster_avatar_url text check (
    poster_avatar_url is null
    or (char_length(poster_avatar_url) <= 2048 and poster_avatar_url ~ '^https://')
  ),
  add column synced_entry_updated_at timestamptz,
  add column last_synced_by uuid references public.profiles(id) on delete restrict,
  add column last_synced_at timestamptz,
  add column discord_updated_at timestamptz,
  add constraint discord_publications_status_check
    check (status in ('POSTING', 'POSTED', 'UPDATING', 'UPDATE_FAILED', 'FAILED', 'UNKNOWN')),
  add constraint discord_publications_message_identity_complete check (
    (
      status in ('POSTED', 'UPDATING', 'UPDATE_FAILED')
      and discord_channel_id is not null
      and discord_message_id is not null
      and posted_at is not null
    )
    or status not in ('POSTED', 'UPDATING', 'UPDATE_FAILED')
  );

update public.discord_publications publication
set poster_display_name = coalesce(profile.display_name, 'Discordian'),
    synced_entry_updated_at = case when publication.status = 'POSTED' then entry.updated_at else null end,
    last_synced_by = case when publication.status = 'POSTED' then publication.posted_by else null end,
    last_synced_at = case when publication.status = 'POSTED' then publication.posted_at else null end
from public.journal_entries entry,
     public.profiles profile
where entry.id = publication.journal_entry_id
  and profile.id = publication.posted_by;

create index discord_publications_last_synced_by_idx
  on public.discord_publications (last_synced_by)
  where last_synced_by is not null;

-- ---------------------------------------------------------------- master catalog
create view public.journal_catalog
with (security_invoker = true)
as
with current_viewers as (
  select
    viewer.entry_id,
    coalesce(
      array_agg(profile.display_name order by lower(profile.display_name), profile.id)
        filter (where profile.id is not null),
      '{}'::text[]
    ) as viewer_names
  from public.entry_viewers viewer
  join public.profiles profile on profile.id = viewer.profile_id
  group by viewer.entry_id
)
select
  'current:' || entry.id::text as catalog_id,
  'CINE_CORD'::text as source_type,
  entry.id as record_id,
  entry.id as journal_entry_id,
  null::uuid as archive_entry_id,
  entry.group_id,
  entry.entry_number::text as entry_label,
  entry.entry_number::numeric as entry_sort_number,
  entry.title,
  entry.release_year,
  entry.watched_at,
  entry.status,
  entry.comment,
  coalesce(viewers.viewer_names, '{}'::text[]) as viewer_names,
  entry.created_by,
  coalesce(creator.display_name, 'Former member') as author_display_name,
  null::uuid as volume_id,
  'Cine-Cord'::text as volume_name,
  publication.discord_guild_id,
  publication.discord_channel_id,
  publication.discord_message_id,
  case
    when publication.discord_guild_id is not null
      and publication.discord_channel_id is not null
      and publication.discord_message_id is not null
    then 'https://discord.com/channels/' || publication.discord_guild_id || '/' || publication.discord_channel_id || '/' || publication.discord_message_id
    else null
  end as discord_jump_url,
  entry.created_at as source_created_at,
  entry.updated_at as source_updated_at,
  'PARSED'::text as parser_status,
  publication.status as publication_status,
  publication.posted_by,
  publication.poster_display_name,
  publication.poster_avatar_url,
  publication.posted_at,
  publication.last_synced_by,
  publication.last_synced_at,
  publication.discord_updated_at,
  case
    when publication.discord_message_id is null then false
    when publication.synced_entry_updated_at is null then true
    else entry.updated_at > publication.synced_entry_updated_at
  end as discord_out_of_date,
  (
    entry.created_by = (select auth.uid())
    or private.is_group_admin(entry.group_id)
  ) as can_edit
from public.journal_entries entry
left join public.profiles creator on creator.id = entry.created_by
left join current_viewers viewers on viewers.entry_id = entry.id
left join public.discord_publications publication on publication.journal_entry_id = entry.id

union all

select
  'archive:' || archive.id::text as catalog_id,
  'DISCORD_ARCHIVE'::text as source_type,
  archive.id as record_id,
  null::uuid as journal_entry_id,
  archive.id as archive_entry_id,
  archive.group_id,
  archive.entry_label,
  archive.entry_sort_number,
  archive.title,
  archive.release_year,
  archive.watched_at,
  archive.status,
  archive.comment,
  archive.viewer_names,
  null::uuid as created_by,
  archive.author_display_name,
  volume.id as volume_id,
  volume.display_name as volume_name,
  volume.discord_guild_id,
  volume.discord_channel_id,
  archive.discord_message_id,
  archive.discord_jump_url,
  archive.message_created_at as source_created_at,
  coalesce(archive.message_edited_at, archive.message_created_at) as source_updated_at,
  archive.parser_status,
  null::text as publication_status,
  null::uuid as posted_by,
  null::text as poster_display_name,
  null::text as poster_avatar_url,
  null::timestamptz as posted_at,
  null::uuid as last_synced_by,
  null::timestamptz as last_synced_at,
  null::timestamptz as discord_updated_at,
  false as discord_out_of_date,
  false as can_edit
from public.journal_archive_entries archive
join public.journal_volumes volume on volume.id = archive.volume_id;

revoke all on table public.journal_catalog from public, anon, authenticated;
grant select on table public.journal_catalog to authenticated;

comment on table public.discord_identities is
  'Server-synchronised Discord identity cards sourced from auth.identities. Browser clients cannot write them or read Discord user IDs.';
comment on table public.journal_archive_entries is
  'Immutable-to-members Journal history imported from Discord backup messages. Discord message IDs are the import identity; entry labels are preserved verbatim.';
comment on view public.journal_catalog is
  'Membership-gated read-only union of current Cine-Cord Journal entries and immutable Discord archive entries.';
comment on column public.discord_publications.synced_entry_updated_at is
  'The Journal entry updated_at value represented by the existing Discord message. A newer entry is out of date.';
comment on column public.discord_publications.posted_by is
  'The member who created the Discord message. This remains the original poster when the existing message is edited.';
comment on column public.discord_publications.last_synced_by is
  'The member who most recently created or updated the Discord message through Cine-Cord.';

commit;
