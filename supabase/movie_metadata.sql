alter table public.queue_items
  add column if not exists tmdb_id bigint,
  add column if not exists poster_path text,
  add column if not exists runtime_minutes integer,
  add column if not exists genres text[] not null default '{}'::text[],
  add column if not exists overview text,
  add column if not exists metadata_updated_at timestamp with time zone;

do $$
begin
  alter table public.queue_items
    add constraint queue_items_tmdb_id_positive
    check (tmdb_id is null or tmdb_id > 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.queue_items
    add constraint queue_items_runtime_minutes_valid
    check (runtime_minutes is null or runtime_minutes between 1 and 1440);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.queue_items
    add constraint queue_items_poster_path_length
    check (poster_path is null or char_length(poster_path) <= 300);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.queue_items
    add constraint queue_items_overview_length
    check (overview is null or char_length(overview) <= 4000);
exception when duplicate_object then null;
end $$;

create index if not exists queue_items_tmdb_id_idx
  on public.queue_items (tmdb_id)
  where tmdb_id is not null;

comment on column public.queue_items.tmdb_id is 'TMDB movie identifier selected by a website member.';
comment on column public.queue_items.poster_path is 'Relative TMDB poster path. The public TMDB image base URL is added by the client.';
comment on column public.queue_items.metadata_updated_at is 'When the stored TMDB metadata was last refreshed.';

