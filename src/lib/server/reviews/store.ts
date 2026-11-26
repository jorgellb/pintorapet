import { insertValues, serviceDb, setColumns, sql, transaction, type Db } from '@/lib/server/db';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { sendOutboxNow } from '@/lib/server/commerce/outbox';
import { emailAdmin } from '@/lib/server/env';
import { cloudinaryImageUrl, parseCloudinaryUrl } from '@/lib/server/media/cloudinary';
import { storagePublicUrl } from '@/lib/server/storageUrl';
import {
  LOCKED_FOR_CUSTOMER_REVIEWS,
  REVIEWS_PER_PAGE,
  JSON_LD_MAX,
  productReviewSummary,
  roundTenth,
  reviewKind,
  reviewPhotoAlt,
  type AdminReviewInput,
  type ProductReviews,
  type RatingStats,
  type PublicReview,
  type ReviewInput,
  type ReviewKind,
  type ReviewLocale,
  type ReviewPatch,
  type ReviewSource,
  type ReviewStatus,
} from '@/lib/domain/reviews';
import { openReviewLink } from './link';
import { publishPhotos, purgePhotos, unpublishPhotos } from './photos';

type Deps = { fetchImpl?: typeof fetch };

const linkInvalid = () => new CommerceError('FORBIDDEN', 'REVIEW_LINK_INVALID', 403);
const closed = () => new CommerceError('CONFLICT', 'REVIEW_CLOSED', 409);
const notFound = () => new CommerceError('UNAVAILABLE', 'No existe esa opinión.', 404);

// ——— The customer's side ———

const excerpt = (text: string) => (text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text);

/**
 * The customer's review of an order: made, or changed while it is pending and
 * Meili has not touched it. The link is checked again here (`db` is the service
 * db). Only a new review tells Meili; editing does not send a second notice.
 */
export async function submitCustomerReview(
  input: ReviewInput,
  ctx: { ip: string; db?: Db },
): Promise<{ id: string; created: boolean }> {
  const db = ctx.db ?? serviceDb();
  if (!db) throw new CommerceError('NOT_CONFIGURED', 'Reviews are not available', 503);

  const order = await openReviewLink(db, input.reference, input.key);
  if (!order) throw linkInvalid();

  // Stars only go to something that was bought: one of this order's products, or none.
  const productId = input.productId ?? null;
  if (productId && !order.products.some((p) => p.id === productId)) {
    throw new CommerceError('VALIDATION', 'REVIEW_PRODUCT', 400);
  }
  const fields = {
    author_name: input.authorName,
    city: input.city,
    pet_name: input.petName,
    body: input.body,
    locale: input.locale,
    rating: input.rating ?? null,
    product_id: productId,
  };

  if (order.review) {
    if (!order.review.editable) throw closed();
    // An edit is agreed to again (the box is never pre-ticked): the permission dates from it.
    const changed = await dbCall(() => db.one<{ id: string }>`
      update public.reviews set ${setColumns({ ...fields, kind: reviewKind(productId, order.commissionRequestId), consent_at: new Date().toISOString() })}
      where id = ${order.review!.id} and status = 'pending' and admin_edited_at is null
      returning id`);
    if (!changed) throw closed();
    return { id: changed.id, created: false };
  }

  const row = {
    ...fields,
    source: 'customer',
    status: 'pending',
    kind: reviewKind(productId, order.commissionRequestId),
    order_id: order.id,
    commission_request_id: order.commissionRequestId,
    verified: true,
    consent_at: new Date().toISOString(),
  };
  // The review and the notice to Meili are saved together: a failed notice cannot
  // leave a review nobody hears about. (A db passed in by a test has no transaction.)
  const atomically = <T>(fn: (tx: Db) => Promise<T>) => (ctx.db ? fn(ctx.db) : transaction(fn));
  const created = await dbCall(() =>
    atomically(async (tx) => {
      const saved = await tx.one<{ id: string }>`
        insert into public.reviews ${insertValues(row)} on conflict (order_id) do nothing returning id`;
      // Two sends at once: the other one made it first.
      if (!saved) return null;
      await tx.run`
        insert into public.notification_outbox ${insertValues({
          dedupe_key: `review_admin:${saved.id}`,
          recipient: emailAdmin(),
          locale: 'es',
          template_key: 'review_admin',
          payload: JSON.stringify({
            review_id: saved.id,
            name: input.authorName,
            city: input.city,
            rating: input.rating ?? null,
            excerpt: excerpt(input.body),
          }),
          status: 'pending',
          next_run_at: new Date().toISOString(),
        })}
        on conflict (dedupe_key) do nothing`;
      return saved;
    }),
  );
  if (!created) throw closed();

  const dedupeKey = `review_admin:${created.id}`;
  await sendOutboxNow(db, dedupeKey);
  return { id: created.id, created: true };
}

