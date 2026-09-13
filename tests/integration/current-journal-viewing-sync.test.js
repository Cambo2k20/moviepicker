// Phase 2B.1 current-Journal synchronisation against local Supabase. Imported
// Discord archive rows are fixtures only: the synchroniser must never touch them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  groupId,
  resetWorkspace,
  runSql,
  serviceDataClient,
  sqlRow,
  sqlRows,
} from "./helpers/local-supabase.js";

let group;
let owner;
let otherMember;
let outsider;
let alien;
let matrix;
let sourceEntryId;
let sourceEventId;
let archiveEntryId;
let archiveSnapshot;

test("set up current Journal and immutable archive fixtures", async () => {
  resetWorkspace();
  group = groupId();
  owner = await createIdentity({ name: "Cameron", role: "member" });
  otherMember = await createIdentity({ name: "Dean", role: "admin" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  const { data: movies, error } = await serviceDataClient()
    .from("movies")
    .insert([
      { tmdb_id: 348, title: "Alien", release_year: 1979 },
      { tmdb_id: 603, title: "The Matrix", release_year: 1999 },
    ])
    .select("id,tmdb_id");
  assert.equal(error, null);
  alien = movies.find((movie) => Number(movie.tmdb_id) === 348);
  matrix = movies.find((movie) => Number(movie.tmdb_id) === 603);
  assert.ok(alien?.id && matrix?.id);

  const volumeId = sqlRow(`
    select id
    from public.journal_volumes
    where discord_channel_id = '713935563912118293'
  `).id;

  runSql(`
    insert into public.journal_archive_entries (
      group_id, volume_id, discord_message_id, discord_jump_url,
      entry_label, entry_sort_number, title, release_year, watched_at,
      status, comment, viewer_names, author_discord_user_id,
      author_display_name, message_created_at, raw_content
    ) values (
      '${group}', '${volumeId}', '888888888888888888',
      'https://discord.com/channels/272427070779293697/713935563912118293/888888888888888888',
      '12.1', 12.1, 'The Thing', 1982, '2020-06-01', 'FINISHED',
      'Historic archive comment', array['Cameron', 'Dean'],
      '777777777777777777', 'Cameron', '2020-06-01T20:00:00Z',
      '- Entry #12.1'
    );
  `);
  archiveEntryId = sqlRow("select id from public.journal_archive_entries where discord_message_id = '888888888888888888'").id;
  archiveSnapshot = sqlRow(`
    select row_to_json(archive)::jsonb as value
    from public.journal_archive_entries archive
    where id = '${archiveEntryId}'
  `).value;
});

test("a verified current viewer and canonical movie create one private source event", () => {
  runSql(`
    insert into public.journal_entries (
      group_id, title, release_year, watched_at, status, created_by, movie_id
    ) values (
      '${group}', 'Alien', 1979, '2026-09-05', 'FINISHED', '${owner.id}', '${alien.id}'
    );
  `);
  sourceEntryId = sqlRow("select id from public.journal_entries where title = 'Alien'").id;

  runSql(`
    insert into public.entry_viewers (entry_id, profile_id)
    values ('${sourceEntryId}', '${owner.id}');
  `);

  const event = sqlRow(`
    select id, owner_id, movie_id, outcome, watched_on, source_journal_entry_id, is_hidden
    from public.personal_viewing_events
    where source_journal_entry_id = '${sourceEntryId}'
  `);
  sourceEventId = event.id;
  assert.deepEqual(event, {
    id: sourceEventId,
    owner_id: owner.id,
    movie_id: alien.id,
    outcome: "FINISHED",
    watched_on: "2026-09-05",
    source_journal_entry_id: sourceEntryId,
    is_hidden: false,
  });
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_films").count, 0);
});

test("Journal edits update source facts after viewer replacement without losing a private hidden choice", async () => {
  const { data: hidden, error: hideError } = await owner.client
    .from("personal_viewing_events")
    .update({ is_hidden: true })
    .eq("id", sourceEventId)
    .select("id,is_hidden")
    .single();
  assert.equal(hideError, null);
  assert.deepEqual(hidden, { id: sourceEventId, is_hidden: true });

  const { error: updateError } = await owner.client.rpc("update_journal_entry", {
    p_entry_id: sourceEntryId,
    p_entry_number: null,
    p_title: "Alien",
    p_release_year: 1979,
    p_watched_at: "2026-09-06",
    p_status: "DNF",
    p_comment: "Updated through the current Journal",
    p_viewer_ids: [owner.id, otherMember.id],
  });
  assert.equal(updateError, null);

  assert.deepEqual(sqlRows(`
    select id, owner_id, movie_id, outcome, watched_on, source_journal_entry_id, is_hidden
    from public.personal_viewing_events
    where source_journal_entry_id = '${sourceEntryId}'
    order by owner_id
  `), [
    {
      id: sourceEventId,
      owner_id: owner.id,
      movie_id: alien.id,
      outcome: "DID_NOT_FINISH",
      watched_on: "2026-09-06",
      source_journal_entry_id: sourceEntryId,
      is_hidden: true,
    },
    {
      id: sqlRow(`
        select id from public.personal_viewing_events
        where source_journal_entry_id = '${sourceEntryId}' and owner_id = '${otherMember.id}'
      `).id,
      owner_id: otherMember.id,
      movie_id: alien.id,
      outcome: "DID_NOT_FINISH",
      watched_on: "2026-09-06",
      source_journal_entry_id: sourceEntryId,
      is_hidden: false,
    },
  ].sort((left, right) => left.owner_id.localeCompare(right.owner_id)));

  const { error: factRewriteError } = await owner.client
    .from("personal_viewing_events")
    .update({ outcome: "FINISHED" })
    .eq("id", sourceEventId);
  assert.match(factRewriteError?.message || "", /through the Journal/i);
});

test("only the owner can see a derived event", async () => {
  const { data: ownerRows, error: ownerError } = await owner.client
    .from("personal_viewing_events")
    .select("id")
    .eq("id", sourceEventId);
  assert.equal(ownerError, null);
  assert.deepEqual(ownerRows, [{ id: sourceEventId }]);

  for (const identity of [otherMember, outsider]) {
    const { data, error } = await identity.client
      .from("personal_viewing_events")
      .select("id")
      .eq("id", sourceEventId);
    assert.equal(error, null);
    assert.deepEqual(data, []);
  }
});

test("missing viewer or canonical movie identity never creates a source event", () => {
  runSql(`
    insert into public.journal_entries (
      group_id, title, release_year, watched_at, status, created_by
    ) values (
      '${group}', 'Unverified title', 2001, '2026-09-07', 'FINISHED', '${owner.id}'
    );
  `);
  const unverifiedEntryId = sqlRow("select id from public.journal_entries where title = 'Unverified title'").id;
  runSql(`
    insert into public.entry_viewers (entry_id, profile_id)
    values ('${unverifiedEntryId}', '${owner.id}');
  `);
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${unverifiedEntryId}'
  `).count, 0);

  runSql(`update public.journal_entries set movie_id = '${matrix.id}' where id = '${unverifiedEntryId}';`);
  assert.deepEqual(sqlRow(`
    select owner_id, movie_id, outcome, watched_on
    from public.personal_viewing_events
    where source_journal_entry_id = '${unverifiedEntryId}'
  `), {
    owner_id: owner.id,
    movie_id: matrix.id,
    outcome: "FINISHED",
    watched_on: "2026-09-07",
  });

  runSql(`update public.journal_entries set movie_id = null where id = '${unverifiedEntryId}';`);
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${unverifiedEntryId}'
  `).count, 0);

  runSql(`
    insert into public.journal_entries (
      group_id, title, release_year, watched_at, status, created_by, movie_id
    ) values (
      '${group}', 'The Matrix', 1999, '2026-09-08', 'FINISHED', '${owner.id}', '${matrix.id}'
    );
  `);
  const noViewerEntryId = sqlRow("select id from public.journal_entries where title = 'The Matrix'").id;
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${noViewerEntryId}'
  `).count, 0);
});

test("viewer removal deletes only that viewer's derived event", async () => {
  const { error } = await owner.client.rpc("update_journal_entry", {
    p_entry_id: sourceEntryId,
    p_entry_number: null,
    p_title: "Alien",
    p_release_year: 1979,
    p_watched_at: "2026-09-06",
    p_status: "DNF",
    p_comment: "Updated through the current Journal",
    p_viewer_ids: [otherMember.id],
  });
  assert.equal(error, null);

  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where id = '${sourceEventId}'
  `).count, 0);
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${sourceEntryId}' and owner_id = '${otherMember.id}'
  `).count, 1);
  assert.equal(sqlRow(`select count(*)::integer as count from public.journal_entries where id = '${sourceEntryId}'`).count, 1);
});

test("explicit backfill uses current tables only and leaves every imported Discord column unchanged", () => {
  runSql(`
    alter table public.journal_entries disable trigger journal_entries_sync_personal_viewing_events;
    insert into public.journal_entries (
      group_id, title, release_year, watched_at, status, created_by, movie_id
    ) values (
      '${group}', 'Backfill candidate', 1979, '2026-09-09', 'FINISHED', '${owner.id}', '${alien.id}'
    );
    insert into public.entry_viewers (entry_id, profile_id)
    select id, '${owner.id}'
    from public.journal_entries
    where title = 'Backfill candidate';
    alter table public.journal_entries enable trigger journal_entries_sync_personal_viewing_events;
  `);
  const backfillEntryId = sqlRow("select id from public.journal_entries where title = 'Backfill candidate'").id;
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${backfillEntryId}'
  `).count, 0);

  runSql(`select private.sync_current_journal_viewing_events('${backfillEntryId}');`);
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${backfillEntryId}' and owner_id = '${owner.id}'
  `).count, 1);

  assert.deepEqual(sqlRow(`
    select row_to_json(archive)::jsonb as value
    from public.journal_archive_entries archive
    where id = '${archiveEntryId}'
  `).value, archiveSnapshot);
  assert.equal(sqlRow("select count(*)::integer as count from public.journal_archive_entries").count, 1);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_films").count, 0);
});

test("the deferred trigger and private synchronisers are not browser-callable", () => {
  assert.deepEqual(sqlRow(`
    select
      journal_trigger.tgdeferrable as trigger_deferrable,
      journal_trigger.tginitdeferred as trigger_initially_deferred,
      has_function_privilege('anon', 'private.sync_current_journal_viewing_events(uuid)', 'EXECUTE') as anon_sync,
      has_function_privilege('authenticated', 'private.sync_current_journal_viewing_events(uuid)', 'EXECUTE') as member_sync,
      has_function_privilege('service_role', 'private.sync_current_journal_viewing_events(uuid)', 'EXECUTE') as service_sync,
      has_function_privilege('authenticated', 'private.sync_current_journal_viewing_events_trigger()', 'EXECUTE') as member_trigger
    from pg_trigger journal_trigger
    where journal_trigger.tgrelid = 'public.journal_entries'::regclass
      and journal_trigger.tgname = 'journal_entries_sync_personal_viewing_events'
  `), {
    trigger_deferrable: true,
    trigger_initially_deferred: true,
    anon_sync: false,
    member_sync: false,
    service_sync: false,
    member_trigger: false,
  });
});

test("deleting a current Journal source cascades its event but leaves imported history untouched", () => {
  runSql(`delete from public.journal_entries where id = '${sourceEntryId}';`);
  assert.equal(sqlRow(`
    select count(*)::integer as count
    from public.personal_viewing_events
    where source_journal_entry_id = '${sourceEntryId}'
  `).count, 0);
  assert.deepEqual(sqlRow(`
    select row_to_json(archive)::jsonb as value
    from public.journal_archive_entries archive
    where id = '${archiveEntryId}'
  `).value, archiveSnapshot);
});
