import { describe, expect, it } from 'vitest';
import { compile, ident, inList, insertValues, join, json, parseTimestamp, setColumns, sql, upsert, callFunction, beginAs } from '../src/lib/server/db';

describe('sql', () => {
  it('turns every interpolation into a numbered parameter', () => {
    const id = "x'; drop table orders; --";
    expect(compile(sql`select * from orders where id = ${id} and total_cents > ${100}`)).toEqual({
      text: 'select * from orders where id = $1 and total_cents > $2',
      values: [id, 100],
    });
  });

  it('splices nested fragments and renumbers their parameters', () => {
    const filter = sql`status = ${'paid'}`;
    expect(compile(sql`select 1 where a = ${1} and ${filter} and b = ${2}`)).toEqual({
      text: 'select 1 where a = $1 and status = $2 and b = $3',
      values: [1, 'paid', 2],
    });
  });

  it('joins fragments', () => {
    const where = join([sql`a = ${1}`, sql`b = ${2}`], ' and ');
    expect(compile(sql`select 1 where ${where}`)).toEqual({ text: 'select 1 where a = $1 and b = $2', values: [1, 2] });
  });
});

describe('ident', () => {
  it('quotes valid identifiers, schema-qualified too', () => {
    expect(compile(sql`select ${ident('public', 'orders')}.${ident('id')}`).text).toBe('select "public"."orders"."id"');
  });

  it('refuses anything that is not a plain identifier', () => {
    expect(() => ident('id"; drop table x; --')).toThrow(/identifier/);
    expect(() => ident('')).toThrow(/identifier/);
    expect(() => ident('Name')).toThrow(/identifier/);
  });
});

describe('setColumns', () => {
  it('builds col = $n pairs, skipping undefined', () => {
    expect(compile(sql`update t set ${setColumns({ title: 'A', price_cents: 5, notes: undefined, sku: null })}`)).toEqual({
      text: 'update t set "title" = $1, "price_cents" = $2, "sku" = $3',
      values: ['A', 5, null],
    });
  });

  it('refuses an empty patch', () => {
    expect(() => setColumns({ a: undefined })).toThrow(/nothing to set/);
  });
});

describe('insertValues', () => {
  it('lists the columns and their parameters', () => {
    expect(compile(sql`insert into t ${insertValues({ a: 1, b: 'x' })}`)).toEqual({
      text: 'insert into t ("a", "b") values ($1, $2)',
      values: [1, 'x'],
    });
  });

  it('inserts several rows with the same columns', () => {
    expect(compile(sql`insert into t ${insertValues([{ a: 1, b: 'x' }, { a: 2, b: 'y' }])}`)).toEqual({
      text: 'insert into t ("a", "b") values ($1, $2), ($3, $4)',
      values: [1, 'x', 2, 'y'],
    });
  });
});

describe('json and inList', () => {
  it('sends JSON explicitly typed as jsonb, arrays included', () => {
    expect(compile(sql`select ${json(['a', 1])}`)).toEqual({ text: 'select $1::jsonb', values: ['["a",1]'] });
  });

  it('expands a list into an IN list, and an empty one into a false match', () => {
    expect(compile(sql`select 1 where id in ${inList(['a', 'b'])}`)).toEqual({
      text: 'select 1 where id in ($1, $2)',
      values: ['a', 'b'],
    });
    expect(compile(sql`select 1 where id in ${inList([])}`).text).toBe('select 1 where id in (select null where false)');
  });
});

describe('parseTimestamp', () => {
  it('formats timestamptz the way PostgREST did', () => {
    expect(parseTimestamp('2026-11-16 12:05:09.123456+00')).toBe('2026-11-16T12:05:09.123456+00:00');
    expect(parseTimestamp('2026-11-16 12:05:09+00')).toBe('2026-11-16T12:05:09+00:00');
    expect(parseTimestamp('2026-11-16 12:05:09')).toBe('2026-11-16T12:05:09');
  });
});

describe('upsert', () => {
  it('updates only the columns it was given, like PostgREST merge-duplicates', () => {
    expect(compile(upsert('stripe_events', { event_id: 'e1', status: 'ignored' }, ['event_id']))).toEqual({
      text: 'insert into "public"."stripe_events" ("event_id", "status") values ($1, $2) on conflict ("event_id") do update set "status" = excluded."status"',
      values: ['e1', 'ignored'],
    });
  });

  it('can leave existing rows alone', () => {
    expect(compile(upsert('t', { k: 1, v: 2 }, ['k'], { ignoreDuplicates: true })).text).toBe(
      'insert into "public"."t" ("k", "v") values ($1, $2) on conflict ("k") do nothing',
    );
  });
});

describe('callFunction', () => {
  it('calls a public function with named arguments, objects as jsonb', () => {
    expect(compile(callFunction('admin_begin_refund', { p_order_id: 'o1', p_items: [{ id: 'i', quantity: 1 }], p_shipping: false }))).toEqual({
      text: 'select "public"."admin_begin_refund"("p_order_id" => $1, "p_items" => $2::jsonb, "p_shipping" => $3) as result',
      values: ['o1', '[{"id":"i","quantity":1}]', false],
    });
    expect(compile(callFunction('customer_orders')).text).toBe('select "public"."customer_orders"() as result');
  });

  it('only accepts plain names', () => {
    expect(() => callFunction('x; drop table orders', {})).toThrow(/identifier/);
    expect(() => callFunction('ok', { 'p_a" => 1); --': 1 })).toThrow(/identifier/);
  });
});

describe('beginAs', () => {
  it('sets role and claims for the transaction in one statement', () => {
    expect(beginAs('anon')).toBe(
      `BEGIN; SELECT set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`,
    );
    expect(beginAs('authenticated', '8ec37142-c689-4230-84d7-0fbb12efda32')).toContain(
      `'{"sub":"8ec37142-c689-4230-84d7-0fbb12efda32","role":"authenticated"}'`,
    );
  });

  it('refuses anything that is not a uuid as the user id', () => {
    expect(() => beginAs('authenticated', "x', true); drop table orders; --")).toThrow(/user id/);
  });
});
