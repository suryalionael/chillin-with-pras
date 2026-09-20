import type { Section } from './schema.ts';

/** Display names and public URL prefixes for the two sections (mirrors src/lib/site.mjs). */
export const SECTION_LABEL: Record<Section, string> = {
  observe: 'To Observe & Report',
  show: 'To Show & Tell',
};

export const SECTION_PATH: Record<Section, string> = {
  observe: '/to-observe-and-report/',
  show: '/to-show-and-tell/',
};
