// URL helpers. `baseUrl` is whatever Astro is built with (`/` by default, a
// subpath like `/chillin-with-pras/` for GitHub Pages). All hand-written
// internal hrefs must go through `u()` so they work under both layouts — the
// Cloudflare/root deployment and the Pages project-site subpath.
export const baseUrl = import.meta.env.BASE_URL ?? '/';

/** Prefix an internal root-absolute path with the Astro base, if any. */
export function u(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  if (path.startsWith('//')) return path; // protocol-relative URL, leave alone
  const base = baseUrl.replace(/\/+$/, '');
  return path === '/' ? base + '/' : base + path;
}