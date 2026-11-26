#!/usr/bin/env python3
# Reviews (Admin › Opiniones): who sees them, what the tables refuse (consent,
# one per order, rating, lengths, three photos at most, exactly one photo
# source) and what a refund does to "Compra verificada". One transaction,
# always rolled back. Runs on the local Docker PostgreSQL.
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-reviews.py
import json, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'aiven'))
from conn import connect  # noqa: E402

conn = connect(sys.argv[1] if len(sys.argv) > 1 else 'local')
cur = conn.cursor()
ok = bad = 0

def check(name, got, want):
    global ok, bad
    if got == want:
        ok += 1; print('OK  ', name)
    else:
        bad += 1; print('FAIL', name, 'got', got, 'want', want)

# Only these roles, as fixed statements.
SET_ROLE = {'authenticated': 'set local role authenticated', 'anon': 'set local role anon'}

def as_role(role, uid=None):
    cur.execute("reset role")
    if role == 'postgres':
        return
    cur.execute(SET_ROLE[role])
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': role}),))

def denied(name, sql, args=(), contains=None):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        check(name, 'allowed', 'denied')
    except Exception as err:
        if contains and contains not in str(err):
            check(name, str(err).splitlines()[0], contains)
        else:
            check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

def one(sql, args=()):
    cur.execute(sql, args)
    return cur.fetchone()

