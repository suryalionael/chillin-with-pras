// Slugs already used by the legacy articles (src/data/site.json). CMS stories may
// not reuse them: the public site resolves an article by slug alone.
import site from '../../data/site.json';

const legacy = new Set<string>(site.articles.map((a: { slug: string }) => a.slug));

export const isLegacySlug = (slug: string): boolean => legacy.has(slug);
