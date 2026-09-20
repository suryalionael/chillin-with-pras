// Gatekeeper for the admin surface.
//
// Public routes are never touched: they are prerendered, and this function
// returns `next()` for them before reading anything from the request.
// Admin routes (/admin/**, /api/admin/**) are authenticated on the server:
// the Cloudflare Access JWT is verified and the email must equal ADMIN_EMAIL.
import { defineMiddleware } from 'astro:middleware';
import { createAccessAuthenticator, resolveAuthenticator } from './lib/cms/auth.ts';
import { getEnv } from './lib/cms/runtime.ts';
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

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const protectedRoute = isAdminPath(pathname) || isAdminRoutePattern(context.routePattern);
  if (!protectedRoute) return next();

  const isApi = /^\/api\//i.test(pathname);
  const env = await getEnv();
  // `import.meta.env.DEV` is a build-time constant (false in production), so the
  // dev-bypass branch and its code are eliminated from the deployed Worker.
  const authenticator = import.meta.env.DEV ? resolveAuthenticator(env, true) : createAccessAuthenticator(env);
  const auth = await authenticator.authenticate(context.request);

  if (!auth.ok) {
    const res = isApi
      ? jsonError(auth.status, auth.code, auth.message)
      : new Response(`${auth.status} — ${auth.message}\n`, {
          status: auth.status,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    return withAdminHeaders(res);
  }

  context.locals.admin = auth.identity;
  return withAdminHeaders(await next());
});
