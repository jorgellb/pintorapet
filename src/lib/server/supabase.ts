import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

export function createServiceClient(): SupabaseClient | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseRequestCookies(request: Request): { name: string; value: string }[] {
  const header = request.headers.get('cookie');
  if (!header) return [];
  return header.split(';').flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed) return [];
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return [];
    return [
      {
        name: trimmed.slice(0, eq),
        value: trimmed.slice(eq + 1),
      },
    ];
  });
}

export function createUserServerClient(
  cookies: AstroCookies,
  request: Request,
): SupabaseClient | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return parseRequestCookies(request);
      },
      setAll(toSet: { name: string; value: string; options?: CookieOptions }[]) {
        for (const c of toSet) {
          cookies.set(c.name, c.value, c.options);
        }
      },
    },
  });
}
