/**
 * In-process PostgreSQL (PGlite) loaded with the real project schema.
 *
 * The declarative Atomic CRM schema (supabase/schemas) and every DDC migration
 * are applied unmodified, on top of a minimal stand-in for the objects Supabase
 * provides at runtime (auth.users, auth.uid(), storage.objects, API roles).
 * This verifies the SQL, constraints, triggers, workflow functions and RLS
 * policies without Docker. It does not replace a run on a real Supabase stack.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

// Resolved from the repository root (vitest and the export script both run there)
const SUPABASE_DIR = path.resolve(process.cwd(), "supabase");
const DDC_MIGRATION_PATTERN = /^\d+_ddc_.*\.sql$/;

const SUPABASE_RUNTIME_STUB = `
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists net;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema extensions, auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_sso_user boolean not null default false
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
`;

// Statements that need a network capable extension, which PGlite does not ship.
// They are only referenced inside function bodies that these tests never reach.
const stripUnsupported = (sql: string) =>
  sql.replace(/^create extension if not exists "http".*$/gim, "");

const readSqlFiles = (dir: string, filter: (name: string) => boolean) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && filter(name))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(dir, name), "utf8"),
    }));

export const ddcMigrationFiles = () =>
  readSqlFiles(path.join(SUPABASE_DIR, "migrations"), (name) =>
    DDC_MIGRATION_PATTERN.test(name),
  );

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export const createTestDb = async () => {
  const db = new PGlite({ extensions: { citext, unaccent } });
  await db.exec(SUPABASE_RUNTIME_STUB);

  const run = async (name: string, sql: string) => {
    try {
      await db.exec(stripUnsupported(sql));
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`, { cause: error });
    }
  };

  for (const file of readSqlFiles(
    path.join(SUPABASE_DIR, "schemas"),
    () => true,
  )) {
    await run(`schemas/${file.name}`, file.sql);
  }
  for (const file of ddcMigrationFiles()) {
    await run(`migrations/${file.name}`, file.sql);
  }

  let userCounter = 0;

  /** Creates an auth user the way the users edge function does, then sets its DDC role. */
  const createUser = async (roleKey: string | null, name = "User") => {
    userCounter += 1;
    const id = `00000000-0000-4000-8000-${String(userCounter).padStart(12, "0")}`;
    await db.query(
      "insert into public.user_invitations (user_id) values ($1)",
      [id],
    );
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
      [
        id,
        `user${userCounter}@example.test`,
        { first_name: name, last_name: `Test${userCounter}` },
      ],
    );
    await db.query("update public.sales set role_key = $1 where user_id = $2", [
      roleKey,
      id,
    ]);
    const { rows } = await db.query<{ id: number; administrator: boolean }>(
      "select id, administrator from public.sales where user_id = $1",
      [id],
    );
    return {
      userId: id,
      salesId: Number(rows[0].id),
      administrator: rows[0].administrator,
    };
  };

  /** Runs statements as a signed-in API user: role authenticated + JWT subject, like PostgREST. */
  const asUser = async <T>(
    userId: string | null,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
        userId ?? "",
      ]);
      return fn(tx);
    });

  const optionId = async (category: string, code: string) => {
    const { rows } = await db.query<{ id: number }>(
      "select id from public.master_options where category = $1 and code = $2",
      [category, code],
    );
    return Number(rows[0].id);
  };

  return { db, createUser, asUser, optionId };
};

/** Asserts that a statement is rejected by PostgreSQL and returns the error message. */
export const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
};
