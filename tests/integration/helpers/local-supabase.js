// Integration-test harness for the local Supabase stack.
//
// These tests talk to a real Postgres through PostgREST using real signed-in
// users, so Row Level Security, SECURITY DEFINER boundaries and the session
// RPCs are exercised exactly as the browser exercises them. The design-preview
// used by the Playwright suite bypasses all of that.
//
// Requires `npx supabase start` in this repository first.
//
// Fixture setup and ground-truth reads go through psql as `postgres` rather
// than through a service-role PostgREST client. The Discord publisher migration
// deliberately gives service_role a narrow read/publication-write surface, but
// not the broad fixture privileges required across the whole application schema.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const GROUP_SLUG = "the-discordians";

const repoRoot = new URL("../../../", import.meta.url);

let cachedEnv = null;

export function requireLocalApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid local Supabase API URL: ${value}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error(
      `Refusing to run destructive database tests against non-local Supabase URL: ${url.origin}`,
    );
  }

  return value;
}

// `supabase status` is slow enough to matter per test file, so allow a plain
// environment override and cache the parsed result for the rest of the process.
export function localEnv() {
  if (cachedEnv) return cachedEnv;

  const overrideNames = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const suppliedOverrides = overrideNames.filter((name) => process.env[name]);
  if (suppliedOverrides.length > 0 && suppliedOverrides.length < overrideNames.length) {
    throw new Error(`Set all local Supabase overrides together: ${overrideNames.join(", ")}.`);
  }

  if (suppliedOverrides.length === overrideNames.length) {
    cachedEnv = {
      apiUrl: requireLocalApiUrl(process.env.SUPABASE_URL),
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    return cachedEnv;
  }

  let raw;
  try {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "npx.cmd supabase status -o env"]
      : ["supabase", "status", "-o", "env"];
    raw = execFileSync(command, args, {
      cwd: fileURLToPath(repoRoot),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      "Could not read local Supabase status. Run `npx supabase start` in this repository first.\n" +
      String(error.stderr || error.message),
    );
  }

  const values = Object.fromEntries(
    raw.split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );

  if (!values.API_URL || !values.SERVICE_ROLE_KEY) {
    throw new Error("Local Supabase is not running. Run `npx supabase start` first.");
  }

  cachedEnv = {
    apiUrl: requireLocalApiUrl(values.API_URL),
    anonKey: values.ANON_KEY,
    serviceKey: values.SERVICE_ROLE_KEY,
  };
  return cachedEnv;
}

function dbContainer() {
  const config = readFileSync(new URL("supabase/config.toml", repoRoot), "utf8");
  const projectId = config.match(/^project_id\s*=\s*"(.+)"/m)?.[1];
  if (!projectId) throw new Error("Could not read project_id from supabase/config.toml.");
  return `supabase_db_${projectId}`;
}

function psql(args, input) {
  try {
    return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", ...args], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`psql failed: ${String(error.stderr || error.message)}`);
  }
}

/** Runs statements that PostgREST cannot express (TRUNCATE, sequence resets). */
export function runSql(statements) {
  return psql(["-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], statements);
}

/** Runs a SELECT as `postgres` and returns the rows as plain objects. */
export function sqlRows(query) {
  const output = psql(
    ["-v", "ON_ERROR_STOP=1", "-At", "-f", "-"],
    `select coalesce(json_agg(row_to_json(source)), '[]'::json) from (${query}) as source;`,
  );
  return JSON.parse(output.trim() || "[]");
}

/** Convenience for a query expected to return at most one row. */
export function sqlRow(query) {
  return sqlRows(query)[0] ?? null;
}

function anonClient() {
  const { apiUrl, anonKey } = localEnv();
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The Auth admin API is a separate service from PostgREST and does accept the
// service key, so user creation still goes through the supported path.
function authAdminClient() {
  const { apiUrl, serviceKey } = localEnv();
  return createClient(apiUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Application tables only. public.groups keeps the row the base migration
// seeded, which is the group every test works inside.
export function resetWorkspace() {
  runSql(`
    truncate table
      public.discord_publications,
      public.entry_viewers,
      public.journal_entries,
      public.movie_session_participants,
      public.movie_sessions,
      public.queue_votes,
      public.queue_items,
      public.group_join_requests,
      public.group_memberships
    restart identity cascade;
    delete from auth.users;
    alter sequence public.journal_entries_entry_number_seq restart with 1317;
  `);
}

export function groupId() {
  const row = sqlRow(`select id from public.groups where slug = '${GROUP_SLUG}'`);
  if (!row) throw new Error(`Group ${GROUP_SLUG} is missing. Run \`npx supabase db reset\`.`);
  return row.id;
}

let identityCounter = 0;

/**
 * Creates a confirmed auth user, names their profile, optionally grants group
 * membership, and returns a client authenticated as that person with a real JWT.
 * Pass role: null to get an authenticated user who is NOT an approved member.
 */
export async function createIdentity({ name, role = "member", group = null }) {
  const email = `${name.toLowerCase()}.${process.pid}.${identityCounter += 1}@cine-cord.test`;
  const password = "integration-test-password";

  const { data: created, error: createError } = await authAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (createError) throw createError;
  const id = created.user.id;

  // private.handle_new_user() already inserted the profile from the metadata;
  // this keeps the name exact regardless of that trigger's fallbacks.
  runSql(`update public.profiles set display_name = '${name}' where id = '${id}';`);

  if (role) {
    const targetGroup = group || groupId();
    runSql(`
      insert into public.group_memberships (group_id, user_id, role)
      values ('${targetGroup}', '${id}', '${role}');
    `);
  }

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id, name, email, client };
}

/** Adds a film to the shared list as the given identity, honouring RLS. */
export async function addFilm(identity, group, { title, year = 2000, runtime = 100 }) {
  const { data, error } = await identity.client
    .from("queue_items")
    .insert({ group_id: group, suggested_by: identity.id, title, release_year: year, runtime_minutes: runtime })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Mirrors app.js confirmMovieSession(): a client-composed snapshot update. */
export async function confirmSession(identity, sessionId, group, film) {
  const { data, error } = await identity.client
    .from("movie_sessions")
    .update({
      status: "CONFIRMED",
      watch_date: "2026-08-24",
      selected_queue_item_id: film.id,
      selected_title: film.title,
      selected_release_year: film.year ?? 2000,
      selected_genres: [],
    })
    .eq("id", sessionId)
    .eq("group_id", group)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Confirm affected no rows.");
  return data;
}

/** Node's assert.rejects is awkward for PostgREST's {data,error} shape. */
export async function expectRpcError(promise, matcher) {
  const { error } = await promise;
  if (!error) throw new Error(`Expected an error matching ${matcher}, but the call succeeded.`);
  if (!matcher.test(error.message)) {
    throw new Error(`Expected an error matching ${matcher}, got: ${error.message}`);
  }
  return error;
}
