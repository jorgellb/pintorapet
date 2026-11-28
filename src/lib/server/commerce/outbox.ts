import type { Db } from '@/lib/server/db';
import { Resend } from 'resend';
import { emailAdmin, emailFrom, hasResend, siteUrl } from '@/lib/server/env';
import { dbCall } from './pgErrors';
import { CommerceError } from './errors';
import { reviewReasonText } from '@/lib/domain/paymentReview';

type OutboxRow = {
  id: string;
  recipient: string;
  locale: 'en' | 'es';
  template_key: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

export function renderTemplate(
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
  if (templateKey === 'review_admin') {
    const who = [payload.name, payload.city].filter(Boolean).join(' · ');
    const stars = payload.rating ? ` (${payload.rating}/5)` : '';
    return {
      subject: `Opinión nueva de ${payload.name ?? ''}${stars}`,
      text: `${who} ha dejado una opinión nueva${stars}:\n\n«${payload.excerpt ?? ''}»\n\nLéela y publícala o recházala en ${siteUrl()}/admin/reviews/${payload.review_id ?? ''}/`,
    };
  }
  if (templateKey === 'order_paid_admin') {
    return {
      subject: `Pedido nuevo ${payload.reference ?? ''}`,
      text: `Hay un pedido nuevo pagado: ${payload.reference ?? ''}\n\n${siteUrl()}/admin/orders/${payload.order_id ?? ''}/`,
    };
  }
  if (templateKey === 'payment_review_admin') {
    const link = `${siteUrl()}/admin/orders/${payload.order_id ?? ''}/`;
    if (payload.reason === 'PAID_AGAIN') {
      return {
        subject: `Pago de más en ${payload.reference ?? ''}`,
        text:
          `${reviewReasonText('PAID_AGAIN')} El pedido no cambia.\n\n` +
          `Devuelve ese segundo pago desde el panel de Stripe o PayPal (búscalo por ${payload.payment ?? 'su identificador'}); ` +
          `no uses «Devolver» en el pedido, que devolvería el primero.\n\n${link}`,
      };
    }
    return {
      subject: `Pago a revisar: ${payload.reference ?? ''}`,
      text:
        `${reviewReasonText(String(payload.reason ?? ''))}\n\n` +
        `El dinero está cobrado. Entra en el pedido para darlo por bueno o cancelarlo y devolver el pago:\n${link}`,
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
  if (templateKey === 'commission_quote_customer') {
    const es = locale === 'es';
    const note = payload.note ? `\n\n${payload.note}` : '';
    return {
      subject: es
        ? `Tu presupuesto para el retrato ${payload.reference ?? ''}`
        : `Your quote for the portrait ${payload.reference ?? ''}`,
      text: es
        ? `Hola, ${payload.name ?? ''}:\n\nAquí tienes el presupuesto de tu encargo (${payload.reference ?? ''}): ${payload.title ?? ''}, ${payload.price ?? ''}, IVA incluido.${note}\n\n` +
          `Para aceptarlo y pagarlo, con el envío a tu dirección, entra aquí:\n${payload.link ?? ''}\n\n` +
          `Puedes pagar con tarjeta, PayPal, Bizum o transferencia. El enlace vale hasta el ${payload.until ?? ''}.\n\nGracias,\nMeili`
        : `Hello ${payload.name ?? ''},\n\nHere is the quote for your commission (${payload.reference ?? ''}): ${payload.title ?? ''}, ${payload.price ?? ''}, VAT included.${note}\n\n` +
          `To accept and pay for it, with shipping to your address, go here:\n${payload.link ?? ''}\n\n` +
          `You can pay by card, PayPal, Bizum or bank transfer. The link is valid until ${payload.until ?? ''}.\n\nThank you,\nMeili`,
    };
  }
  if (templateKey === 'order_shipped_customer') {
    const code = String(payload.tracking_code ?? '');
    const link = payload.tracking_url ? `\n${payload.tracking_url}` : '';
    const review = payload.review_url
      ? locale === 'es'
        ? `\n\nCuando lo tengas en casa, cuéntanos qué tal ha ido (y, si quieres, enséñanos una foto): ${payload.review_url}`
        : `\n\nOnce it is home, tell us how it went (and share a photo if you like): ${payload.review_url}`
      : '';
    return {
      subject:
        locale === 'es'
          ? `Tu pedido ${payload.reference ?? ''} está en camino`
          : `Your order ${payload.reference ?? ''} is on its way`,
      text:
        locale === 'es'
          ? `¡Tu pedido ${payload.reference ?? ''} ya está en camino!\n\nNúmero de seguimiento: ${code}${link}\n\nGracias por tu compra.${review}`
          : `Your order ${payload.reference ?? ''} is on its way!\n\nTracking number: ${code}${link}\n\nThank you for your order.${review}`,
    };
  }
  if (templateKey === 'order_refunded_customer') {
    const amount = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-IE', { style: 'currency', currency: 'EUR' })
      .format(Number(payload.amount_cents ?? 0) / 100)
      .replace(/\u00a0/g, ' ');
    const where =
      payload.provider === 'paypal'
        ? locale === 'es' ? 'tu cuenta de PayPal' : 'your PayPal account'
        : payload.provider === 'transfer'
          ? locale === 'es' ? 'tu cuenta bancaria (por transferencia)' : 'your bank account (by bank transfer)'
          : payload.provider === 'bizum'
            ? locale === 'es' ? 'tu cuenta (por Bizum)' : 'your account (by Bizum)'
          : locale === 'es' ? 'tu tarjeta' : 'your card';
    const full = payload.full === true;
    return {
      subject:
        locale === 'es'
          ? `Devolución de tu pedido ${payload.reference ?? ''}`
          : `Refund for your order ${payload.reference ?? ''}`,
      text:
        locale === 'es'
          ? `Te hemos devuelto ${amount} del pedido ${payload.reference ?? ''}${full ? ' (el pedido completo)' : ''}.\n\n` +
            (payload.provider === 'cash'
              ? 'Te lo devolvimos en efectivo, en el puesto. '
              : `Lo verás en ${where} en unos días, según tu banco. `) +
            `La factura rectificativa está en tu cuenta, en el pedido.\n\nGracias.`
          : `We have refunded ${amount} from order ${payload.reference ?? ''}${full ? ' (the whole order)' : ''}.\n\n` +
            (payload.provider === 'cash'
              ? 'We gave it back in cash, at the stall. '
              : `It will show on ${where} within a few days, depending on your bank. `) +
            `The corrective invoice is in your account, with the order.\n\nThank you.`,
    };
  }
  return {
    subject: `Pets Drawings · ${templateKey}`,
    text: JSON.stringify(payload, null, 2),
  };
}

/** Send rows already claimed by `owner`, marking each sent or failed (retried by the cron). */
async function sendClaimed(
  supabase: Db,
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

      await supabase.run`
        update public.notification_outbox
        set status = 'sent', sent_at = now(), lease_until = null, lease_owner = null, last_error = null
        where id = ${row.id} and lease_owner = ${owner}`;
      sent += 1;
    } catch (err) {
      failed += 1;
      const lastError = String(
        err && typeof err === 'object' && 'message' in err ? (err as { message: unknown }).message : err,
      ).slice(0, 500);
      await supabase.run`
        update public.notification_outbox
        set status = 'failed', attempt_count = ${(row.attempt_count ?? 0) + 1},
            next_run_at = ${new Date(Date.now() + 5 * 60_000).toISOString()},
            lease_until = null, lease_owner = null, last_error = ${lastError}
        where id = ${row.id} and lease_owner = ${owner}`.catch(() => 0);
    }
  }

  return { sent, failed };
}

export async function processOutboxBatch(
  supabase: Db,
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
  const rows = await dbCall(() => supabase.rows<OutboxRow>`
    select * from public.claim_outbox(p_limit => ${limit}, p_lease_seconds => 60, p_worker_id => ${owner})`);
  return { claimed: rows.length, ...(await sendClaimed(supabase, rows, owner)) };
}

/** Send one queued email now, by its dedupe key (e.g. a commission quote). Never throws. */
export async function sendOutboxNow(supabase: Db, dedupeKey: string): Promise<boolean> {
  if (!hasResend()) return false;
  try {
    const owner = `key:${Date.now()}`;
    const rows = await supabase.rows<OutboxRow>`
      update public.notification_outbox
      set status = 'leased', lease_owner = ${owner}, lease_until = now() + interval '60 seconds'
      where dedupe_key = ${dedupeKey} and status in ('pending', 'failed')
      returning id, recipient, locale, template_key, payload, attempt_count`;
    const { sent } = await sendClaimed(supabase, rows, owner);
    return sent > 0;
  } catch (err) {
    console.error('email left for the outbox cron', dedupeKey, err);
    return false;
  }
}

/**
 * Send an order's queued emails now (paid, shipped) instead of waiting for
 * the daily cron. Never throws: whatever fails stays queued for the cron.
 */
export async function sendOrderEmails(supabase: Db, orderId: string): Promise<void> {
  if (!hasResend()) return;
  try {
    const owner = `order:${orderId}:${Date.now()}`;
    const rows = await supabase.rows<OutboxRow>`
      select * from public.claim_outbox_for_order(p_order_id => ${orderId}, p_lease_seconds => 60, p_worker_id => ${owner})`;
    await sendClaimed(supabase, rows, owner);
  } catch (err) {
    console.error('order emails left for the outbox cron', orderId, err);
  }
}
