import type { APIRoute } from 'astro';
import { renderRobots } from '@/lib/seo/sitemap';

export const prerender = false;

export const GET: APIRoute = ({ site }) =>
  new Response(renderRobots(String(site ?? 'https://petsdrawings.com')), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400',
    },
  });
