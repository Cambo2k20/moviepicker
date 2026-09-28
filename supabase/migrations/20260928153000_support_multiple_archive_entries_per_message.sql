-- A Discord message can contain more than one Journal entry. Keep the
-- original message identity and add a stable per-message entry ordinal.
begin;

alter table public.journal_archive_entries
  add column entry_index integer not null default 1;

alter table public.journal_archive_entries
  add constraint journal_archive_entries_entry_index_check
  check (entry_index > 0);

alter table public.journal_archive_entries
  drop constraint if exists journal_archive_entries_discord_message_id_key;

alter table public.journal_archive_entries
  add constraint journal_archive_entries_message_entry_unique
  unique (discord_message_id, entry_index);

create index journal_archive_entries_message_idx
  on public.journal_archive_entries (discord_message_id, entry_index);

commit;
