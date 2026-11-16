/**
 * PostgreSQL access (Aiven). Replaces the Supabase client.
 *
 * - Queries are tagged templates: every `${value}` becomes a numbered
 *   parameter; only `ident()`, `setColumns()`, `insertValues()`… add SQL text,
 *   and they only accept plain lowercase identifiers.
 * - `db()` runs as the owner, like Supabase's service role.
 * - `asAnon` / `asUser` run inside a transaction with the role and claims
 *   PostgREST used to set, so RLS policies and auth.uid() apply as before.
 * - Results keep PostgREST's shapes: timestamps as ISO strings, bigint and
 *   numeric as numbers, json/jsonb parsed.
 */
import pg from 'pg';

export type Row = Record<string, unknown>;

/** A piece of SQL with its parameters, ready to be spliced into another. */
export class Fragment {
  constructor(
    readonly strings: readonly string[],
    readonly values: readonly unknown[],
  ) {}
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): Fragment {
  return new Fragment([...strings], values);
}

const text = (value: string) => new Fragment([value], []);

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** `"schema"."table"`; plain lowercase identifiers only. */
export function ident(...names: string[]): Fragment {
  for (const name of names) {
    if (!IDENT.test(name)) throw new Error(`Not a valid identifier: ${JSON.stringify(name)}`);
  }
  return text(names.map((name) => `"${name}"`).join('.'));
}

export function join(fragments: Fragment[], separator = ', '): Fragment {
  const strings: string[] = [''];
  const values: unknown[] = [];
  fragments.forEach((fragment, index) => {
    if (index > 0) strings[strings.length - 1] += separator;
    values.push(fragment);
    strings.push('');
  });
  return new Fragment(strings, values);
}

/** `"a" = $1, "b" = $2` for an UPDATE; undefined keys are left out. */
export function setColumns(patch: Record<string, unknown>): Fragment {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error('nothing to set');
  return join(entries.map(([column, value]) => sql`${ident(column)} = ${value}`));
}

/** `("a", "b") values ($1, $2)[, ($3, $4)…]` for an INSERT. */
export function insertValues(rows: Record<string, unknown> | Record<string, unknown>[]): Fragment {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) throw new Error('nothing to insert');
  const columns = Object.keys(list[0]!);
  const tuples = list.map((row) => sql`(${join(columns.map((column) => sql`${row[column]}`))})`);
  return sql`(${join(columns.map((column) => ident(column)))}) values ${join(tuples)}`;
}

/**
 * `insert into public.<table> … on conflict (…) do update set` only the given
 * columns (PostgREST's upsert, merge-duplicates), or `do nothing`.
 */
export function upsert(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  conflict: string[],
  { ignoreDuplicates = false }: { ignoreDuplicates?: boolean } = {},
): Fragment {
  const first = Array.isArray(rows) ? rows[0] : rows;
  const target = join(conflict.map((column) => ident(column)));
  const updated = Object.keys(first ?? {}).filter((column) => !conflict.includes(column));
  const action =
    ignoreDuplicates || updated.length === 0
      ? text('do nothing')
      : sql`do update set ${join(updated.map((column) => sql`${ident(column)} = excluded.${ident(column)}`))}`;
  return sql`insert into ${ident('public', table)} ${insertValues(rows)} on conflict (${target}) ${action}`;
}

/**
 * `select public.<fn>(p_a => $1, …) as result`, PostgREST's rpc for functions
 * that return one value (scalar or jsonb). Objects and arrays go as jsonb.
 */
export function callFunction(name: string, args: Record<string, unknown> = {}): Fragment {
  const params = Object.entries(args).map(([key, value]) => {
    const isJson = value !== null && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Fragment);
    return sql`${ident(key)} => ${isJson ? json(value) : value}`;
  });
  return sql`select ${ident('public', name)}(${join(params)}) as result`;
}

/** A value sent as jsonb (arrays included, which pg would send as SQL arrays). */
export function json(value: unknown): Fragment {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** `($1, $2…)` for `x in ${inList(ids)}`; an empty list matches nothing. */
export function inList(items: readonly unknown[]): Fragment {
  if (items.length === 0) return text('(select null where false)');
  return sql`(${join(items.map((item) => sql`${item}`))})`;
}

export function compile(query: Fragment): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const walk = (fragment: Fragment): string => {
    let out = fragment.strings[0]!;
    fragment.values.forEach((value, index) => {
      if (value instanceof Fragment) {
        out += walk(value);
      } else {
        values.push(value);
        out += `$${values.length}`;
      }
      out += fragment.strings[index + 1]!;
    });
    return out;
  };
  return { text: walk(query), values };
}

// --- types -------------------------------------------------------------------

/** `2026-11-16 12:05:09.12+00` → `2026-11-16T12:05:09.12+00:00`, as PostgREST sent it. */
export function parseTimestamp(value: string): string {
  return value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
}

const TYPES = {
  TIMESTAMPTZ: 1184,
  TIMESTAMP: 1114,
  DATE: 1082,
  INT8: 20,
  NUMERIC: 1700,
} as const;

const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    switch (oid) {
      case TYPES.TIMESTAMPTZ:
      case TYPES.TIMESTAMP:
        return parseTimestamp;
      case TYPES.DATE:
        return (value: string) => value;
      case TYPES.INT8:
      case TYPES.NUMERIC:
        return (value: string) => Number(value);
      default:
        return pg.types.getTypeParser(oid, format);
    }
  },
} as pg.CustomTypesConfig;

