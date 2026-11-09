/**
 * Shared set-up for database tests: a fresh database with the Supabase stub and
 * every migration, plus helpers to act as a given user on one or more
 * connections (for race tests).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

const ROOT = path.resolve(__dirname, '../..');

export type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

let url: URL | null = null;

/** Creates (or re-creates) database `name` with all migrations and returns a superuser connection. */
export async function startDb(name: string): Promise<Client> {
  const out = execFileSync(path.join(ROOT, 'scripts/test-db.sh'), ['start', name], { encoding: 'utf8' });
  url = new URL(out.trim().split('\n').pop()!);
  return connect();
}

/** Another connection to the same database (superuser until a role is set). */
export async function connect(): Promise<Client> {
  if (!url) throw new Error('startDb first');
  const c = new Client({
    host: url.searchParams.get('host') ?? undefined,
    port: Number(url.port),
    user: 'postgres',
    database: url.pathname.slice(1),
  });
  await c.connect();
  return c;
}

/** Starts a transaction on `c` as the given user, anon (null) or the service role. */
export async function begin(c: Client, who: string | null | 'service_role'): Promise<void> {
  await c.query('begin');
  if (who === 'service_role') {
    await c.query('set local role service_role');
  } else if (who) {
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
  } else {
    await c.query('set local role anon');
  }
}

/** Runs `fn` in its own transaction on `c` as `who`; rolls back on error. */
export async function as<T>(c: Client, who: string | null | 'service_role', fn: (q: Q) => Promise<T>): Promise<T> {
  await begin(c, who);
  try {
    const result = await fn((sql, params) => c.query(sql, params as any[]));
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

export async function createUser(c: Client, name: string, phone?: string, email?: string): Promise<string> {
  const { rows } = await c.query(
    `insert into auth.users (phone, email, raw_user_meta_data) values ($1, $2, $3) returning id`,
    [phone ?? null, email ?? null, JSON.stringify({ full_name: name })],
  );
  return rows[0].id;
}

/** Makes a trip organised by `organizer` with the other people as members. */
export async function createTrip(c: Client, organizer: string, members: string[], name = 'Trip'): Promise<string> {
  const trip = await as(c, organizer, (q) =>
    q(`insert into public.trips (name, base_currency) values ($1, 'EUR') returning id, invite_code`, [name]),
  );
  for (const m of members) {
    await as(c, m, (q) => q('select public.join_trip_by_code($1)', [trip.rows[0].invite_code]));
  }
  return trip.rows[0].id;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
