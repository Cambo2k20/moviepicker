create index movie_sessions_selected_queue_item_idx on public.movie_sessions (selected_queue_item_id) where selected_queue_item_id is not null;
