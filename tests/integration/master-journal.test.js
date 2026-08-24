import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  expectRpcError,
  groupId,
  resetWorkspace,
  runSql,
  sqlRow,
} from "./helpers/local-supabase.js";

let group;
let admin;
let creator;
let member;
let outsider;
let entryId;
let volumeId;

test("set up current, archive and Discord identity records", async () => {
  resetWorkspace();
  group = groupId();
  admin = await createIdentity({ name: "Cameron", role: "admin" });
  creator = await createIdentity({ name: "Dean", role: "member" });
  member = await createIdentity({ name: "Adam", role: "member" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  runSql(`
    insert into public.journal_entries (
      group_id, entry_number, title, release_year, watched_at, status, comment, created_by
    ) values (
      '${group}', 1325, 'Alien', 1979, '2026-08-24', 'FINISHED', 'Original comment', '${creator.id}'
    );
  `);
  entryId = sqlRow("select id from public.journal_entries where entry_number = 1325").id;

  runSql(`
    insert into public.entry_viewers (entry_id, profile_id)
    values ('${entryId}', '${creator.id}');
  `);

  const entryTimestamp = sqlRow(`select updated_at from public.journal_entries where id = '${entryId}'`).updated_at;
  runSql(`
    insert into public.discord_publications (
      group_id,
      journal_entry_id,
      status,
      discord_guild_id,
      discord_channel_id,
      discord_message_id,
      posted_by,
      poster_display_name,
      posted_at,
      synced_entry_updated_at,
      last_synced_by,
      last_synced_at
    ) values (
      '${group}',
      '${entryId}',
      'POSTED',
      '272427070779293697',
      '1353823481413763132',
      '999999999999999999',
      '${creator.id}',
      'Dean',
      now(),
      '${entryTimestamp}',
      '${creator.id}',
      now()
    );
  `);

  volumeId = sqlRow(`
    select id
    from public.journal_volumes
    where discord_channel_id = '713935563912118293'
  `).id;

  runSql(`
    insert into public.journal_archive_entries (
      group_id,
      volume_id,
      discord_message_id,
      discord_jump_url,
      entry_label,
      entry_sort_number,
      title,
      release_year,
      watched_at,
      status,
      comment,
      viewer_names,
      author_discord_user_id,
      author_display_name,
      message_created_at,
      raw_content
    ) values (
      '${group}',
      '${volumeId}',
      '888888888888888888',
      'https://discord.com/channels/272427070779293697/713935563912118293/888888888888888888',
      '12.1',
      12.1,
      'The Thing',
      1982,
      '2020-06-01',
      'FINISHED',
      'Archive comment',
      array['Cameron', 'Dean'],
      '777777777777777777',
      'Cameron',
      '2020-06-01T20:00:00Z',
      '- Entry #12.1'
    );
  `);

  runSql(`
    insert into auth.identities (
      provider_id,
      user_id,
      identity_data,
      provider,
      created_at,
      updated_at
    ) values (
      '666666666666666666',
      '${creator.id}',
      '{"full_name":"Dean from Discord","avatar_url":"https://cdn.discordapp.com/avatars/666/avatar.png"}'::jsonb,
      'discord',
      now(),
      now()
    );
  `);
});

test("Discord identity sync trusts auth.identities, not browser input", async () => {
  const { data, error } = await creator.client.rpc("sync_my_discord_identity");
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].display_name, "Dean from Discord");
  assert.equal(data[0].avatar_url, "https://cdn.discordapp.com/avatars/666/avatar.png");

  const { data: visibleCards, error: cardError } = await member.client
    .from("discord_identities")
    .select("profile_id,display_name,avatar_url,synced_at");
  assert.equal(cardError, null);
  assert.equal(visibleCards.length, 1);
  assert.equal(visibleCards[0].profile_id, creator.id);

  const { error: idReadError } = await creator.client
    .from("discord_identities")
    .select("discord_user_id");
  assert.match(idReadError?.message || "", /permission denied/i);

  const { error: forgedWriteError } = await creator.client
    .from("discord_identities")
    .update({ display_name: "Forged" })
    .eq("profile_id", creator.id);
  assert.match(forgedWriteError?.message || "", /permission denied/i);
});

