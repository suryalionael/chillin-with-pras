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
  source: 'cloudflare-access' | 'dev-bypass';
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

/** Exact (case-insensitive) match against the single admin. No prefix/suffix/alias matching. */
export function isAdminEmail(candidate: unknown, adminEmail: string): boolean {
  const a = normalizeEmail(candidate);
  const b = normalizeEmail(adminEmail);
  return a !== '' && b !== '' && a === b;
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
 * Verifies a Cloudflare Access JWT and authorizes the single admin.
 * Fails closed: any missing configuration denies every request (503).
 */
export function createAccessAuthenticator(env: AuthEnv, options: AccessOptions = {}): AdminAuthenticator {
  const adminEmail = normalizeEmail(env.ADMIN_EMAIL);
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? '').trim().toLowerCase();
  const audience = (env.ACCESS_AUD ?? '').trim();

  return {
    async authenticate(request) {
      if (!adminEmail || !audience || !TEAM_DOMAIN_RX.test(teamDomain)) {
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

      if (!isAdminEmail(email, adminEmail)) {
        return fail(403, 'forbidden', 'This account is not authorized.');
      }
      return { ok: true, identity: { email: adminEmail, source: 'cloudflare-access' } };
    },
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Local development only. Not included in production builds (see resolveAuthenticator). */
export function createDevAuthenticator(env: AuthEnv): AdminAuthenticator {
  return {
    async authenticate(request) {
      const adminEmail = normalizeEmail(env.ADMIN_EMAIL);
      if (!adminEmail) return fail(503, 'not_configured', 'ADMIN_EMAIL is not set.');
      if (!LOOPBACK.has(new URL(request.url).hostname)) {
        return fail(403, 'forbidden', 'Dev bypass only works on loopback addresses.');
      }
      return { ok: true, identity: { email: adminEmail, source: 'dev-bypass' } };
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