try:
    now = datetime.now(timezone.utc)
    adm = '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ana = '99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Boss','boss.rev@example.com',true,now()),(%s,'Ana','ana.rev@example.com',true,now())", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.rev@example.com')", (adm,))

    def order(ref):
        return one("""insert into orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash, payment_status, payment_provider, paid_at)
                      values (%s, 'es', 1000, 0, 1000, 'x', 'paid', 'stripe', now()) returning id""", (ref,))[0]

    def review(order_id, status='pending', verified=False):
        return one("""insert into reviews (source, kind, author_name, body, locale, consent_at, order_id, status, verified)
                      values ('customer', 'general', 'Ana G.', 'Preciosa', 'es', %s, %s, %s, %s) returning id""", (now, order_id, status, verified))[0]

    def admin_review(**kw):
        cols = {'author_name': 'A', 'body': 'B', **kw}
        names = ', '.join(cols)
        marks = ', '.join(['%s'] * len(cols))
        return (f"insert into reviews (source, kind, locale, {names}) values ('admin', 'general', 'es', {marks})", list(cols.values()))

    o1, o2, o3, o4 = order('PD-REV-1'), order('PD-REV-2'), order('PD-REV-3'), order('PD-REV-4')

    # ——— Who sees what ———
    rp = review(o1, 'published')
    rq = review(o2, 'pending')
    rh = review(o3, 'hidden')
    pub_photo = one("insert into review_photos (review_id, position, public_public_id, private_public_id) values (%s, 0, 'rev/pub', 'priv/pub') returning id", (rp,))[0]
    cur.execute("insert into review_photos (review_id, position, private_public_id) values (%s, 0, 'priv/pending')", (rq,))
    ids = [rp, rq, rh]
    as_role('anon')
    check('anon sees only published reviews', one("select count(*), bool_and(status = 'published') from reviews where id = any(%s)", (ids,)), (1, True))
    check('and the photos of published ones only', one("select count(*) from review_photos where review_id = any(%s)", (ids,))[0], 1)
    check('with the public copy', one("select public_public_id from review_photos where id = %s", (pub_photo,))[0], 'rev/pub')
    denied('but not the private copy\'s id', "select private_public_id from review_photos where id = %s", (pub_photo,), contains='permission denied')
    denied('nor the size', "select bytes from review_photos where id = %s", (pub_photo,), contains='permission denied')
    denied('nor select * (which includes them)', "select * from review_photos where id = %s", (pub_photo,), contains='permission denied')
    denied('anon cannot write a review', *admin_review())
    as_role('authenticated', ana)
    denied('a signed-in customer cannot read the private id either', "select private_public_id from review_photos where id = %s", (pub_photo,), contains='permission denied')
    check('a customer sees published ones too, nothing else', one("select count(*) from reviews where id = any(%s)", (ids,))[0], 1)
    denied('and cannot write one', *admin_review())
    cur.execute("update reviews set featured = true where id = %s", (rp,))
    check('nor change one', cur.rowcount, 0)
    cur.execute("delete from reviews where id = %s", (rp,))
    check('nor delete one', cur.rowcount, 0)
    as_role('authenticated', adm)
    check('the admin sees every photo through the public columns', one("select count(*) from review_photos where review_id = any(%s)", (ids,))[0], 2)
    check('the admin sees every review', one("select count(*) from reviews where id = any(%s)", (ids,))[0], 3)
    cur.execute("update reviews set featured = true where id = %s", (rq,))
    check('and can change them', one("select featured from reviews where id = %s", (rq,))[0], True)
    as_role('postgres')
    check('while a customer changed nothing', one("select featured from reviews where id = %s", (rp,))[0], False)

    # ——— What the table refuses ———
    denied('a customer review needs consent', "insert into reviews (source, kind, author_name, body, locale, order_id) values ('customer', 'general', 'A', 'B', 'es', %s)", (o4,), contains='reviews_customer_needs_consent_and_order')
    denied('a customer review needs an order', "insert into reviews (source, kind, author_name, body, locale, consent_at) values ('customer', 'general', 'A', 'B', 'es', now())", contains='reviews_customer_needs_consent_and_order')
    cur.execute(*admin_review(author_name='Lucía'))
    check('an admin review needs neither', one("select count(*) from reviews where author_name = 'Lucía'")[0], 1)
    denied('an admin review is never verified', *admin_review(verified=True), contains='reviews_admin_not_verified')
    denied('rating 6 is refused', *admin_review(rating=6), contains='reviews_rating_range')
    denied('rating 0 is refused', *admin_review(rating=0), contains='reviews_rating_range')
    cur.execute(*admin_review(author_name='Sin estrellas', rating=None))
    check('no rating is fine', one("select rating from reviews where author_name = 'Sin estrellas'")[0], None)
    cur.execute(*admin_review(body='x' * 1500))
    denied('body of 1501 chars is refused', *admin_review(body='x' * 1501), contains='reviews_body_length')
    denied('an empty body is refused', *admin_review(body=''), contains='reviews_body_length')
    denied('an empty name is refused', *admin_review(author_name=''), contains='reviews_author_name_length')
    denied('a name over 80 chars is refused', *admin_review(author_name='n' * 81), contains='reviews_author_name_length')
    denied('a city over 80 chars is refused', *admin_review(city='c' * 81), contains='reviews_city_length')
    denied('a pet name over 60 chars is refused', *admin_review(pet_name='p' * 61), contains='reviews_pet_name_length')
    denied('one review per order', "insert into reviews (source, kind, author_name, body, locale, consent_at, order_id) values ('customer', 'general', 'A', 'B', 'es', now(), %s)", (o1,), contains='reviews_order_unique')
    check('a new review is pending, not verified, not published',
          one("select status::text, verified, published_at is null from reviews where id = %s", (rq,)), ('pending', False, True))

    # ——— Refunds and "Compra verificada" ———
    ov, op = order('PD-REV-5'), order('PD-REV-6')
    rv = review(ov, 'published', verified=True)
    rpart = review(op, 'published', verified=True)
    cur.execute("update orders set payment_status = 'partially_refunded' where id = %s", (op,))
    check('a partial refund keeps it', one("select verified from reviews where id = %s", (rpart,))[0], True)
    cur.execute("update orders set payment_status = 'refunded' where id = %s", (op,))
    check('the rest of the refund clears it', one("select verified from reviews where id = %s", (rpart,))[0], False)
    cur.execute("update orders set payment_status = 'refunded' where id = %s", (ov,))
    check('a full refund clears verified, and the review stays', one("select verified, status::text from reviews where id = %s", (rv,)), (False, 'published'))
    cur.execute("update orders set payment_status = 'paid' where id = %s", (ov,))
    check('and it does not come back by itself', one("select verified from reviews where id = %s", (rv,))[0], False)

    # The real refund function, over a stall sale.
    cat, = one("select id from categories order by sort_order limit 1")
    mug, = one("""insert into products (sku, category_id, motif, status, price_cents, editorial_order, sale_enabled, weight_grams)
                  values ('T-REV', %s, 'Pug', 'published', 999, 99003, true, 380) returning id""", (cat,))
    cur.execute("insert into product_translations (product_id, locale, slug, title) values (%s,'es','taza-rev','Taza Pug'),(%s,'en','mug-rev','Pug Mug')", (mug, mug))
    cur.execute("insert into inventory (product_id, inventory_mode, stock_on_hand, verified_at) values (%s,'tracked',3,now()) on conflict (product_id) do update set inventory_mode='tracked', stock_on_hand=3, stock_reserved=0, verified_at=now()", (mug,))
    cur.execute("insert into shop_settings (id) values (1) on conflict (id) do nothing")
    cur.execute("update shop_settings set invoice_config = %s::jsonb where id = 1", (json.dumps({
        'issuerName': 'MEILI STRINGFELLOW PRUEBA', 'issuerNif': '89890001K', 'issuerAddress': 'Calle Mayor 1',
        'issuerPostalCode': '28013', 'issuerCity': 'Madrid', 'issuerKind': 'autonomo',
        'simplifiedPrefix': 'T', 'fullPrefix': 'U', 'rectifyingPrefix': 'V', 'shippingVatRate': 21, 'verifactuEnabled': False}),))
    as_role('authenticated', adm)
    sale = one("select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 2}], 'method': 'cash'}),))[0]
    as_role('postgres')
    review(sale['order_id'], 'published', verified=True)
    item, = one("select id from order_items where order_id = %s", (sale['order_id'],))
    state = lambda: one("select o.payment_status::text, r.verified from orders o join reviews r on r.order_id = o.id where o.id = %s", (sale['order_id'],))
    as_role('authenticated', adm)
    one("select public.admin_begin_refund(%s, %s::jsonb, false, true, 'Uno', true)", (sale['order_id'], json.dumps([{'order_item_id': str(item), 'quantity': 1}])))
    as_role('postgres')
    check('admin_begin_refund of one piece: partially refunded, still verified', state(), ('partially_refunded', True))
    as_role('authenticated', adm)
    one("select public.admin_begin_refund(%s, %s::jsonb, false, true, 'Otro', true)", (sale['order_id'], json.dumps([{'order_item_id': str(item), 'quantity': 1}])))
    as_role('postgres')
    check('admin_begin_refund of the rest: refunded, no longer verified', state(), ('refunded', False))

    # ——— Photos ———
    denied('a photo needs a source', "insert into review_photos (review_id, position) values (%s, 0)", (rq,), contains='review_photos_one_source')
    a, = one("insert into media_assets (bucket, object_path, mime_type) values ('media', 'rev/a.jpg', 'image/jpeg') returning id")
    denied('a photo cannot have both sources', "insert into review_photos (review_id, position, private_public_id, media_asset_id) values (%s, 1, 'p', %s)", (rq, a), contains='review_photos_one_source')
    cur.execute("insert into review_photos (review_id, position, media_asset_id) values (%s, 2, %s)", (rq, a))
    check('an admin photo points to Medios', one("select count(*) from review_photos where review_id = %s and media_asset_id = %s", (rq, a))[0], 1)
    denied('two photos cannot take the same position', "insert into review_photos (review_id, position, private_public_id) values (%s, 2, 'dup')", (rq,), contains='review_photos_position_unique')
    denied('a negative position is refused', "insert into review_photos (review_id, position, private_public_id) values (%s, -1, 'x')", (rq,), contains='review_photos_position_nonneg')

    r3 = review(order('PD-REV-7'))
    for i in range(3):
        cur.execute("insert into review_photos (review_id, position, private_public_id) values (%s, %s, %s)", (r3, i, f'priv/{i}'))
    denied('a fourth photo is refused', "insert into review_photos (review_id, position, private_public_id) values (%s, 3, 'priv/3')", (r3,), contains='REVIEW_PHOTOS_MAX')
    cur.execute("delete from review_photos where review_id = %s and position = 1", (r3,))
    cur.execute("insert into review_photos (review_id, position, private_public_id) values (%s, 3, 'priv/again')", (r3,))
    check('a freed slot takes another photo', one("select count(*) from review_photos where review_id = %s", (r3,))[0], 3)

    r2 = review(order('PD-REV-8'))
    cur.execute("insert into review_photos (review_id, position, private_public_id) values (%s, 0, 'a'), (%s, 1, 'b')", (r2, r2))
    denied('a fourth photo is refused even when two arrive together', "insert into review_photos (review_id, position, private_public_id) values (%s, 2, 'c'), (%s, 3, 'd')", (r2, r2), contains='REVIEW_PHOTOS_MAX')
    check('and nothing of that pair stays', one("select count(*) from review_photos where review_id = %s", (r2,))[0], 2)
    cur.execute("update review_photos set public_public_id = 'copy' where review_id = %s and position = 0", (r2,))
    check('editing a photo does not count it twice', one("select count(*) from review_photos where review_id = %s", (r2,))[0], 2)

    # ——— A photo changes the review (publish compares updated_at) ———
    def age(*ids):
        # Put updated_at in the past (the touch trigger would overwrite it, so pause that one).
        cur.execute("alter table reviews disable trigger reviews_touch")
        cur.execute("update reviews set updated_at = now() - interval '1 day' where id = any(%s)", (list(ids),))
        cur.execute("alter table reviews enable trigger reviews_touch")

    def stamp(rid):
        return one("select updated_at from reviews where id = %s", (rid,))[0]

    def fresh(rid):
        return one("select updated_at > now() - interval '1 hour' from reviews where id = %s", (rid,))[0]

    ra, rb = review(order('PD-REV-9')), review(order('PD-REV-10'))
    age(ra, rb)
    check('the aged review reads as old', fresh(ra), False)
    pa = one("insert into review_photos (review_id, position, private_public_id) values (%s, 0, 'priv/a') returning id", (ra,))[0]
    check('adding a photo bumps updated_at', fresh(ra), True)
    age(ra)
    cur.execute("update review_photos set public_public_id = 'rev/a' where id = %s", (pa,))
    check('setting public_public_id (what publish does) does not', fresh(ra), False)
    cur.execute("update review_photos set bytes = 10 where id = %s", (pa,))
    check('nor does the size', fresh(ra), False)
    cur.execute("update review_photos set position = 1 where id = %s", (pa,))
    check('moving it within the review does', fresh(ra), True)
    age(ra, rb)
    cur.execute("update review_photos set review_id = %s where id = %s", (rb, pa))
    check('moving a photo to another review bumps both', (fresh(ra), fresh(rb)), (True, True))
    age(rb)
    cur.execute("delete from review_photos where id = %s", (pa,))
    check('removing a photo bumps updated_at', fresh(rb), True)
    age(ra)
    cur.execute("insert into review_photos (review_id, position, media_asset_id) values (%s, 0, %s)", (ra, a))
    check('so does picking one from Medios', fresh(ra), True)

    # The guard Meili's publish runs: a photo added after she read the review refuses it.
    publish_guard = "update reviews set admin_edited_at = coalesce(admin_edited_at, now()) where id = %s and updated_at = %s returning id"
    age(ra)
    seen = stamp(ra)
    cur.execute("insert into review_photos (review_id, position, private_public_id) values (%s, 1, 'priv/late')", (ra,))
    cur.execute(publish_guard, (ra, seen))
    check('a photo added after Meili read the review: the publish guard matches nothing', cur.rowcount, 0)
    seen = stamp(ra)
    cur.execute(publish_guard, (ra, seen))
    check('read again, it matches', cur.rowcount, 1)
    cur.execute("delete from reviews where id = %s", (ra,))
    check('deleting the review with its photos works (the cascade finds no review to touch)', one("select count(*) from review_photos where review_id = %s", (ra,))[0], 0)

    # ——— Deleting ———
    cur.execute("delete from reviews where id = %s", (r3,))
    check('deleting a review deletes its photo rows', one("select count(*) from review_photos where review_id = %s", (r3,))[0], 0)
    cur.execute("delete from media_assets where id = %s", (a,))
    check('deleting an image from Medios takes it off the review', one("select count(*) from review_photos where media_asset_id = %s", (a,))[0], 0)

    # ——— updated_at ———
    cur.execute("update reviews set updated_at = now() - interval '1 day' where id = %s", (rq,))
    cur.execute("update reviews set city = 'Madrid' where id = %s", (rq,))
    check('a change touches updated_at', one("select updated_at > now() - interval '1 hour' from reviews where id = %s", (rq,))[0], True)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
