import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/cms/runtime.ts';
import { adminEmailsFromEnv } from '../../../lib/cms/auth.ts';
import { issueSessionCookie, isLoginLocked, verifyAccessCode, type SessionEnv } from '../../../lib/cms/session.ts';
import { jsonError } from '../../../lib/cms/guard.ts';
import { readJson } from '../../../lib/cms/api.ts';
import type { D1Like } from '../../../lib/cms/db.ts';

// Login with the shared invite code. Not behind admin auth by design: the
// middleware lets this route through so writers can obtain a session cookie.
export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const env = await getEnv();
  const body = await readJson(request, 8_192);
  if (!body.ok) return body.response;
  const v = body.value as { email?: unknown; code?: unknown } | null;
  if (!v || typeof v !== 'object') return jsonError(400, 'bad_request', 'Expected a JSON object.');
  if (typeof v.email !== 'string' || typeof v.code !== 'string' || !v.email || !v.code) {
    return jsonError(422, 'validation', 'email and code are required.');
  }

  const emails = adminEmailsFromEnv(env);
  const email = v.email.trim().toLowerCase();
  if (!emails.includes(email)) {
    // keep enumeration quiet: same response as a wrong code
    return jsonError(403, 'forbidden', 'Invalid email or access code.');
  }

  const db = env.DB as unknown as D1Like;
  const locked = await isLoginLocked(db, email);
  if (locked) return jsonError(429, 'too_many_attempts', 'Too many attempts. Try again in 10 minutes.');

  const okCode = verifyAccessCode(env as SessionEnv, v.code);
  await db
    .prepare('INSERT INTO access_attempts (email, attempted_at, succeeded, ip) VALUES (?, ?, ?, ?)')
    .bind(email, new Date().toISOString(), okCode ? 1 : 0, clientAddress ?? '')
    .run();

  if (!okCode) return jsonError(403, 'forbidden', 'Invalid email or access code.');

  const { header } = await issueSessionCookie(env as SessionEnv, email);
  return new Response(JSON.stringify({ ok: true, email }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': header },
  });
};