// ——— Admin ———

export type AdminReviewPhoto = {
  id: string;
  position: number;
  /** A customer's upload (read through Admin's photo link while pending) or a picture from Medios. */
  source: 'private' | 'media';
  mediaAssetId: string | null;
  /**
   * The Medios picture, or the public copy while the review is published; null
   * otherwise (Admin then reads the private copy). A copy's id is written before
   * its upload, so outside "published" it may not exist yet.
   */
  url: string | null;
  /** A public copy is (or may still be) in Cloudinary: a hide that could not destroy it leaves this on. */
  publicCopy: boolean;
};

export type AdminReview = {
  id: string;
  source: ReviewSource;
  status: ReviewStatus;
  kind: ReviewKind;
  orderId: string | null;
  orderReference: string | null;
  productId: string | null;
  productTitle: string | null;
  commissionRequestId: string | null;
  authorName: string;
  city: string;
  petName: string;
  body: string;
  locale: ReviewLocale;
  rating: number | null;
  featured: boolean;
  verified: boolean;
  consentAt: string | null;
  adminEditedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** What Meili saw: publishing sends it back, and is refused if the review changed since. */
  updatedAt: string;
  photos: AdminReviewPhoto[];
};

type AdminRow = {
  id: string;
  source: ReviewSource;
  status: ReviewStatus;
  kind: ReviewKind;
  order_id: string | null;
  order_reference: string | null;
  product_id: string | null;
  product_title: string | null;
  commission_request_id: string | null;
  author_name: string;
  city: string;
  pet_name: string;
  body: string;
  locale: ReviewLocale;
  rating: number | null;
  featured: boolean;
  verified: boolean;
  consent_at: string | null;
  admin_edited_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  photos: Array<{
    id: string;
    position: number;
    media_asset_id: string | null;
    public_public_id: string | null;
    bucket: string | null;
    object_path: string | null;
  }> | null;
};

function cloudName(): string | null {
  return parseCloudinaryUrl(import.meta.env.CLOUDINARY_URL)?.cloudName ?? null;
}

/** Only the columns the API roles may select (no private ids): safe to run as the admin user. */
const ADMIN_SELECT = sql`
  select r.id, r.source, r.status, r.kind, r.order_id, o.reference as order_reference, r.product_id,
         t.title as product_title, r.commission_request_id, r.author_name, r.city, r.pet_name, r.body, r.locale,
         r.rating, r.featured, r.verified, r.consent_at, r.admin_edited_at, r.published_at, r.created_at, r.updated_at,
         coalesce((
           select json_agg(json_build_object('id', p.id, 'position', p.position, 'media_asset_id', p.media_asset_id,
                                             'public_public_id', p.public_public_id, 'bucket', a.bucket, 'object_path', a.object_path)
                           order by p.position)
           from public.review_photos p left join public.media_assets a on a.id = p.media_asset_id
           where p.review_id = r.id), '[]'::json) as photos
  from public.reviews r
  left join public.orders o on o.id = r.order_id
  left join public.product_translations t on t.product_id = r.product_id and t.locale = 'es'`;

