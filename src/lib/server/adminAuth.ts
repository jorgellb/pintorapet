import type { AstroCookies } from 'astro';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createUserServerClient } from '@/lib/server/supabase';

export async function getSessionUser(
  cookies: AstroCookies,
  request: Request,
): Promise<{ client: SupabaseClient; user: User } | null> {
  const client = createUserServerClient(cookies, request);
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { client, user: data.user };
}

export async function isActiveAdmin(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data?.user_id) return false;
  return true;
}

export async function requireAdmin(
  cookies: AstroCookies,
  request: Request,
): Promise<{ client: SupabaseClient; user: User } | null> {
  const session = await getSessionUser(cookies, request);
  if (!session) return null;
  if (!(await isActiveAdmin(session.client, session.user.id))) return null;
  return session;
}
