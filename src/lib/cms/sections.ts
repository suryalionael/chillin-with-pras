import type { Section } from './schema.ts';

/** Display names and public URL prefixes for the two sections (mirrors src/lib/site.mjs). */
export const SECTION_LABEL: Record<Section, string> = {
  observe: 'To Observe & Report',
  show: 'To Show & Tell',
};

/** Where readers actually visit the site (GitHub Pages), not this admin Worker. */
export const PUBLIC_SITE = 'https://suryalionael.github.io/chillin-with-pras';

export const SECTION_PATH: Record<Section, string> = {
  observe: '/to-observe-and-report/',
  show: '/to-show-and-tell/',
};