function toAdminReview(r: AdminRow): AdminReview {
  const cloud = cloudName();
  return {
    id: r.id,
    source: r.source,
    status: r.status,
    kind: r.kind,
    orderId: r.order_id,
    orderReference: r.order_reference,
    productId: r.product_id,
    productTitle: r.product_title,
    commissionRequestId: r.commission_request_id,
    authorName: r.author_name,
    city: r.city,
    petName: r.pet_name,
    body: r.body,
    locale: r.locale,
    rating: r.rating,
    featured: r.featured,
    verified: r.verified,
    consentAt: r.consent_at,
    adminEditedAt: r.admin_edited_at,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    photos: (r.photos ?? []).map((p) => ({
      id: p.id,
      position: p.position,
      source: p.media_asset_id ? 'media' : 'private',
      mediaAssetId: p.media_asset_id,
      url: p.media_asset_id
        ? p.bucket && p.object_path ? storagePublicUrl(p.bucket, p.object_path) : null
        : r.status === 'published' && p.public_public_id && cloud ? cloudinaryImageUrl(cloud, p.public_public_id) : null,
      publicCopy: Boolean(p.public_public_id),
    })),
  };
}

/** The reviews in one state, newest first (pending ones oldest first: the queue to answer). */
export async function listReviews(db: Db, status: ReviewStatus): Promise<AdminReview[]> {
  const order = status === 'pending' ? sql`r.created_at asc` : sql`coalesce(r.published_at, r.created_at) desc`;
  const rows = await db.rows<AdminRow>(sql`${ADMIN_SELECT} where r.status = ${status}::public.review_status order by ${order}`);
  return rows.map(toAdminReview);
}

export async function getReview(db: Db, id: string): Promise<AdminReview | null> {
  const row = await db.one<AdminRow>(sql`${ADMIN_SELECT} where r.id = ${id}`);
  return row ? toAdminReview(row) : null;
}

/** How many reviews are in each state, for the tabs. */
export async function reviewCounts(db: Db): Promise<Record<ReviewStatus, number>> {
  const rows = await db.rows<{ status: ReviewStatus; n: number }>`
    select status, count(*)::int as n from public.reviews group by status`;
  const counts: Record<ReviewStatus, number> = { pending: 0, published: 0, hidden: 0 };
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}

async function setMediaPhotos(tx: Db, reviewId: string, photoIds: string[]): Promise<void> {
  const unique = [...new Set(photoIds)];
  await tx.run`delete from public.review_photos where review_id = ${reviewId}`;
  if (unique.length === 0) return;
  await tx.run`
    insert into public.review_photos ${insertValues(unique.map((mediaAssetId, position) => ({
      review_id: reviewId,
      position,
      media_asset_id: mediaAssetId,
    })))}`;
}

/**
 * Meili's own review, with pictures picked from Medios. Run inside asUser, then
 * call forgetReviews() once it has committed. Never "Compra verificada".
 */
export async function createAdminReview(tx: Db, input: AdminReviewInput): Promise<string> {
  const saved = await tx.one<{ id: string }>`
    insert into public.reviews ${insertValues({
      source: 'admin',
      status: 'pending',
      kind: reviewKind(input.productId, input.commissionRequestId),
      product_id: input.productId,
      commission_request_id: input.commissionRequestId,
      author_name: input.authorName,
      city: input.city,
      pet_name: input.petName,
      body: input.body,
      locale: input.locale,
      rating: input.rating,
      featured: input.featured,
      verified: false,
    })} returning id`;
  await setMediaPhotos(tx, saved!.id, input.photoIds);
  return saved!.id;
}

const changedMeanwhile = () => new CommerceError('CONFLICT', 'La opinión ha cambiado mientras la leías; vuelve a cargarla.', 409);

/**
 * Change a review (run inside asUser, then forgetReviews()). Meili edits an
 * admin review freely; of a customer's she may fix the display name, city and
 * pet, and pick the product among the ones in that order, never the words or the
 * stars. A change to those fields closes the review to its author.
 *
 * `seenUpdatedAt` is the `updated_at` the page showed: the row is locked and the
 * change is refused (409) if the review moved since, so a toggle or a save can
 * never hand the page a newer token for content it has not shown. Answers the
 * new `updated_at`, read inside the same transaction after the write.
 */
