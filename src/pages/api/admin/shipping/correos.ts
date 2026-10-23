import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { connectCorreos, disconnectCorreos } from '@/lib/server/shipping/admin';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const field = (max = 255) => z.string().trim().min(1).max(max);

const connectSchema = z
  .object({
    mode: z.enum(['test', 'live']),
    oauthClientId: field(),
    oauthClientSecret: field(),
    gatewayClientId: field(),
    gatewayClientSecret: field(),
    contractNumber: field(20),
    clientNumber: field(20),
    labellerCode: field(10),
  })
  .strict();

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const body = connectSchema.parse(await request.json());
    const row = await connectCorreos(admin.client, body);
    await audit(admin, 'connect_carrier', 'shipping_carrier', 'correos', {
      mode: row?.mode,
      contract: row?.contract_number,
      keyHint: row?.key_hint,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo conectar Correos.');
  }
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    await disconnectCorreos(admin.client);
    await audit(admin, 'disconnect_carrier', 'shipping_carrier', 'correos', {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo desconectar Correos.');
  }
};
