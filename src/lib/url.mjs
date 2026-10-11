// URL helpers. `baseUrl` is whatever Astro is built with (`/` by default, a
// subpath like `/chillin-with-pras/` for GitHub Pages). All hand-written
// internal hrefs must go through `u()` so they work under both layouts — the
// Cloudflare/root deployment and the Pages project-site subpath.
export const baseUrl = import.meta.env.BASE_URL ?? '/';

// The one place the public site's domain is configured — everything that
// needs an absolute URL (canonical links, OG/Twitter image tags, the
// sitemap) should read this instead of hardcoding a domain string. Backed
// by astro.config.mjs's `site`, which Astro exposes as import.meta.env.SITE;
// changing domains is then a one-line change there instead of hunting down
// every hardcoded occurrence.
export const siteOrigin = (import.meta.env.SITE ?? '').replace(/\/+$/, '');

/** Prefix an internal root-absolute path with the Astro base, if any. */
export function u(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  if (path.startsWith('//')) return path; // protocol-relative URL, leave alone
  const base = baseUrl.replace(/\/+$/, '');
  return path === '/' ? base + '/' : base + path;
}