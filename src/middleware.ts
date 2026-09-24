// Gatekeeper for the admin surface.
//
// Public routes are never touched: they are prerendered, and this function
// returns `next()` for them before reading anything from the request.
// Admin routes (/admin/**, /api/admin/**) are authenticated on the server:
// the Cloudflare Access JWT is verified and the email must equal ADMIN_EMAIL.
import { defineMiddleware } from 'astro:middleware';
import { createAccessAuthenticator, resolveAuthenticator, type AdminIdentity } from './lib/cms/auth.ts';
import { getEnv } from './lib/cms/runtime.ts';
import { readSessionCookie, type SessionEnv } from './lib/cms/session.ts';
import { isAdminPath, isAdminRoutePattern, jsonError } from './lib/cms/guard.ts';

const NO_STORE = 'no-store';

function withAdminHeaders(response: Response): Response {
  // Astro responses can have immutable headers; rebuild to be safe.
  const headers = new Headers(response.headers);
  headers.set('cache-control', NO_STORE);
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'same-origin');
  headers.set('x-frame-options', 'DENY');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const SESSION_COOKIES_RX = /cms_session=([^;]+)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const protectedRoute = isAdminPath(pathname) || isAdminRoutePattern(context.routePattern);
  if (!protectedRoute) return next();

  const isApi = /^\/api\//i.test(pathname);
  const env = await getEnv();

  const denied = (status: number, code: string, message: string) =>
    withAdminHeaders(isApi ? jsonError(status, code, message) : new Response(`${status} — ${message}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } }));

  // 1. Local development bypass (compiled out of production builds).
  if (import.meta.env.DEV && env.DEV_ADMIN_BYPASS === 'true') {
    const bypass = resolveAuthenticator(env, true);
    const auth = await bypass.authenticate(context.request);
    if (!auth.ok) return denied(auth.status, auth.code, auth.message);
    context.locals.admin = auth.identity;
    return withAdminHeaders(await next());
  }

  // 2. Cloudflare Access JWT (when a custom domain is attached later).
  const access = await createAccessAuthenticator(env).authenticate(context.request);
  if (access.ok) {
    context.locals.admin = access.identity;
    return withAdminHeaders(await next());
  }

  // 3. Shared invite-code session (works on *.workers.dev, where Access cannot
  //    be applied). A valid session cookie authorizes a writer allowlisted email.
  const sea = env as SessionEnv;
  const cookie = context.request.headers.get('cookie');
  const session = await readSessionCookie(sea, cookie ? (SESSION_COOKIES_RX.exec(cookie)?.[1] ?? null) : null);

  // The login page and login API must stay reachable to issue sessions.
  const isLoginPage = pathname === '/admin/login/';
  const isLoginApi = pathname === '/api/admin/login/' && context.request.method === 'POST';

  if (!session.ok) {
    if (isLoginPage || isLoginApi) return next();
    // Page requests without a valid identity: send the writer to the login page.
    // API requests: 401 (nothing useful to return to a script).
    if (!isApi) {
      const loc = new URL('/admin/login/', context.url).pathname;
      return withAdminHeaders(new Response(null, { status: 302, headers: { location: loc } }));
    }
    return denied(401, 'unauthenticated', 'Authentication required.');
  }

  const admin: AdminIdentity = { email: session.payload.email, source: 'access-code' };
  const allowed = new Set((env.ADMIN_EMAILS ?? env.ADMIN_EMAIL ?? '').split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!allowed.has(admin.email)) {
    return denied(403, 'forbidden', 'This account is not on the writer allowlist.');
  }
  context.locals.admin = admin;
  return withAdminHeaders(await next());
});
