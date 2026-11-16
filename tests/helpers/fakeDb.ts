import { vi } from 'vitest';
import { compile, Fragment, type Db } from '../../src/lib/server/db';

export type CallAnswer = { data?: unknown; error?: { message: string } | null };
export type Query = { text: string; values: unknown[] };

/**
 * A Db for unit tests. `call(name, args)` answers from `answer` (an error
 * answer throws, as PostgreSQL would); rows/one/run compile the SQL, record it
 * and answer from `query`. Nothing touches a database.
 */
export function fakeDb({
  answer = () => ({}),
  query = () => undefined,
}: {
  answer?: (name: string, args: Record<string, unknown>) => CallAnswer;
  query?: (q: Query) => unknown;
} = {}) {
  const queries: Query[] = [];
  const execute = async (strings: TemplateStringsArray | Fragment, values: unknown[]) => {
    const compiled = compile(strings instanceof Fragment ? strings : new Fragment([...strings], values));
    queries.push(compiled);
    return query(compiled);
  };
  const call = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = answer(name, args);
    if (error) throw Object.assign(new Error(error.message), error);
    return data;
  });
  const db = {
    rows: async (strings: TemplateStringsArray | Fragment, ...values: unknown[]) => ((await execute(strings, values)) as unknown[]) ?? [],
    one: async (strings: TemplateStringsArray | Fragment, ...values: unknown[]) => (await execute(strings, values)) ?? null,
    run: async (strings: TemplateStringsArray | Fragment, ...values: unknown[]) => ((await execute(strings, values)) as number) ?? 1,
    withVaultKey: async (fragment: Fragment) => ((await execute(fragment, [])) as unknown[]) ?? [],
    call,
  } as unknown as Db;
  return { db, call, queries };
}
