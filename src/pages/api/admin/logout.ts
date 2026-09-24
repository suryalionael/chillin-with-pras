import type { APIRoute } from 'astro';
import { logoutCookieHeader } from '../../../lib/cms/session.ts';

export const prerender = false;

/** POST /api/admin/logout/ — clears the session cookie. */
export const POST: APIRoute = async () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': logoutCookieHeader() },
  });