// --- pool --------------------------------------------------------------------

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export type Db = {
  rows<T = Row>(strings: TemplateStringsArray | Fragment, ...values: unknown[]): Promise<T[]>;
  one<T = Row>(strings: TemplateStringsArray | Fragment, ...values: unknown[]): Promise<T | null>;
  run(strings: TemplateStringsArray | Fragment, ...values: unknown[]): Promise<number>;
  /** Runs one query with the vault key set (same role and claims), for functions that seal or read secrets. */
  withVaultKey<T = Row>(query: Fragment): Promise<T[]>;
  /** Calls public.<name>(args) and returns its value (see callFunction). */
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
};

function vaultKey(): string {
  const key = import.meta.env.VAULT_KEY;
  if (!key) throw new Error('VAULT_KEY is not set');
  return key;
}

function toFragment(strings: TemplateStringsArray | Fragment, values: unknown[]): Fragment {
  return strings instanceof Fragment ? strings : new Fragment([...strings], values);
}

function bind(target: Queryable, inTransaction = false): Db {
  const execute = async (strings: TemplateStringsArray | Fragment, values: unknown[]) => {
    const { text: queryText, values: params } = compile(toFragment(strings, values));
    return target.query({ text: queryText, values: params, types });
  };
  return {
    async rows<T>(strings: TemplateStringsArray | Fragment, ...values: unknown[]) {
      return (await execute(strings, values)).rows as T[];
    },
    async one<T>(strings: TemplateStringsArray | Fragment, ...values: unknown[]) {
      return ((await execute(strings, values)).rows[0] as T | undefined) ?? null;
    },
    async run(strings: TemplateStringsArray | Fragment, ...values: unknown[]) {
      return (await execute(strings, values)).rowCount ?? 0;
    },
    async call<T>(name: string, args: Record<string, unknown> = {}) {
      return ((await execute(callFunction(name, args), [])).rows[0] as { result: T } | undefined)?.result as T;
    },
    async withVaultKey<T>(query: Fragment) {
      if (!inTransaction) return withVault((tx) => tx.rows<T>(query));
      await target.query("SELECT set_config('app.vault_key', $1, true)", [vaultKey()]);
      return (await execute(query, [])).rows as T[];
    },
  };
}

export function hasDatabase(): boolean {
  return Boolean(import.meta.env.DATABASE_URL);
}

const globalPool = globalThis as typeof globalThis & { __pintoraPool?: pg.Pool };

/** The shared pool. Small: Aiven's free plan allows 20 connections in all. */
export function pool(): pg.Pool {
  if (globalPool.__pintoraPool) return globalPool.__pintoraPool;
  const connectionString = import.meta.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const ca = import.meta.env.DATABASE_CA_CERT;
  const created = new pg.Pool({
    connectionString,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: Number(import.meta.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    options: '-c TimeZone=UTC -c statement_timeout=15000',
  });
  created.on('error', (err) => console.error('[db] idle client error', err.message));
  globalPool.__pintoraPool = created;
  return created;
}

/** Like Supabase's createServiceClient(): null when no database is configured. */
export function serviceDb(): Db | null {
  return hasDatabase() ? db() : null;
}

/** As the owner (Supabase's service role): no RLS. One query at a time, no transaction. */
export function db(): Db {
  return bind(pool());
}

/**
 * `begin` (plus whatever the context sets) in one round trip, then fn, then
 * commit; rolled back on any error. Settings are transaction-local, so nothing
 * stays on the pooled connection.
 */
async function inTransaction<T>(
  begin: string,
  fn: (tx: Db) => Promise<T>,
  setup?: (client: pg.PoolClient) => Promise<unknown>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query(begin);
    if (setup) await setup(client);
    const result = await fn(bind(client, true));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What PostgREST ran before each request: role and JWT claims, local to the
 * transaction. Only fixed role names and a checked uuid end up in the text.
 */
export function beginAs(role: 'anon' | 'authenticated', userId?: string): string {
  if (userId !== undefined && !UUID.test(userId)) throw new Error('Not a user id');
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  return `BEGIN; SELECT set_config('role', '${role}', true), set_config('request.jwt.claims', '${claims}', true)`;
}

/** Several statements that must all happen or none, as the owner. */
export function transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return inTransaction('BEGIN', fn);
}

/** As a visitor: role anon, so only what RLS lets the public see. */
export function asAnon<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return inTransaction(beginAs('anon'), fn);
}

/** As a signed-in customer: role authenticated and auth.uid() = userId. */
export function asUser<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return inTransaction(beginAs('authenticated', userId), fn);
}

function scoped(run: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>): Db {
  return {
    rows: (strings, ...values) => run((tx) => tx.rows(strings, ...values)),
    one: (strings, ...values) => run((tx) => tx.one(strings, ...values)),
    run: (strings, ...values) => run((tx) => tx.run(strings, ...values)),
    withVaultKey: (query) => run((tx) => tx.withVaultKey(query)),
    call: (name, args) => run((tx) => tx.call(name, args)),
  } as Db;
}

/**
 * The signed-in user's client, as Supabase's was: every query in its own
 * transaction as `authenticated` with auth.uid() = userId (RLS, is_admin()).
 */
export function userDb(userId: string): Db {
  return scoped((fn) => asUser(userId, fn));
}

/** The visitor's client: every query as `anon`. */
export function anonDb(): Db {
  return scoped((fn) => asAnon(fn));
}

/** As the owner, with the vault key set for this transaction only. */
export function withVault<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const key = vaultKey();
  return inTransaction('BEGIN', fn, (client) => client.query("SELECT set_config('app.vault_key', $1, true)", [key]));
}

/** `{ data, error }`, the shape pages were written against with supabase-js. */
export async function settle<T>(query: Promise<T>): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    return { data: await query, error: null };
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}
