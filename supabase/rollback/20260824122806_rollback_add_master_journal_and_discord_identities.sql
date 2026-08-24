begin;

revoke select on table public.entry_viewers from service_role;

drop view if exists public.journal_catalog;

drop function if exists public.update_journal_entry(uuid, bigint, text, integer, date, text, text, uuid[]);

drop trigger if exists entry_viewers_touch_journal_entry on public.entry_viewers;
drop function if exists private.touch_journal_entry_from_viewer();

drop trigger if exists journal_entries_protect_identity on public.journal_entries;
drop function if exists private.protect_journal_entry_identity();

drop policy if exists entry_viewers_delete_owner_or_admin on public.entry_viewers;
drop policy if exists entry_viewers_insert_owner_or_admin on public.entry_viewers;
drop policy if exists journal_entries_delete_owner_or_admin on public.journal_entries;
drop policy if exists journal_entries_update_owner_or_admin on public.journal_entries;

create policy journal_entries_update_owner_or_admin
on public.journal_entries for update
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_group_admin(group_id)
  or exists (
    select 1
    from public.movie_sessions session
    where session.id = journal_entries.movie_session_id
      and session.group_id = journal_entries.group_id
      and session.host_id = (select auth.uid())
  )
)
with check (
  private.is_group_member(group_id)
  and (
    created_by = (select auth.uid())
    or private.is_group_admin(group_id)
    or exists (
      select 1
      from public.movie_sessions session
      where session.id = journal_entries.movie_session_id
        and session.group_id = journal_entries.group_id
        and session.host_id = (select auth.uid())
    )
  )
);

create policy journal_entries_delete_owner_or_admin
on public.journal_entries for delete
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_group_admin(group_id)
  or exists (
    select 1
    from public.movie_sessions session
    where session.id = journal_entries.movie_session_id
      and session.group_id = journal_entries.group_id
      and session.host_id = (select auth.uid())
  )
);

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
    left join public.movie_sessions session on session.id = entry.movie_session_id
    where entry.id = entry_viewers.entry_id
      and (
        entry.created_by = (select auth.uid())
        or private.is_group_admin(entry.group_id)
        or session.host_id = (select auth.uid())
      )
  )
);

create policy entry_viewers_delete_owner_or_admin
on public.entry_viewers for delete
to authenticated
using (
  exists (
    select 1
    from public.journal_entries entry
    left join public.movie_sessions session on session.id = entry.movie_session_id
    where entry.id = entry_viewers.entry_id
      and (
        entry.created_by = (select auth.uid())
        or private.is_group_admin(entry.group_id)
        or session.host_id = (select auth.uid())
      )
  )
);

drop index if exists public.discord_publications_last_synced_by_idx;

alter table public.discord_publications
  drop constraint if exists discord_publications_status_check,
  drop constraint if exists discord_publications_message_identity_complete,
  drop column if exists discord_updated_at,
  drop column if exists last_synced_at,
  drop column if exists last_synced_by,
  drop column if exists synced_entry_updated_at,
  drop column if exists poster_avatar_url,
  drop column if exists poster_display_name;

alter table public.discord_publications
  add constraint discord_publications_status_check
    check (status in ('POSTING', 'POSTED', 'FAILED', 'UNKNOWN')),
  add constraint discord_publications_message_identity_complete check (
    (
      status = 'POSTED'
      and discord_channel_id is not null
      and discord_message_id is not null
      and posted_at is not null
    )
    or status <> 'POSTED'
  );

drop table if exists public.journal_archive_entries;
drop table if exists public.journal_volumes;

drop function if exists public.sync_my_discord_identity();
drop function if exists private.sync_my_discord_identity();
drop table if exists public.discord_identities;

commit;
