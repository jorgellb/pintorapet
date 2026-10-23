import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/server/supabase';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VisitPayload = {
  sessionId?: unknown;
  path?: unknown;
  locale?: unknown;
  referrer?: unknown;
  language?: unknown;
  viewport?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f]/g, '').trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

function browserOf(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Otro';
}

function osOf(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Otro';
}

function deviceOf(ua: string, viewport: string | null): string {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'móvil';
  const width = Number(viewport?.split('x')[0]);
  if (Number.isFinite(width) && width > 0 && width < 768) return 'móvil';
  return 'escritorio';
}

function hostOf(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (!host || host === 'localhost' || host.endsWith('petsdrawings.com')) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

export function isBot(userAgent: string): boolean {
  return /bot|crawl|spider|slurp|preview|headless|lighthouse|wget|curl|monitor/i.test(userAgent);
}

/** Stores one anonymous page view. Returns false when analytics storage is not configured. */
export async function recordVisit(request: Request, body: VisitPayload): Promise<boolean> {
  const service = createServiceClient();
  if (!service) return false;

  const sessionId = text(body.sessionId, 40);
  const path = text(body.path, 300);
  if (!sessionId || !uuid.test(sessionId) || !path || !path.startsWith('/')) return true;
  if (path.startsWith('/admin') || path.startsWith('/api')) return true;

  const userAgent = request.headers.get('user-agent') ?? '';
  if (isBot(userAgent)) return true;

  const viewport = text(body.viewport, 20);
  const country =
    text(request.headers.get('x-vercel-ip-country'), 8) ??
    text(request.headers.get('cf-ipcountry'), 8);
  const region = text(request.headers.get('x-vercel-ip-country-region'), 40);

  const { error } = await service.from('page_views').insert({
    session_hash: createHash('sha256').update(sessionId).digest('hex'),
    path,
    locale: text(body.locale, 8),
    referrer_host: hostOf(text(body.referrer, 500)),
    utm_source: text(body.utmSource, 80),
    utm_medium: text(body.utmMedium, 80),
    utm_campaign: text(body.utmCampaign, 120),
    country: country === 'XX' ? null : country,
    region,
    device: deviceOf(userAgent, viewport),
    browser: browserOf(userAgent),
    os: osOf(userAgent),
    language: text(body.language, 12),
    viewport,
  });
  if (error) throw error;
  return true;
}
