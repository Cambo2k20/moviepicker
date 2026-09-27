begin;

create table public.discord_hub_publications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  status text not null default 'POSTING'
    check (status in ('POSTING', 'POSTED', 'FAILED', 'UNKNOWN')),
  discord_guild_id text,
  discord_channel_id text,
  discord_message_id text,
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz,
  attempt_started_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_hub_publications_one_per_group unique (group_id),
  constraint discord_hub_publications_message_identity_complete check (
    (status = 'POSTED'
      and discord_channel_id is not null
      and discord_message_id is not null
      and posted_at is not null)
    or status <> 'POSTED'
  )
);

create trigger discord_hub_publications_set_updated_at
before update on public.discord_hub_publications
for each row execute function private.set_updated_at();

alter table public.discord_hub_publications enable row level security;

create policy discord_hub_publications_select_admin
on public.discord_hub_publications
for select
to authenticated
using (private.is_group_admin(group_id));

revoke all on table public.discord_hub_publications from public, anon, authenticated;
grant select on table public.discord_hub_publications to authenticated;
grant select, insert, update on table public.discord_hub_publications to service_role;

comment on table public.discord_hub_publications is
  'Delivery record for the single administrator-managed Cine-Cord Discord hub message.';
comment on column public.discord_hub_publications.last_error is
  'Short user-safe failure summary only. Discord response bodies and webhook URLs must never be stored.';

commit;