export async function updateReview(tx: Db, id: string, patch: ReviewPatch, seenUpdatedAt: string): Promise<string> {
  const review = await tx.one<{
    source: ReviewSource;
    order_id: string | null;
    product_id: string | null;
    commission_request_id: string | null;
    fresh: boolean;
  }>`select source, order_id, product_id, commission_request_id, (updated_at = ${seenUpdatedAt}::timestamptz) as fresh
     from public.reviews where id = ${id} for update`;
  if (!review) throw notFound();
  if (!review.fresh) throw changedMeanwhile();

  const customer = review.source === 'customer';
  if (customer && LOCKED_FOR_CUSTOMER_REVIEWS.some((field) => patch[field] !== undefined)) {
    throw new CommerceError('VALIDATION', 'Meili no cambia el texto ni las estrellas de una opinión de cliente.', 400);
  }

  const productId = patch.productId === undefined ? review.product_id : patch.productId;
  if (customer && patch.productId) {
    const bought = await tx.one`
      select 1 as ok from public.order_items where order_id = ${review.order_id} and product_id = ${patch.productId} limit 1`;
    if (!bought) throw new CommerceError('VALIDATION', 'Ese producto no está en el pedido.', 400);
  }
  const commissionRequestId = patch.commissionRequestId === undefined ? review.commission_request_id : patch.commissionRequestId;

  const display = patch.authorName !== undefined || patch.city !== undefined || patch.petName !== undefined || patch.productId !== undefined;
  const columns: Record<string, unknown> = {
    author_name: patch.authorName,
    city: patch.city,
    pet_name: patch.petName,
    featured: patch.featured,
    body: patch.body,
    rating: patch.rating,
    locale: patch.locale,
  };
  if (patch.productId !== undefined || patch.commissionRequestId !== undefined) {
    columns.product_id = productId;
    columns.commission_request_id = commissionRequestId;
    columns.kind = reviewKind(productId, commissionRequestId);
  }
  if (customer && display) columns.admin_edited_at = new Date().toISOString();

  if (Object.values(columns).some((value) => value !== undefined)) {
    // The row is locked, so this guard cannot fail now; it keeps the statement honest on its own.
    const written = await tx.one<{ id: string }>`
      update public.reviews set ${setColumns(columns)} where id = ${id} and updated_at = ${seenUpdatedAt}::timestamptz returning id`;
    if (!written) throw changedMeanwhile();
  }
  if (patch.photoIds !== undefined) await setMediaPhotos(tx, id, patch.photoIds);
  // After the photo trigger too: this is the value the page may publish with.
  const saved = await tx.one<{ updated_at: string }>`select updated_at from public.reviews where id = ${id}`;
  return saved!.updated_at;
}

/**
 * Show a review on the web. `seenUpdatedAt` is the `updated_at` Meili read: the
 * review is first closed to its author in one guarded statement (which also
 * refuses if anything changed since she looked), and only then are the photos
 * copied and the status flipped. So nothing the customer sends after she
 * reviewed it can be published unseen. `db` is the service db (it reads the
 * private ids). If copying fails the review stays unpublished, closed to its
 * author, and publishing can be tried again after reloading.
 */
export async function publishReview(db: Db, id: string, seenUpdatedAt: string, deps: Deps = {}): Promise<void> {
  const review = await db.one<{ status: ReviewStatus }>`select status from public.reviews where id = ${id}`;
  if (!review) throw notFound();
  const closedNow = await db.one<{ id: string }>`
    update public.reviews
    set admin_edited_at = case when source = 'customer' then coalesce(admin_edited_at, now()) else admin_edited_at end
    where id = ${id} and updated_at = ${seenUpdatedAt}::timestamptz
    returning id`;
  if (!closedNow) throw changedMeanwhile();
  await publishPhotos(db, id, deps);
  await db.run`
    update public.reviews set status = 'published', published_at = coalesce(published_at, now()) where id = ${id}`;
  forgetReviews();
}

export const HIDE_LEFTOVER_WARNING = 'Ocultada; quedan fotos por quitar de Cloudinary, vuelve a pulsar Ocultar';
export const DELETE_LEFTOVER_ERROR =
  'La opinión está oculta, pero no se pudieron borrar sus fotos de Cloudinary. Sigue guardada: vuelve a pulsar Borrar para intentarlo de nuevo.';