test("the master catalog combines current and archived entries for members only", async () => {
  const { data, error } = await member.client
    .from("journal_catalog")
    .select("source_type,entry_label,title,volume_name,can_edit,discord_out_of_date")
    .order("entry_sort_number", { ascending: true });
  assert.equal(error, null);
  assert.deepEqual(data, [
    {
      source_type: "DISCORD_ARCHIVE",
      entry_label: "12.1",
      title: "The Thing",
      volume_name: "The Journal",
      can_edit: false,
      discord_out_of_date: false,
    },
    {
      source_type: "CINE_CORD",
      entry_label: "1325",
      title: "Alien",
      volume_name: "Cine-Cord",
      can_edit: false,
      discord_out_of_date: false,
    },
  ]);

  const { data: outsiderRows, error: outsiderError } = await outsider.client
    .from("journal_catalog")
    .select("catalog_id");
  assert.equal(outsiderError, null);
  assert.deepEqual(outsiderRows, []);

  const { error: archiveWriteError } = await member.client
    .from("journal_archive_entries")
    .update({ title: "Changed" })
    .eq("id", entryId);
  assert.match(archiveWriteError?.message || "", /permission denied/i);
});

test("only the creator or an admin can edit a current entry", async () => {
  await expectRpcError(
    member.client.rpc("update_journal_entry", {
      p_entry_id: entryId,
      p_entry_number: 1325,
      p_title: "Alien - changed by someone else",
      p_release_year: 1979,
      p_watched_at: "2026-08-24",
      p_status: "FINISHED",
      p_comment: "Nope",
      p_viewer_ids: [member.id],
    }),
    /only the entry creator or a website administrator/i,
  );

  const { data: creatorUpdate, error: creatorError } = await creator.client.rpc("update_journal_entry", {
    p_entry_id: entryId,
    p_entry_number: 1325,
    p_title: "Alien",
    p_release_year: 1979,
    p_watched_at: "2026-08-25",
    p_status: "DNF",
    p_comment: "Creator edit",
    p_viewer_ids: [creator.id, member.id],
  });
  assert.equal(creatorError, null);
  assert.equal(creatorUpdate.status, "DNF");

  const { data: creatorCatalog, error: creatorCatalogError } = await creator.client
    .from("journal_catalog")
    .select("can_edit,viewer_names,discord_out_of_date")
    .eq("journal_entry_id", entryId)
    .single();
  assert.equal(creatorCatalogError, null);
  assert.equal(creatorCatalog.can_edit, true);
  assert.deepEqual(creatorCatalog.viewer_names, ["Adam", "Dean"]);
  assert.equal(creatorCatalog.discord_out_of_date, true);

  const { data: adminUpdate, error: adminError } = await admin.client.rpc("update_journal_entry", {
    p_entry_id: entryId,
    p_entry_number: 1325,
    p_title: "Alien: Director's Cut",
    p_release_year: 1979,
    p_watched_at: "2026-08-25",
    p_status: "FINISHED",
    p_comment: "Admin correction",
    p_viewer_ids: [creator.id, member.id],
  });
  assert.equal(adminError, null);
  assert.equal(adminUpdate.title, "Alien: Director's Cut");
  assert.equal(adminUpdate.created_by, creator.id);

  const { error: ownerChangeError } = await admin.client
    .from("journal_entries")
    .update({ created_by: admin.id })
    .eq("id", entryId);
  assert.match(ownerChangeError?.message || "", /cannot change its group, creator or source session/i);
});

test("service_role can import archive rows but members cannot", () => {
  assert.deepEqual(sqlRow(`
    select
      has_table_privilege('service_role', 'public.journal_archive_entries', 'SELECT') as archive_select,
      has_table_privilege('service_role', 'public.journal_archive_entries', 'INSERT') as archive_insert,
      has_table_privilege('service_role', 'public.journal_archive_entries', 'UPDATE') as archive_update,
      has_table_privilege('service_role', 'public.journal_archive_entries', 'DELETE') as archive_delete,
      has_table_privilege('authenticated', 'public.journal_archive_entries', 'INSERT') as member_insert,
      has_table_privilege('authenticated', 'public.journal_archive_entries', 'UPDATE') as member_update,
      has_table_privilege('authenticated', 'public.journal_archive_entries', 'DELETE') as member_delete
  `), {
    archive_select: true,
    archive_insert: true,
    archive_update: true,
    archive_delete: false,
    member_insert: false,
    member_update: false,
    member_delete: false,
  });
});
