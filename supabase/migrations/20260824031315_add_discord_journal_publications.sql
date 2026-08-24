begin;

-- A Journal entry may be published to Discord once. The webhook itself lives
-- only in the Edge Function environment; this table records the result without
-- exposing that credential to PostgREST or the browser.
create table public.discord_publications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  status text not null default 'POSTING'
    check (status in ('POSTING', 'POSTED', 'FAILED', 'UNKNOWN')),
  discord_guild_id text,
  discord_channel_id text,
  discord_message_id text,
  content_hash text,
  posted_by uuid not null references public.profiles(id) on delete restrict,
  posted_at timestamptz,
  attempt_started_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_publications_one_per_journal unique (journal_entry_id),
  constraint discord_publications_message_identity_complete check (
    (status = 'POSTED'
      and discord_channel_id is not null
      and discord_message_id is not null
      and posted_at is not null)
    or status <> 'POSTED'
  )
);

create unique index discord_publications_discord_message_unique
  on public.discord_publications (discord_channel_id, discord_message_id)
  where discord_message_id is not null;

create index discord_publications_group_created_idx
  on public.discord_publications (group_id, created_at desc);

create trigger discord_publications_set_updated_at
before update on public.discord_publications
for each row execute function private.set_updated_at();

alter table public.discord_publications enable row level security;

create policy discord_publications_select_group
on public.discord_publications
for select
to authenticated
using (private.is_group_member(group_id));

-- The Edge Function writes with the service role after it has independently
-- authenticated the caller and checked session ownership. Browser clients get
-- read access only, so they cannot forge a successful publication record.
revoke all on table public.discord_publications from public, anon, authenticated;
grant select on table public.discord_publications to authenticated;

comment on table public.discord_publications is
  'Delivery record for explicit server-side Discord Journal publications. Webhook credentials are never stored here.';
comment on column public.discord_publications.status is
  'POSTING while the Edge Function owns the attempt, POSTED after Discord returns a message, FAILED when a safe retry is allowed, or UNKNOWN when delivery may have happened and retrying could duplicate it.';
comment on column public.discord_publications.last_error is
  'Short user-safe failure summary only. Discord response bodies and webhook URLs must never be stored.';

commit;