/**
 * Take a review off the web. Privacy first: the review is hidden and the pages
 * forget it before Cloudinary is asked for anything, so a Cloudinary outage
 * cannot keep it public. Then the public photo copies are destroyed (the private
 * ones kept); a copy that could not be destroyed keeps its id on the row, so
 * pressing Ocultar again (or Borrar) retries it, and the answer carries a warning.
 */
export async function hideReview(db: Db, id: string, deps: Deps = {}): Promise<{ warning?: string }> {
  const review = await db.one<{ status: ReviewStatus }>`select status from public.reviews where id = ${id}`;
  if (!review) throw notFound();
  await db.run`update public.reviews set status = 'hidden' where id = ${id}`;
  forgetReviews();
  try {
    await unpublishPhotos(db, id, deps);
  } catch (err) {
    console.error('[reviews] hidden, but public photos left in Cloudinary', id, err instanceof Error ? err.message : err);
    return { warning: HIDE_LEFTOVER_WARNING };
  }
  return {};
}

/**
 * Delete a review and every photo of it, private and public. It is hidden first
 * (as above); then the files go, then the row. If Cloudinary fails the review
 * stays hidden with its row and the ids still to destroy, and the error says so:
 * deleting again retries.
 */
export async function deleteReview(db: Db, id: string, deps: Deps = {}): Promise<void> {
  const review = await db.one<{ status: ReviewStatus }>`select status from public.reviews where id = ${id}`;
  if (!review) throw notFound();
  await db.run`update public.reviews set status = 'hidden' where id = ${id}`;
  forgetReviews();
  try {
    await purgePhotos(db, id, deps);
  } catch (err) {
    console.error('[reviews] hidden, not deleted: photos left in Cloudinary', id, err instanceof Error ? err.message : err);
    throw new CommerceError('UNAVAILABLE', DELETE_LEFTOVER_ERROR, 502);
  }
  await db.run`delete from public.reviews where id = ${id}`;
  forgetReviews();
}

// ——— What the web reads ———

const KEEP_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Forget what the pages read: call once a change to a review has committed. */
export function forgetReviews(): void {
  cache.clear();
}

