create index if not exists journal_entries_created_by_idx on public.journal_entries(created_by);
create index if not exists queue_items_suggested_by_idx on public.queue_items(suggested_by);
