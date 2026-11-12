#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to the database in DATABASE_URL, once each.
 *
 * Used as the Railway pre-deploy command of the web service, so schema changes
 * go out before the new web app does. History is kept in
 * supabase_migrations.schema_migrations, the same table the Supabase CLI uses.
 *
 *   DATABASE_URL=postgresql://postgres:...@host:5432/postgres node scripts/migrate.cjs
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');
const WAIT_SECONDS = Number(process.env.MIGRATE_WAIT_SECONDS || 120);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSupabaseSchemas(client) {
  // auth.users and storage.* are created by the Auth and Storage services on boot.
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  for (;;) {
    const { rows } = await client.query(
      `select to_regclass('auth.users') is not null as auth,
              to_regclass('storage.objects') is not null as objects,
              to_regclass('storage.buckets') is not null as buckets`,
    );
    const r = rows[0];
    if (r.auth && r.objects && r.buckets) return;
    if (Date.now() > deadline) {
      throw new Error(`Supabase schemas not ready after ${WAIT_SECONDS}s: ${JSON.stringify(r)}`);
    }
    console.log('Waiting for the Auth and Storage services to create their tables…');
    await sleep(5000);
  }
}

async function report(client) {
  const one = async (sql) => {
    try {
      return (await client.query(sql)).rows[0].v;
    } catch (e) {
      return `n/a (${e.message})`;
    }
  };
  console.log('Database check:');
  console.log('  public tables  :', await one(`select count(*)::int as v from information_schema.tables where table_schema = 'public'`));
  console.log('  cron jobs      :', await one(`select coalesce(string_agg(jobname, ', ' order by jobname), 'none') as v from cron.job`));
  console.log('  storage buckets:', await one(`select coalesce(string_agg(id, ', ' order by id), 'none') as v from storage.buckets`));
  console.log(
    '  realtime tables:',
    await one(
      `select coalesce(string_agg(tablename, ', ' order by tablename), 'none') as v from pg_publication_tables where pubname = 'supabase_realtime'`,
    ),
  );
}

/**
 * After migrating: who may call which functions, and that private photo
 * buckets are still private. Compared with supabase/expected-privileges.json
 * (the same list the database tests check). Signed-out access or a private
 * bucket made public stops the deploy; other differences are reported.
 */
async function checkAccess(client) {
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'expected-privileges.json'), 'utf8'));
  // Functions our migrations created in public; extension functions aren't ours to judge.
  const callable = async (role) =>
    (
      await client.query(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute')
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         order by 1`,
        [role],
      )
    ).rows.map((r) => r.name);
  const problems = [];
  const anon = await callable('anon');
  const anonExtra = anon.filter((f) => !expected.anon.includes(f));
  if (anonExtra.length) problems.push(`signed-out visitors can call: ${anonExtra.join(', ')}`);
  const auth = await callable('authenticated');
  const authExtra = auth.filter((f) => !expected.authenticated.includes(f));
  const authMissing = expected.authenticated.filter((f) => !auth.includes(f));
  const buckets = (await client.query(`select id, public from storage.buckets where id in ('receipts', 'trip-photos')`)).rows;
  for (const b of buckets) if (b.public) problems.push(`bucket ${b.id} is public`);

  console.log('Access check:');
  console.log('  signed out can call  :', anon.join(', ') || 'nothing');
  console.log('  signed in can call   :', `${auth.length} functions`);
  if (authExtra.length) console.log('  WARNING not expected :', authExtra.join(', '));
  if (authMissing.length) console.log('  WARNING missing      :', authMissing.join(', '));
  console.log('  private buckets      :', buckets.map((b) => `${b.id} ${b.public ? 'PUBLIC' : 'private'}`).join(', ') || 'none found');
  if (problems.length) throw new Error(`Access check failed: ${problems.join('; ')}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');

  const files = fs
    .readdirSync(DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  // A pg Client can't be reused after a failed connect, so make a new one per attempt.
  let client;
  for (let attempt = 1; ; attempt++) {
    client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      break;
    } catch (e) {
      await client.end().catch(() => undefined);
      if (attempt >= 12) throw e;
      console.log(`Database not reachable yet (${e.message}); retrying…`);
      await sleep(5000);
    }
  }

  try {
    await waitForSupabaseSchemas(client);
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
    `);
    const applied = new Set(
      (await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version),
    );

    let count = 0;
    for (const file of files) {
      const [, version, name] = /^(\d+)_(.+)\.sql$/.exec(file);
      if (applied.has(version)) {
        console.log(`✓ ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
          [version, name, [sql]],
        );
        await client.query('commit');
        count++;
        console.log(`✓ ${file} (applied)`);
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        const where = e.position ? ` at character ${e.position}` : '';
        throw new Error(`${file} failed${where}: ${e.message}`);
      }
    }
    console.log(count ? `Applied ${count} migration(s).` : 'Database is up to date.');
    await report(client);
    await checkAccess(client);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
