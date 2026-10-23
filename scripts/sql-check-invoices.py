#!/usr/bin/env python3
import sys, psycopg

def env():
    out = {}
    for line in open('.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k] = v.strip().strip('"').strip("'")
    return out

def main():
    e = env()
    conn = psycopg.connect(
        host=e['SUPABASE_DB_POOLER'], port=5432,
        user=e['SUPABASE_DB_POOLER_USER'], password=e['SUPABASE_DB_PASSWORD'],
        dbname='postgres', sslmode='require',
    )
    conn.autocommit = False
    cur = conn.cursor()
    failed = 0

    def check(name, sql, expect):
        nonlocal failed
        cur.execute(sql)
        got = cur.fetchone()[0]
        if got != expect:
            print(f'FAIL {name}: got {got!r} expected {expect!r}')
            failed += 1
        else:
            print(f'OK {name}')

    cur.execute('BEGIN')

    check('hash_official', """
      SELECT public.verifactu_hash(
        '89890001K', '12345678/G33', '01-01-2024', 'F1',
        1235, 12345, '', '2024-01-01T19:20:30+01:00')
    """, '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60')

    check('regime_madrid', "SELECT public.vat_regime('ES','28013')", 'es_vat')
    check('regime_tenerife', "SELECT public.vat_regime('ES','38001')", 'no_vat')
    check('regime_us', "SELECT public.vat_regime('US', NULL)", 'no_vat')
    check('regime_fr', "SELECT public.vat_regime('FR', NULL)", 'es_vat')
    check('nif_ok', "SELECT public.spanish_tax_id_ok('89890001K')", True)
    check('nif_bad', "SELECT public.spanish_tax_id_ok('12345678A')", False)
    check('net_1210', "SELECT public.net_cents(1210, 21)", 1000)

    cur.execute("""
      SELECT p.id FROM public.products p
      JOIN public.categories c ON c.id = p.category_id
      WHERE p.status = 'published' AND p.parent_id IS NULL
      ORDER BY CASE c.code WHEN 'mugs' THEN 0 ELSE 1 END, p.sku
      LIMIT 1
    """)
    product = cur.fetchone()
    if product:
        cur.execute(
            "SELECT public.shipping_quote(ARRAY[ROW(%s, 3)::public.cart_line_input], 'ES', '38001')",
            (product[0],),
        )
        quote = cur.fetchone()[0]
        if quote.get('vat_regime') != 'no_vat' or int(quote.get('vat_discount_cents') or 0) <= 0:
            print(f"FAIL canarias_discount: {quote!r}")
            failed += 1
        else:
            print('OK canarias_discount')
    else:
        print('FAIL canarias_discount: no published product')
        failed += 1

    cur.execute("""
      UPDATE public.shop_settings SET invoice_config = jsonb_build_object(
        'issuerName', 'MEILI STRINGFELLOW PRUEBA',
        'issuerNif', '89890001K',
        'issuerAddress', 'Calle Mayor 1',
        'issuerPostalCode', '28013',
        'issuerCity', 'Madrid',
        'issuerKind', 'autonomo',
        'simplifiedPrefix', 'T',
        'fullPrefix', 'U',
        'shippingVatRate', 21,
        'verifactuEnabled', false
      ) WHERE id = 1
    """)

    def insert_paid(ref):
        cur.execute(
            """
            INSERT INTO public.orders (
              reference, locale, subtotal_cents, shipping_cents, total_cents,
              access_token_hash, payment_status, customer_email, customer_name,
              vat_regime, paid_at
            ) VALUES (%s, 'es', 2997, 690, 3687, 'test-invoice', 'paid',
                      'cliente@example.com', 'Lucía Prueba', 'es_vat', now())
            RETURNING id
            """,
            (ref,),
        )
        oid = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO public.order_items (
              order_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents
            ) VALUES (%s, 'Taza Luna', 'MUG-LUNA', 999, 3, 2997)
            """,
            (oid,),
        )
        return oid

    cur.execute("SELECT extract(year FROM timezone('Europe/Madrid', now()))::int")
    year = cur.fetchone()[0]
    a = insert_paid('PD-INV-A')
    cur.execute("SELECT public.issue_invoice(%s)", (a,))
    first_id = cur.fetchone()[0]
    cur.execute("SELECT public.issue_invoice(%s)", (a,))
    again = cur.fetchone()[0]
    if again != first_id:
        print(f'FAIL issue_idempotent: {again} != {first_id}')
        failed += 1
    else:
        print('OK issue_idempotent')

    cur.execute("SELECT full_number, hash FROM public.invoices WHERE id = %s", (first_id,))
    number, first_hash = cur.fetchone()
    if number != f'T{year}-0001':
        print(f'FAIL number_first: {number}')
        failed += 1
    else:
        print('OK number_first')

    b = insert_paid('PD-INV-B')
    cur.execute("SELECT public.issue_invoice(%s)", (b,))
    second_id = cur.fetchone()[0]
    cur.execute("SELECT full_number, prev_hash FROM public.invoices WHERE id = %s", (second_id,))
    number2, prev = cur.fetchone()
    if number2 != f'T{year}-0002':
        print(f'FAIL number_second: {number2}')
        failed += 1
    else:
        print('OK number_second')
    if prev != first_hash:
        print(f'FAIL chain_prev: {prev} != {first_hash}')
        failed += 1
    else:
        print('OK chain_prev')

    cur.execute('SAVEPOINT inv_upd')
    try:
        cur.execute("UPDATE public.invoices SET total_cents = 1 WHERE id = %s", (first_id,))
        print('FAIL immutable_update: update succeeded')
        failed += 1
    except Exception as err:
        cur.execute('ROLLBACK TO SAVEPOINT inv_upd')
        if 'INVOICE_IMMUTABLE' in str(err):
            print('OK immutable_update')
        else:
            print(f'FAIL immutable_update: {err}')
            failed += 1

    cur.execute('SAVEPOINT inv_del')
    try:
        cur.execute("DELETE FROM public.invoices WHERE id = %s", (first_id,))
        print('FAIL immutable_delete: delete succeeded')
        failed += 1
    except Exception as err:
        cur.execute('ROLLBACK TO SAVEPOINT inv_del')
        if 'INVOICE_IMMUTABLE' in str(err):
            print('OK immutable_delete')
        else:
            print(f'FAIL immutable_delete: {err}')
            failed += 1

    conn.rollback()
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
