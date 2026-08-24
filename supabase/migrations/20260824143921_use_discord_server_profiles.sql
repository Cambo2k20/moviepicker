begin;

-- Discord Auth's identity metadata contains the account-wide profile. Cine-Cord
-- belongs to one Discord server, so discard that cache and accept only profiles
-- fetched from The Discordians guild-member endpoint by the authenticated Edge
-- Function; every approved member will reauthorise once to repopulate this table.
alter table public.discord_identities
  add column discord_guild_id text;

delete from public.discord_identities;

alter table public.discord_identities
  alter column discord_guild_id set not null;

alter table public.discord_identities
  rename column provider_updated_at to server_profile_updated_at;

alter table public.discord_identities
  add constraint discord_identities_discordians_guild_check
  check (discord_guild_id = '272427070779293697');

comment on table public.discord_identities is
  'Server-only Discord member profiles fetched for The Discordians; account-wide Discord profile fields are not stored.';
comment on column public.discord_identities.display_name is
  'Effective display name shown for this member inside The Discordians server.';
comment on column public.discord_identities.avatar_url is
  'Effective avatar shown for this member inside The Discordians server.';
comment on column public.discord_identities.server_profile_updated_at is
  'Time the server-member profile was successfully returned by Discord.';

-- The old RPC derived account-wide names and avatars from auth.identities. It
-- must not remain callable because a page load could overwrite the server cache.
drop function if exists public.sync_my_discord_identity();
drop function if exists private.sync_my_discord_identity();

-- Browser roles keep read-only access to safe card fields and still cannot read
-- the numeric Discord account ID or forge an identity. The Edge Function's
-- secret-backed service role receives only the columns needed for this cache.
grant select (profile_id, display_name, avatar_url, synced_at)
  on table public.discord_identities to authenticated;
revoke insert, update, delete on table public.discord_identities from service_role;
grant insert (
  profile_id,
  discord_user_id,
  discord_guild_id,
  display_name,
  avatar_url,
  server_profile_updated_at,
  synced_at
) on table public.discord_identities to service_role;
grant update (
  discord_user_id,
  discord_guild_id,
  display_name,
  avatar_url,
  server_profile_updated_at,
  synced_at
) on table public.discord_identities to service_role;

create or replace function public.upsert_discord_server_identity(
  p_profile_id uuid,
  p_discord_user_id text,
  p_display_name text,
  p_avatar_url text
)
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
  insert into public.discord_identities as identity (
    profile_id,
    discord_user_id,
    discord_guild_id,
    display_name,
    avatar_url,
    server_profile_updated_at,
    synced_at
  ) values (
    p_profile_id,
    p_discord_user_id,
    '272427070779293697',
    p_display_name,
    p_avatar_url,
    now(),
    now()
  )
  on conflict on constraint discord_identities_pkey do update
  set discord_user_id = excluded.discord_user_id,
      discord_guild_id = excluded.discord_guild_id,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      server_profile_updated_at = excluded.server_profile_updated_at,
      synced_at = excluded.synced_at
  returning identity.profile_id, identity.display_name, identity.avatar_url, identity.synced_at;
$$;

revoke all on function public.upsert_discord_server_identity(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_discord_server_identity(uuid, text, text, text)
  to service_role;

commit;
