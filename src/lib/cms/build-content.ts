// Build-time CMS content fetcher.
// Runs during Astro build (Node environment) to fetch published CMS stories
// from D1 and convert them to the Article model for static generation.
//
// Failure policy: a missing/unreadable local D1, or a malformed published
// document, fails the build loudly rather than silently dropping content.
// Set CMS_BUILD_SKIP=1 to build without CMS stories on purpose.

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import type { PublishedStory } from './db.ts';
import { assembleArticles, legacyArticles, type Article, type RawSite } from '../../lib/content/article.ts';
import { globSync } from 'glob';

// Load site.json from project root
const projectRoot = cwd();
const siteData = JSON.parse(readFileSync(join(projectRoot, 'src/data/site.json'), 'utf-8')) as RawSite;

// Find the local D1 database file (has a hash in the name)
function findLocalDbPath(): string | null {
  const files = globSync('.wrangler/state/**/d1/*/*.sqlite', { absolute: true });
  return files.find((f) => !f.endsWith('metadata.sqlite')) || null;
}

const LOCAL_DB_PATH = findLocalDbPath();

/** Skip reading CMS stories entirely (build with legacy content only). */
export const CMS_BUILD_SKIP = process.env.CMS_BUILD_SKIP === '1';

/**
 * Fetches published CMS stories from a local SQLite/D1 file.
 * Uses libsql client to read the file directly (no Worker runtime needed).
 */
export async function fetchPublishedCmsStories(dbPath: string | null = LOCAL_DB_PATH): Promise<PublishedStory[]> {
  if (CMS_BUILD_SKIP) {
    console.warn('CMS_BUILD_SKIP=1 — building without CMS stories.');
    return [];
  }

  if (!dbPath) {
    throw new Error(
      'No local D1 database found (.wrangler/state/**/d1/*/*.sqlite). ' +
        'Publish a story locally first, or set CMS_BUILD_SKIP=1 to build without CMS stories.',
    );
  }

  let db: ReturnType<typeof createClient> | null = null;
  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    db = createClient({ url: `file:${dbPath}` });
    const result = await db.execute(`
      SELECT id, section, slug, pub_doc, published_at, pub_updated_at
      FROM stories
      WHERE status = 'published'
      ORDER BY published_at ASC, id
    `);
    rows = result.rows;
  } catch (e) {
    throw new Error(`Could not read local D1 (${dbPath}): ${e instanceof Error ? e.message : 'query failed'}`);
  } finally {
    try {
      db?.close();
    } catch {
      // connection never opened
    }
  }

  const stories: PublishedStory[] = [];
  for (const row of rows) {
    const id = row.id as string;
    let document: unknown;
    try {
      document = JSON.parse(row.pub_doc as string);
    } catch {
      throw new Error(`CMS story ${id}: pub_doc is not valid JSON — republish the story and rebuild.`);
    }
    const doc = document as { title?: unknown; body?: unknown };
    if (!doc.title || !doc.body) {
      throw new Error(`CMS story ${id}: pub_doc is missing title or body — republish the story and rebuild.`);
    }

    stories.push({
      id,
      section: row.section as 'observe' | 'show',
      slug: row.slug as string,
      publishedAt: row.published_at as string,
      pubUpdatedAt: row.pub_updated_at as string,
      document: document as PublishedStory['document'],
    });
  }

  return stories;
}

let cachedArticles: Article[] | null = null;

/**
 * Builds the complete article list for static generation.
 * Combines legacy articles (from site.json) with published CMS stories.
 * CMS stories continue each section's numbering after legacy articles.
 * Memoized: the build calls this once per generated page.
 */
export async function buildArticleList(): Promise<Article[]> {
  if (cachedArticles) return cachedArticles;
  const legacy = legacyArticles(siteData);
  const cmsStories = await fetchPublishedCmsStories();
  cachedArticles = assembleArticles(legacy, cmsStories);
  return cachedArticles;
}

/**
 * Gets all articles for a specific section (legacy + CMS).
 */
export async function getArticlesInSection(section: 'observe' | 'show'): Promise<Article[]> {
  const all = await buildArticleList();
  return all.filter((a) => a.section === section).sort((a, b) => a.order - b.order);
}

/**
 * Gets a single article by slug (checks both legacy and CMS).
 */
export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const all = await buildArticleList();
  return all.find((a) => a.slug === slug) || null;
}