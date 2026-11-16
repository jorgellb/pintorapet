import type { APIRoute } from 'astro';
import { auth, hasAuth } from '@/lib/server/auth';

export const prerender = false;

/**
 * Better Auth's own endpoints: the links in its emails (confirm the email,
 * choose a new password, the studio's sign-in link) land here.
 */
export const ALL: APIRoute = ({ request }) =>
  hasAuth() ? auth().handler(request) : new Response('Not configured', { status: 503 });
