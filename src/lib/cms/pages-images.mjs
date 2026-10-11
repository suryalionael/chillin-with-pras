// Resolve a CMS image id to a public URL under two modes:
//
//   Cloudflare/root (default):  /images/{id}  (the Worker R2 delivery route)
//   GitHub Pages:               {base}cms-media/{id}.{ext}
//                               from a committed `.cms/media-manifest.json`
//
// The manifest is only consulted when the build targets GitHub Pages
// (ASTRO_PAGES_BUILD=1). Root/Cloudflare builds always use the Worker
// /images/{id} route and never read the committed media. The Article model
// always carries the image id — this only picks a URL.
//
// Deliberately a separate flag from ASTRO_PAGES_BASE (the Astro `base:`
// path): the two used to be the same variable, back when GitHub Pages only
// ever served this project from the /chillin-with-pras/ project-site
// subpath. Now that Pages serves chillinwithpras.ca at the root, that
// subpath is gone (ASTRO_PAGES_BASE is unset again), but Pages builds still
// need the exported-media image URLs, not the Worker-only /images/ route —
// so "is this a Pages build" can no longer be inferred from "does it have a
// base path".
import { readFileSync, existsSync } from 'node:fs';
import { cwd } from 'node:process';
import { join } from 'node:path';
import { baseUrl, u } from '../url.mjs';

const PAGES_BUILD = process.env.ASTRO_PAGES_BUILD === '1';
const MANIFEST = join(cwd(), '.cms', 'media-manifest.json');

let cached = null;
function manifest() {
  if (cached !== null) return cached;
  try {
    cached = PAGES_BUILD && existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  } catch {
    cached = {};
  }
  return cached;
}

/**
 * Public URL for a CMS image. Returns the static Pages media path when the
 * build targets GitHub Pages and the committed media manifest maps the id,
 * otherwise the root R2 route.
 */
export function cmsImageUrl(imageId) {
  const file = manifest()[imageId];
  if (file) return u('/cms-media/' + file);
  return `/images/${imageId}/`;
}

// re-export for component imports
export { baseUrl };