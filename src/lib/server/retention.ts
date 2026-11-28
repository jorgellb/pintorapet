import { deletePhotos } from '@/lib/server/commissionPhotos';
import type { Db } from '@/lib/server/db';

/**
 * What the privacy page says is kept only for a while, forgotten once its time
 * is up (public.purge_expired_data), plus old commission requests with their
 * photos. Run daily by the cron; each part logs and carries on if it fails.
 */
export async function purgeExpiredData(service: Db): Promise<Record<string, number>> {
  const counts =
    (await service.one<{ result: Record<string, number> }>`select public.purge_expired_data() as result`)?.result ?? {};
  let commissions = 0;
  const stale = await service.rows<{ id: string }>`select s as id from public.stale_commission_requests() s`;
  for (const { id } of stale) {
    try {
      await deletePhotos(service, id);
      await service.run`select public.forget_commission(${id})`;
      commissions += 1;
    } catch (err) {
      console.error('[retention] commission request %s not forgotten', id, err);
    }
  }
  return { ...counts, commissions };
}
