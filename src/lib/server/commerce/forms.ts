import { randomUUID } from 'node:crypto';
import { insertValues, upsert, type Db } from '@/lib/server/db';
import { Resend } from 'resend';
import { emailAdmin, emailFrom, hasResend, siteUrl } from '@/lib/server/env';
import { hasDatabase } from '@/lib/server/db';
import { serviceDb } from '@/lib/server/db';
import { CommerceError } from './errors';
import { dbCall } from './pgErrors';
import { openUploads } from '@/lib/server/commissionPhotos';

function requireService(): Db {
  const client = serviceDb();
  if (!client || !hasDatabase()) {
    throw new CommerceError(
      'NOT_CONFIGURED',
      'A database is required to persist form submissions',
      503,
    );
  }
  return client;
}

async function enqueueOutbox(
  supabase: Db,
  row: {
    dedupeKey: string;
    recipient: string;
    locale: 'en' | 'es';
    templateKey: string;
    payload: Record<string, unknown>;
  },
) {
  const outboxRow = {
    dedupe_key: row.dedupeKey,
    recipient: row.recipient,
    locale: row.locale,
    template_key: row.templateKey,
    payload: JSON.stringify(row.payload),
    status: 'pending',
    next_run_at: new Date().toISOString(),
  };
  await dbCall(() => supabase.run(upsert('notification_outbox', outboxRow, ['dedupe_key'], { ignoreDuplicates: true })));
}

async function sendNow(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (!hasResend()) {
    throw new CommerceError(
      'NOT_CONFIGURED',
      'RESEND_API_KEY is required',
      503,
    );
  }
  const resend = new Resend(import.meta.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: emailFrom(),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
  if (error) {
    throw new CommerceError('INTERNAL', 'Email send failed', 500, error);
  }
}

/** emailNow: false leaves the email to the daily outbox cron (anti-bot mail cap). */
type Delivery = { emailNow?: boolean };

/** Deferred notifications to the studio waiting in the outbox at most; past it, one digest a day. */
const MAX_DEFERRED = 50;

/**
 * Queue the studio's email about a new message. When the anti-bot mail cap
 * deferred it and many are already waiting, queue instead a single digest
 * for the day: the message is saved either way, nothing is dropped silently.
 */
async function notifyStudio(
  supabase: Db,
  emailNow: boolean,
  form: 'contact' | 'commission',
  row: Parameters<typeof enqueueOutbox>[1],
): Promise<void> {
  if (!emailNow) {
    // Everything not sent yet: failed rows are retried, leased ones in flight.
    const count = await supabase
      .one<{ n: number }>`
        select count(*) as n from public.notification_outbox
        where template_key in ('contact_admin', 'commission_admin') and status in ('pending', 'failed', 'leased')`
      .then((row) => row?.n ?? 0, () => null);
    if (count === null || count >= MAX_DEFERRED) {
      const day = new Date().toISOString().slice(0, 10);
      console.warn('anti-bot mail cap: message saved, studio gets one digest', form, day);
      await enqueueOutbox(supabase, {
        dedupeKey: `messages_overflow:${form}:${day}`,
        recipient: emailAdmin(),
        locale: 'es',
        templateKey: 'messages_overflow',
        payload: { form, day },
      });
      return;
    }
  }
  await enqueueOutbox(supabase, row);
}

export async function submitContact(
  body: {
    locale: 'en' | 'es';
    name: string;
    email: string;
    reason?: string;
    message: string;
  },
  { emailNow = true }: Delivery = {},
): Promise<{ id: string }> {
  const supabase = requireService();
  const message = body.reason
    ? `[${body.reason}]\n\n${body.message}`
    : body.message;

  const inserted = await dbCall(() => supabase.one<{ id: string }>`
    insert into public.contact_messages ${insertValues({
      locale: body.locale,
      contact_name: body.name,
      contact_email: body.email,
      message,
      status: 'received',
    })}
    returning id`);
  const id = inserted!.id;
  await notifyStudio(supabase, emailNow, 'contact', {
    dedupeKey: `contact:${id}:admin`,
    recipient: emailAdmin(),
    locale: body.locale,
    templateKey: 'contact_admin',
    payload: {
      id,
      name: body.name,
      email: body.email,
      reason: body.reason ?? null,
      message: body.message,
    },
  });

  // Best-effort immediate send; outbox remains for retry/cron.
  if (emailNow) {
    try {
      await sendNow({
        to: emailAdmin(),
        subject:
          body.locale === 'es'
            ? `Contacto web — ${body.name}`
            : `Website contact — ${body.name}`,
        text: `From: ${body.name} <${body.email}>\n\n${message}`,
      });
      await supabase.run`
        update public.notification_outbox set status = 'sent', sent_at = now()
        where dedupe_key = ${`contact:${id}:admin`}`;
    } catch {
      // Leave pending for cron.
    }
  }

  return { id };
}

export async function submitCommission(
  body: {
    locale: 'en' | 'es';
    name: string;
    email: string;
    size: string;
    subjects: number;
    message: string;
  },
  { emailNow = true }: Delivery = {},
): Promise<{ id: string; reference: string; uploadToken: string }> {
  const supabase = requireService();
  const reference = `CR-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

  const inserted = await dbCall(() => supabase.one<{ id: string }>`
    insert into public.commission_requests ${insertValues({
      reference,
      locale: body.locale,
      contact_name: body.name,
      contact_email: body.email,
      size_hint: body.size,
      subjects: String(body.subjects),
      message: body.message,
      status: 'received',
    })}
    returning id`);
  const id = inserted!.id;

  await notifyStudio(supabase, emailNow, 'commission', {
    dedupeKey: `commission:${id}:admin`,
    recipient: emailAdmin(),
    locale: body.locale,
    templateKey: 'commission_admin',
    payload: {
      id,
      reference,
      name: body.name,
      email: body.email,
      size: body.size,
      subjects: body.subjects,
      message: body.message,
    },
  });

  if (emailNow) {
    try {
      await sendNow({
        to: emailAdmin(),
        subject:
          body.locale === 'es'
            ? `Encargo ${reference} — ${body.name}`
            : `Commission ${reference} — ${body.name}`,
        text:
          `Reference: ${reference}\nFrom: ${body.name} <${body.email}>\nSize: ${body.size}\nSubjects: ${body.subjects}\n\n${body.message}` +
          `\n\n${body.locale === 'es' ? 'Las fotos que envíe están en' : 'Any photos sent are in'} ${siteUrl()}/admin/commissions/`,
      });
      await supabase.run`
        update public.notification_outbox set status = 'sent', sent_at = now()
        where dedupe_key = ${`commission:${id}:admin`}`;
    } catch {
      // Cron will retry.
    }
  }

  // The pet's photos come next, one by one, with this key (commissionPhotos.ts).
  const uploadToken = await openUploads(supabase, id);
  return { id, reference, uploadToken };
}
