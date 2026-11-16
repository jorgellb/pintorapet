import type { APIRoute } from 'astro';
import { auth, hasAuth } from '@/lib/server/auth';
import { isEmailLinkRoute } from '@/lib/server/auth/routes';

export const prerender = false;

/**
 * Better Auth's handler, for the links in its emails only (confirm the email,
 * choose a new password, the studio's sign-in link). Everything else 404s:
 * those actions go through our own forms and their anti-bot gate.
 */
export const ALL: APIRoute = ({ request }) => {
  if (!isEmailLinkRoute(request.method, new URL(request.url).pathname)) {
    return new Response('Not found', { status: 404 });
  }
  return hasAuth() ? auth().handler(request) : new Response('Not configured', { status: 503 });
};
