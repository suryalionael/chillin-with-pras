// Authorization guards. `locals.admin` is set only by middleware after JWT
// verification; API handlers call `authorizeAdminRequest` again so a bug or
// misrouting in one layer cannot open the write API on its own.
import { isAdminEmail, type AdminIdentity } from './auth.ts';

/**
 * True for any path that must be protected: /admin/**, /api/admin/**.
 * Normalizes before matching (dot segments, duplicate slashes, percent-encoding,
 * case) and treats undecodable paths under those prefixes as protected.
 */
export function isAdminPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return /admin/i.test(pathname); // undecodable: protect anything that mentions admin (fail closed)
  }
  // Normalize by hand: `new URL('//admin/', base)` would read "//admin" as a host.
  const stack: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  path = ('/' + stack.join('/')).toLowerCase();
  return /^\/(api\/)?admin(\/|$)/.test(path);
}

/** Astro route patterns for protected routes, e.g. "/admin/stories/[id]/edit". */
export function isAdminRoutePattern(pattern: string | undefined): boolean {
  return !!pattern && /^\/(api\/)?admin(\/|$)/i.test(pattern);
}

export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message, ...extra } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** State-changing requests must come from our own origin. */
export function isSameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const site = request.headers.get('sec-fetch-site');
  // No Origin: allow only same-origin / direct navigations, never cross-site.
  return site === null || site === 'same-origin' || site === 'none';
}

export type Authorized = { ok: true; admin: AdminIdentity } | { ok: false; response: Response };

/**
 * Independent per-handler authorization. Re-checks the identity against the
 * configured writer allowlist (not just "locals.admin exists") and enforces
 * same-origin for state-changing methods.
 */
export function authorizeAdminRequest(
  context: { locals: Pick<App.Locals, 'admin'>; request: Request },
  adminEmails: string[],
): Authorized {
  const admin = context.locals.admin;
  if (!admin || adminEmails.length === 0 || !isAdminEmail(admin.email, adminEmails)) {
    return { ok: false, response: jsonError(401, 'unauthenticated', 'Authentication required.') };
  }
  if (!SAFE_METHODS.has(context.request.method) && !isSameOrigin(context.request)) {
    return { ok: false, response: jsonError(403, 'forbidden', 'Cross-origin request rejected.') };
  }
  return { ok: true, admin };
}