/** Kept five minutes; a read that fails is not kept. */
function kept<T>(key: string, load: (db: Db) => Promise<T>, empty: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= KEEP_MS) return hit.value as Promise<T>;
  const db = serviceDb();
  if (!db) return Promise.resolve(empty);
  if (cache.size >= MAX_ENTRIES) cache.clear();
  const value = load(db).catch((err: unknown) => {
    console.error('[reviews] read failed', key, err instanceof Error ? err.message : err);
    cache.delete(key);
    return empty;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

type PublicRow = {
  id: string;
  author_name: string;
  city: string;
  pet_name: string;
  body: string;
  locale: ReviewLocale;
  rating: number | null;
  verified: boolean;
  published_at: string;
  product_id: string | null;
  kind: ReviewKind;
  photos: Array<{ public_id: string | null; bucket: string | null; object_path: string | null }> | null;
};

const PUBLIC_SELECT = sql`
  select r.id, r.author_name, r.city, r.pet_name, r.body, r.locale, r.rating, r.verified, r.published_at,
         r.product_id, r.kind,
         coalesce((
           select json_agg(json_build_object('public_id', p.public_public_id, 'bucket', a.bucket, 'object_path', a.object_path)
                           order by p.position)
           from public.review_photos p left join public.media_assets a on a.id = p.media_asset_id
           where p.review_id = r.id and (p.public_public_id is not null or a.id is not null)), '[]'::json) as photos
  from public.reviews r where r.status = 'published'`;

const HAS_PHOTO = sql`exists (
  select 1 from public.review_photos p left join public.media_assets a on a.id = p.media_asset_id
  where p.review_id = r.id and (p.public_public_id is not null or a.id is not null))`;

function toPublicReview(r: PublicRow): PublicReview {
  const cloud = cloudName();
  const alt = reviewPhotoAlt({ authorName: r.author_name, petName: r.pet_name }, r.locale);
  const photos = (r.photos ?? []).flatMap((p) => {
    const url =
      p.public_id && cloud ? cloudinaryImageUrl(cloud, p.public_id) : p.bucket && p.object_path ? storagePublicUrl(p.bucket, p.object_path) : null;
    return url ? [{ url, alt }] : [];
  });
  return {
    id: r.id,
    authorName: r.author_name,
    city: r.city,
    petName: r.pet_name,
    body: r.body,
    locale: r.locale,
    rating: r.rating,
    verified: r.verified,
    photos,
    publishedAt: r.published_at,
    productId: r.product_id,
    kind: r.kind,
  };
}

/** The home page: up to six with a photo, featured first and then the newest. */
export function homeReviews(): Promise<PublicReview[]> {
  return kept(
    'home',
    async (db) =>
      (await db.rows<PublicRow>(sql`${PUBLIC_SELECT} and ${HAS_PHOTO} order by r.featured desc, r.published_at desc limit 6`)).map(toPublicReview),
    [],
  );
}

/**
 * A product's page: the published reviews of the product and of its variants
 * (a keyring's shapes are options of one page), with or without a photo; the
 * newest 200 are listed. The figures and the structured-data items come from
 * the database, so they stay true past the 200. One cached entry per page
 * product: `variantIds` are the page's options, fixed for a product.
 */
export function productReviews(productId: string, variantIds: readonly string[] = []): Promise<ProductReviews> {
  const ids = [...new Set([productId, ...variantIds])];
  return kept(
    `product:${productId}`,
    async (db) => {
      const [rows, items, stats] = await Promise.all([
        db.rows<PublicRow>(sql`${PUBLIC_SELECT} and r.product_id = any(${ids}::uuid[]) order by r.published_at desc limit 200`),
        db.rows<PublicRow>(
          sql`${PUBLIC_SELECT} and r.product_id = any(${ids}::uuid[]) and r.verified and r.rating is not null order by r.published_at desc limit ${JSON_LD_MAX}`,
        ),
        db.one<{ rated: number; rated_avg: number | null; verified: number; verified_avg: number | null }>`
          select count(rating)::int as rated, avg(rating) as rated_avg,
                 (count(rating) filter (where verified))::int as verified,
                 avg(rating) filter (where verified) as verified_avg
          from public.reviews where status = 'published' and product_id = any(${ids}::uuid[])`,
      ]);
      const stat = (n: number | undefined, avg: number | null | undefined): RatingStats =>
        n && avg !== null && avg !== undefined ? { average: roundTenth(Number(avg)), count: n } : { average: null, count: 0 };
      return productReviewSummary(rows.map(toPublicReview), {
        visible: stat(stats?.rated, stats?.rated_avg),
        verified: stat(stats?.verified, stats?.verified_avg),
        items: items.map(toPublicReview),
      });
    },
    productReviewSummary([]),
  );
}

/** Encargos: the published reviews of commissions that have a photo. */
export function commissionReviews(): Promise<PublicReview[]> {
  return kept(
    'commission',
    async (db) =>
      (await db.rows<PublicRow>(sql`${PUBLIC_SELECT} and r.kind = 'commission' and ${HAS_PHOTO} order by r.published_at desc limit 12`)).map(
        toPublicReview,
      ),
    [],
  );
}

/** Contacto: every published review, twelve to a page, newest first. */
export function allReviews(page: number): Promise<{ reviews: PublicReview[]; pages: number }> {
  const wanted = Math.min(Math.max(1, Math.floor(Number(page)) || 1), 1000);
  return kept(
    `all:${wanted}`,
    async (db) => {
      const total = await db.one<{ n: number }>`select count(*)::int as n from public.reviews where status = 'published'`;
      const pages = Math.max(1, Math.ceil((total?.n ?? 0) / REVIEWS_PER_PAGE));
      const rows = await db.rows<PublicRow>(
        sql`${PUBLIC_SELECT} order by r.published_at desc limit ${REVIEWS_PER_PAGE} offset ${(Math.min(wanted, pages) - 1) * REVIEWS_PER_PAGE}`,
      );
      return { reviews: rows.map(toPublicReview), pages };
    },
    { reviews: [], pages: 1 },
  );
}
