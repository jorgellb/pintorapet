import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { emailAdmin, emailFrom, hasResend, siteUrl } from '@/lib/server/env';
import { mapPgError } from './pgErrors';
import { CommerceError } from './errors';

type OutboxRow = {
  id: string;
  recipient: string;
  locale: 'en' | 'es';
  template_key: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

function renderTemplate(
  templateKey: string,
  locale: 'en' | 'es',
  payload: Record<string, unknown>,
): { subject: string; text: string } {
  if (templateKey === 'contact_admin') {
    return {
      subject:
        locale === 'es'
          ? `Contacto web — ${payload.name ?? ''}`
          : `Website contact — ${payload.name ?? ''}`,
      text: `From: ${payload.name} <${payload.email}>\n\n${payload.message ?? ''}`,
    };
  }
  if (templateKey === 'commission_admin') {
    return {
      subject:
        locale === 'es'
          ? `Encargo ${payload.reference ?? ''} — ${payload.name ?? ''}`
          : `Commission ${payload.reference ?? ''} — ${payload.name ?? ''}`,
      text: `Reference: ${payload.reference}\nFrom: ${payload.name} <${payload.email}>\nSize: ${payload.size}\nSubjects: ${payload.subjects}\n\n${payload.message ?? ''}`,
    };
  }
  if (templateKey === 'order_paid_admin') {
    return {
      subject: `Pedido nuevo ${payload.reference ?? ''}`,
      text: `Hay un pedido nuevo pagado: ${payload.reference ?? ''}\n\n${siteUrl()}/admin/orders/${payload.order_id ?? ''}/`,
    };
  }
  if (templateKey === 'messages_overflow') {
    const what = payload.form === 'commission' ? 'solicitudes de encargo' : 'mensajes de contacto';
    return {
      subject: `Avalancha de ${what} (${payload.day ?? ''})`,
      text:
        `Hoy han llegado muchas más ${what} de lo normal; puede ser un ataque. ` +
        `Todas están guardadas, pero a partir de ahora no te avisaremos de cada una por correo hasta mañana.\n\n` +
        `Revisa ${siteUrl()}/admin/antibot/` +
        (payload.form === 'commission' ? ` y ${siteUrl()}/admin/commissions/` : ''),
    };
  }
  if (templateKey === 'order_paid_customer') {
    return {
      subject:
        locale === 'es'
          ? `Pedido confirmado ${payload.reference ?? ''}`
          : `Order confirmed ${payload.reference ?? ''}`,
      text:
        locale === 'es'
          ? `Gracias. Tu pedido ${payload.reference ?? ''} está confirmado.`
          : `Thank you. Your order ${payload.reference ?? ''} is confirmed.`,
    };
  }
  if (templateKey === 'order_shipped_customer') {
    const code = String(payload.tracking_code ?? '');
    const link = payload.tracking_url ? `\n${payload.tracking_url}` : '';
    return {
      subject:
        locale === 'es'
          ? `Tu pedido ${payload.reference ?? ''} está en camino`
          : `Your order ${payload.reference ?? ''} is on its way`,
      text:
        locale === 'es'
          ? `¡Tu pedido ${payload.reference ?? ''} ya está en camino!\n\nNúmero de seguimiento: ${code}${link}\n\nGracias por tu compra.`
          : `Your order ${payload.reference ?? ''} is on its way!\n\nTracking number: ${code}${link}\n\nThank you for your order.`,
    };
  }
  return {
    subject: `Pets Drawings · ${templateKey}`,
    text: JSON.stringify(payload, null, 2),
  };
}

/** Send rows already claimed by `owner`, marking each sent or failed (retried by the cron). */
async function sendClaimed(
  supabase: SupabaseClient,
  rows: OutboxRow[],
  owner: string,
): Promise<{ sent: number; failed: number }> {
  const resend = new Resend(import.meta.env.RESEND_API_KEY);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const rendered = renderTemplate(
        row.template_key,
        row.locale,
        row.payload ?? {},
      );
      const { error: sendErr } = await resend.emails.send({
        from: emailFrom(),
        // Rows for the studio say 'admin' (see apply_payment).
        to: row.recipient === 'admin' ? emailAdmin() : row.recipient,
        subject: rendered.subject,
        text: rendered.text,
      });
      if (sendErr) throw sendErr;

      const { error: updErr } = await supabase
        .from('notification_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          lease_until: null,
          lease_owner: null,
          last_error: null,
        })
        .eq('id', row.id)
        .eq('lease_owner', owner);
      if (updErr) throw updErr;
      sent += 1;
    } catch (err) {
      failed += 1;
      await supabase
        .from('notification_outbox')
        .update({
          status: 'failed',
          attempt_count: (row.attempt_count ?? 0) + 1,
          next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          lease_until: null,
          lease_owner: null,
          last_error: String(
            err && typeof err === 'object' && 'message' in err
              ? (err as { message: unknown }).message
              : err,
          ).slice(0, 500),
        })
        .eq('id', row.id)
        .eq('lease_owner', owner);
    }
  }

  return { sent, failed };
}

export async function processOutboxBatch(
  supabase: SupabaseClient,
  limit = 20,
): Promise<{ claimed: number; sent: number; failed: number }> {
  if (!hasResend()) {
    throw new CommerceError(
      'NOT_CONFIGURED',
      'RESEND_API_KEY required for outbox',
      503,
    );
  }

  const owner = `outbox:${process.pid}:${Date.now()}`;
  const { data, error } = await supabase.rpc('claim_outbox', {
    p_limit: limit,
    p_lease_seconds: 60,
    p_worker_id: owner,
  });
  if (error) throw mapPgError(error);

  const rows = (data ?? []) as OutboxRow[];
  return { claimed: rows.length, ...(await sendClaimed(supabase, rows, owner)) };
}

/**
 * Send an order's queued emails now (paid, shipped) instead of waiting for
 * the daily cron. Never throws: whatever fails stays queued for the cron.
 */
export async function sendOrderEmails(supabase: SupabaseClient, orderId: string): Promise<void> {
  if (!hasResend()) return;
  try {
    const owner = `order:${orderId}:${Date.now()}`;
    const { data, error } = await supabase.rpc('claim_outbox_for_order', {
      p_order_id: orderId,
      p_lease_seconds: 60,
      p_worker_id: owner,
    });
    if (error) throw error;
    await sendClaimed(supabase, (data ?? []) as OutboxRow[], owner);
  } catch (err) {
    console.error('order emails left for the outbox cron', orderId, err);
  }
}
