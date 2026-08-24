begin;

drop function if exists public.upsert_discord_server_identity(uuid, text, text, text);

revoke insert (
  profile_id,
  discord_user_id,
  discord_guild_id,
  display_name,
  avatar_url,
  server_profile_updated_at,
  synced_at
) on table public.discord_identities from service_role;
revoke update (
  discord_user_id,
  discord_guild_id,
  display_name,
  avatar_url,
  server_profile_updated_at,
  synced_at
) on table public.discord_identities from service_role;

alter table public.discord_identities
  drop constraint discord_identities_discordians_guild_check;
alter table public.discord_identities
  drop column discord_guild_id;
alter table public.discord_identities
  rename column server_profile_updated_at to provider_updated_at;

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

commit;
