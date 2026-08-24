begin;

create index discord_publications_posted_by_idx
  on public.discord_publications (posted_by);

commit;
