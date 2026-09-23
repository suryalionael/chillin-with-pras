// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

// The public site stays fully static (every page is prerendered at build time).
// The Cloudflare adapter exists only so /admin and /api/admin can run on demand;
// those routes opt out with `export const prerender = false`.
// https://docs.astro.build/en/guides/integrations-guide/cloudflare/
// The pages deployment someday lives at the site root. Until then, GitHub
// Pages (project site) needs a base path; set it via ASTRO_PAGES_BASE
// (e.g. ASTRO_PAGES_BASE=/chillin-with-pras/). When unset we keep the root
// layout so the Cloudflare deployment stays byte-identical to today.
const PAGES_BASE = process.env.ASTRO_PAGES_BASE ? String(process.env.ASTRO_PAGES_BASE) : undefined;

export default defineConfig({
  site: 'https://www.chillinwithpras.com/',
  trailingSlash: 'always',
  base: PAGES_BASE,
  output: 'static',
  // Auth is Cloudflare Access + JWT verification, not Astro sessions: no KV needed.
  session: false,
  adapter: cloudflare({
    // Keep the existing build-time sharp pipeline for the 218 photographs.
    // (The default, 'cloudflare-binding', would transform images at request time.)
    imageService: 'compile',
    // Prerender in Node exactly as before the adapter was added.
    prerenderEnvironment: 'node',
  }),
  integrations: [
    // React only powers the admin story editor, mounted with `client:only`
    // so ProseMirror never runs during the static (public) build.
    react(),
    // Admin pages are on-demand and are never part of the sitemap. The filter
    // must stay correct when a GitHub Pages base path is configured.
    sitemap({ filter: (page) => {
      const pathname = new URL(page).pathname;
      const trim = PAGES_BASE ? PAGES_BASE.replace(/\/+$/, '') : '';
      const bare = trim && pathname.startsWith(trim) ? pathname.slice(trim.length) : pathname;
      return !bare.startsWith('/admin');
    } }),
  ],
});
