import type { APIRoute } from 'astro';
import { authorizeAdminRequest } from '../../../lib/cms/guard.ts';
import { getEnv } from '../../../lib/cms/runtime.ts';

// Must never be prerendered: it reads per-request identity.
export const prerender = false;

/** Diagnostic: who does the server think you are? (GET /api/admin/whoami/) */
export const GET: APIRoute = async (context) => {
  const env = await getEnv();
  const auth = authorizeAdminRequest(context, env.ADMIN_EMAIL);
  if (!auth.ok) return auth.response;
  return new Response(JSON.stringify({ email: auth.admin.email, source: auth.admin.source }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
