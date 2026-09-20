// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// The public site stays fully static (every page is prerendered at build time).
// The Cloudflare adapter exists only so /admin and /api/admin can run on demand;
// those routes opt out with `export const prerender = false`.
// https://docs.astro.build/en/guides/integrations-guide/cloudflare/
export default defineConfig({
  site: 'https://www.chillinwithpras.com/',
  trailingSlash: 'always',
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
    // Admin pages are on-demand and are never part of the sitemap.
    sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/admin') }),
  ],
});
