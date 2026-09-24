// Shared-invite-code session auth for the CMS.
//
// Cloudflare Access protects /admin on custom domains, but *.workers.dev cannot
// have an Access app in front of it. Until a domain is added, the worker itself
// issues a short-lived signed session cookie when a writer presents the shared
// invite code (CMS_ACCESS_CODE) for an allowlisted email. The code is only ever
// compared server-side (constant-time); it is never logged or returned.
//
// Sessions are HS256 JWTs signed with CMS_SESSION_SECRET. The middleware
// accepts the Access JWT, the session cookie, or the local dev bypass.
import { SignJWT, jwtVerify } from 'jose';

const SESSION_COOKIE = 'cms_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // lock for 10min

export interface SessionEnv {
  CMS_ACCESS_CODE?: string;
  CMS_SESSION_SECRET?: string;
  ADMIN_EMAILS?: string;
  ADMIN_EMAIL?: string;
}

export interface SessionPayload {
  email: string;
  source: 'access-code';
}

// ---------- constant-time comparison ----------

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i]! ^ eb[i]!;
  return diff === 0;
}

export function verifyAccessCode(env: SessionEnv, provided: string): boolean {
  const expected = (env.CMS_ACCESS_CODE ?? '').trim();
  if (!expected) return false;
  return safeEqual(expected, provided);
}

// ---------- rate limiting (brute-force guard) ----------

export type AttemptsDb = {
  prepare(sql: string): {
    bind(...params: unknown[]): { all<T = unknown>(): Promise<{ results: T[] }> };
  };
};

export async function isLoginLocked(db: AttemptsDb, email: string): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT attempted_at FROM access_attempts
        WHERE email = ? AND succeeded = 0 AND attempted_at > ?
        ORDER BY attempted_at DESC LIMIT ${MAX_ATTEMPTS}`,
    )
    .bind(email, new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString())
    .all<{ attempted_at: string }>();
  return results.length >= MAX_ATTEMPTS;
}

// ---------- session cookie ----------

/** Builds the Set-Cookie header for a fresh session. */
export async function issueSessionCookie(env: { CMS_SESSION_SECRET?: string }, email: string): Promise<{ name: string; value: string; header: string }> {
  const secret = (env.CMS_SESSION_SECRET ?? '').trim();
  if (!secret) throw new Error('CMS_SESSION_SECRET is not configured.');
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email, source: 'access-code' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
  const header =
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
  return { name: SESSION_COOKIE, value: token, header };
}

export function logoutCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export type SessionResult = { ok: true; payload: SessionPayload } | { ok: false; reason: 'missing' | 'invalid' | 'expired' };

/** Verifies the session cookie, if present. */
export async function readSessionCookie(env: { CMS_SESSION_SECRET?: string }, cookie: string | null): Promise<SessionResult> {
  const secret = (env.CMS_SESSION_SECRET ?? '').trim();
  if (!secret) return { ok: false, reason: 'invalid' };
  if (!cookie) return { ok: false, reason: 'missing' };
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || payload.source !== 'access-code') return { ok: false, reason: 'invalid' };
    return { ok: true, payload: { email: payload.email, source: 'access-code' } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === 'JWTExpired' ? 'expired' : 'invalid' };
  }
}

export { SESSION_COOKIE };