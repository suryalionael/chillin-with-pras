// Server-side admin authentication.
//
// Production model: Cloudflare Access sits in front of /admin and /api/admin,
// authenticates the visitor, and forwards a signed JWT in the
// `Cf-Access-Jwt-Assertion` header. We do NOT trust that the request went
// through Access: every request's JWT is verified here (signature via the
// team's JWKS, issuer, audience, expiry) and the verified `email` claim must
// equal the single configured admin email.
//
// This module is pure (no Astro / Cloudflare imports) so it can be unit-tested
// in Node. Wiring lives in src/middleware.ts.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AdminIdentity {
  email: string;
  source: 'cloudflare-access' | 'dev-bypass' | 'access-code';
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403 | 503;
  code: 'unauthenticated' | 'forbidden' | 'not_configured';
  message: string;
}

export type AuthResult = { ok: true; identity: AdminIdentity } | AuthFailure;

export interface AdminAuthenticator {
  authenticate(request: Request): Promise<AuthResult>;
}

/** The subset of the Worker environment authentication reads. */
export interface AuthEnv {
  /**
   * Comma/space-separated allowlist of writer emails. Prefer it; legacy
   * `ADMIN_EMAIL` remains as a fallback so old configs keep working.
   */
  ADMIN_EMAILS?: string;
  /** Legacy single-admin fallback. */
  ADMIN_EMAIL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local development only (.dev.vars). Ignored unless running under `astro dev`. */
  DEV_ADMIN_BYPASS?: string;
}

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

const TEAM_DOMAIN_RX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

const fail = (status: AuthFailure['status'], code: AuthFailure['code'], message: string): AuthFailure => ({
  ok: false,
  status,
  code,
  message,
});

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Parses the writer allowlist from env: ADMIN_EMAILS (comma/space separated)
 * falls back to legacy ADMIN_EMAIL. Owners/invitees both land in this list.
 */
export function adminEmailsFromEnv(env: AuthEnv): string[] {
  const raw = env.ADMIN_EMAILS ?? env.ADMIN_EMAIL ?? '';
  const list = raw
    .split(/[\s,]+/)
    .map(normalizeEmail)
    .filter((e) => e !== '');
  return [...new Set(list)]; // dedupe, preserve order
}

/** Exact (case-insensitive) match against the writer allowlist. */
export function isAdminEmail(candidate: unknown, allowed: string[]): boolean {
  const a = normalizeEmail(candidate);
  return a !== '' && allowed.some((e) => e === a);
}

export interface AccessOptions {
  /** Override key resolution (tests). Defaults to the team's remote JWKS. */
  getKey?: JWTVerifyGetKey;
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();
function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    remoteKeys.set(teamDomain, keys);
  }
  return keys;
}

/**
 * Verifies a Cloudflare Access JWT and authorizes against the writer allowlist.
 * Fails closed: any missing configuration denies every request (503).
 */
export function createAccessAuthenticator(env: AuthEnv, options: AccessOptions = {}): AdminAuthenticator {
  const allowed = adminEmailsFromEnv(env);
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? '').trim().toLowerCase();
  const audience = (env.ACCESS_AUD ?? '').trim();

  return {
    async authenticate(request) {
      if (allowed.length === 0 || !audience || !TEAM_DOMAIN_RX.test(teamDomain)) {
        return fail(503, 'not_configured', 'Admin authentication is not configured.');
      }

      const token = request.headers.get(ACCESS_JWT_HEADER)?.trim();
      if (!token) return fail(401, 'unauthenticated', 'Authentication required.');

      let email: unknown;
      try {
        const { payload } = await jwtVerify(token, options.getKey ?? remoteJwks(teamDomain), {
          issuer: `https://${teamDomain}`,
          audience,
          algorithms: ['RS256'],
          clockTolerance: 5,
        });
        email = payload.email;
      } catch {
        // bad signature, wrong issuer/audience, expired, malformed, JWKS unreachable…
        return fail(401, 'unauthenticated', 'Authentication required.');
      }

      if (!isAdminEmail(email, allowed)) {
        return fail(403, 'forbidden', 'This account is not authorized.');
      }
      return { ok: true, identity: { email: normalizeEmail(email), source: 'cloudflare-access' } };
    },
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Local development only. Not included in production builds (see resolveAuthenticator). */
export function createDevAuthenticator(env: AuthEnv): AdminAuthenticator {
  return {
    async authenticate(request) {
      const allowed = adminEmailsFromEnv(env);
      if (allowed.length === 0) return fail(503, 'not_configured', 'No admin email is set.');
      if (!LOOPBACK.has(new URL(request.url).hostname)) {
        return fail(403, 'forbidden', 'Dev bypass only works on loopback addresses.');
      }
      return { ok: true, identity: { email: allowed[0]!, source: 'dev-bypass' } };
    },
  };
}

/**
 * Chooses the authenticator for local development. src/middleware.ts only calls
 * this under `import.meta.env.DEV` (a build-time constant), so in production
 * builds this function and the dev authenticator are tree-shaken away.
 * Kept separate and pure so its rules are unit-tested.
 */
export function resolveAuthenticator(env: AuthEnv, isDev: boolean): AdminAuthenticator {
  if (isDev && env.DEV_ADMIN_BYPASS === 'true') return createDevAuthenticator(env);
  return createAccessAuthenticator(env);
}
