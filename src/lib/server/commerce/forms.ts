import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import {
  emailAdmin,
  emailFrom,
  hasResend,
  hasServiceSupabase,
} from '@/lib/server/env';
import { createServiceClient } from '@/lib/server/supabase';
import { CommerceError } from './errors';
import { mapPgError } from './pgErrors';

function requireService(): SupabaseClient {
  const client = createServiceClient();
  if (!client || !hasServiceSupabase()) {
    throw new CommerceError(
      'NOT_CONFIGURED',
      'Supabase service role required to persist form submissions',
      503,
    );
  }
  return client;
}

async function enqueueOutbox(
  supabase: SupabaseClient,
  row: {
    dedupeKey: string;
    recipient: string;
    locale: 'en' | 'es';
    templateKey: string;
    payload: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from('notification_outbox').upsert(
    {
      dedupe_key: row.dedupeKey,
      recipient: row.recipient,
      locale: row.locale,
      template_key: row.templateKey,
      payload: row.payload,
      status: 'pending',
      next_run_at: new Date().toISOString(),
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );
  if (error) throw mapPgError(error);
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

/** Deferred notifications to the studio waiting in the outbox at most; past it the message is only saved. */
const MAX_DEFERRED = 50;

async function canDefer(supabase: SupabaseClient): Promise<boolean> {
  const { count, error } = await supabase
    .from('notification_outbox')
    .select('id', { count: 'exact', head: true })
    .in('template_key', ['contact_admin', 'commission_admin'])
    .in('status', ['pending', 'failed']);
  return !error && (count ?? 0) < MAX_DEFERRED;
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

  const { data, error } = await supabase
    .from('contact_messages')
    .insert({
      locale: body.locale,
      contact_name: body.name,
      contact_email: body.email,
      message,
      status: 'received',
    })
    .select('id')
    .single();

  if (error) throw mapPgError(error);

  const id = data.id as string;
  // Deferred by the anti-bot mail cap: queue it only while the backlog is small.
  if (emailNow || (await canDefer(supabase))) {
    await enqueueOutbox(supabase, {
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
  }

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
      await supabase
        .from('notification_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('dedupe_key', `contact:${id}:admin`);
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
): Promise<{ id: string; reference: string }> {
  const supabase = requireService();
  const reference = `CR-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

  const { data, error } = await supabase
    .from('commission_requests')
    .insert({
      reference,
      locale: body.locale,
      contact_name: body.name,
      contact_email: body.email,
      size_hint: body.size,
      subjects: String(body.subjects),
      message: body.message,
      status: 'received',
    })
    .select('id')
    .single();

  if (error) throw mapPgError(error);
  const id = data.id as string;

  if (emailNow || (await canDefer(supabase))) {
    await enqueueOutbox(supabase, {
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
  }

  if (emailNow) {
    try {
      await sendNow({
        to: emailAdmin(),
        subject:
          body.locale === 'es'
            ? `Encargo ${reference} — ${body.name}`
            : `Commission ${reference} — ${body.name}`,
        text: `Reference: ${reference}\nFrom: ${body.name} <${body.email}>\nSize: ${body.size}\nSubjects: ${body.subjects}\n\n${body.message}`,
      });
      await supabase
        .from('notification_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('dedupe_key', `commission:${id}:admin`);
    } catch {
      // Cron will retry.
    }
  }

  return { id, reference };
}
