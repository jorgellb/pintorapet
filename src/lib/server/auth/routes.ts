/**
 * The only Better Auth endpoints reachable from the browser: the links in its
 * emails. Sign-up, sign-in and reset requests go through /api/auth/[action],
 * behind the anti-bot gate, and call Better Auth on the server.
 */
const EMAIL_LINKS = [
  /^\/api\/session\/verify-email\/?$/,
  /^\/api\/session\/reset-password\/[A-Za-z0-9_-]+\/?$/,
  /^\/api\/session\/magic-link\/verify\/?$/,
];

export function isEmailLinkRoute(method: string, pathname: string): boolean {
  return method === 'GET' && EMAIL_LINKS.some((route) => route.test(pathname));
}
