// Build-time CMS content fetcher.
// Runs during Astro build (Node environment) to fetch published CMS stories
// and convert them to the Article model for static generation.
//
// Two source modes:
//   local dev : reads the local D1 SQLite state file via @libsql/client
//   CI/remote : reads a published-content snapshot file (CMS_SNAPSHOT_FILE)
//               produced by GET /api/deploy/snapshot/ (the deploy pipeline)
//
// Failure policy: a missing/unreadable source, or a malformed published
// document, fails the build loudly rather than silently dropping content.
// Set CMS_BUILD_SKIP=1 to build without CMS stories on purpose.

import { createClient } from '@libsql/client';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import type { PublishedStory } from './db.ts';
import { assembleArticles, legacyArticles, type Article, type RawSite } from '../../lib/content/article.ts';
import { globSync } from 'glob';

// Load site.json from project root
const projectRoot = cwd();
const siteData = JSON.parse(readFileSync(join(projectRoot, 'src/data/site.json'), 'utf-8')) as RawSite;

// Find the local D1 database file (has a hash in the name). Miniflare can
// leave more than one non-metadata sqlite file behind across restarts/config
// changes — picking the most recently written one is the only reliable way
// to find the file the currently-running dev server is actually using.
function findLocalDbPath(): string | null {
  const files = globSync('.wrangler/state/**/d1/*/*.sqlite', { absolute: true })
    .filter((f) => !f.endsWith('metadata.sqlite'));
  if (files.length === 0) return null;
  return files
    .map((f) => ({ f, mtime: statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
}

const LOCAL_DB_PATH = findLocalDbPath();

/** Skip reading CMS stories entirely (build with legacy content only). */
export const CMS_BUILD_SKIP = process.env.CMS_BUILD_SKIP === '1';

/**
 * Validates one published story's `pub_doc` and maps it to PublishedStory.
 * Shared by both the SQLite source and the snapshot-file source so the
 * validation rules cannot drift.
 */
function toPublishedStory(row: { id: string; section: string; slug: string; published_at: string; pub_updated_at: string; pub_doc: string }): PublishedStory {
  let document: unknown;
  try {
    document = JSON.parse(row.pub_doc);
  } catch {
    throw new Error(`CMS story ${row.id}: pub_doc is not valid JSON — republish the story and rebuild.`);
  }
  const doc = document as { title?: unknown; body?: unknown };
  if (!doc.title || !doc.body) {
    throw new Error(`CMS story ${row.id}: pub_doc is missing title or body — republish the story and rebuild.`);
  }
  return {
    id: row.id,
    section: row.section as 'observe' | 'show',
    slug: row.slug,
    publishedAt: row.published_at,
    pubUpdatedAt: row.pub_updated_at,
    document: document as PublishedStory['document'],
  };
}

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
    stories.push(
      toPublishedStory({
        id: row.id as string,
        section: row.section as string,
        slug: row.slug as string,
        published_at: row.published_at as string,
        pub_updated_at: row.pub_updated_at as string,
        pub_doc: row.pub_doc as string,
      }),
    );
  }
  return stories;
}

/**
 * Fetches published CMS stories from the JSON snapshot file the deploy
 * pipeline produced (GET /api/deploy/snapshot/). This is how remote/CI builds
 * obtain production D1 content without a D1 binding in the build environment.
 */
export function fetchPublishedCmsStoriesFromSnapshotFile(path: string): PublishedStory[] {
  if (CMS_BUILD_SKIP) {
    console.warn('CMS_BUILD_SKIP=1 — building without CMS stories.');
    return [];
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new Error(`Could not read CMS snapshot file (${path}): ${e instanceof Error ? e.message : 'read failed'}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`CMS snapshot file ${path} is not valid JSON — regenerate the snapshot and rebuild.`);
  }

  const { revision, stories } = data as { revision?: unknown; stories?: unknown };
  if (typeof revision !== 'number' || !Array.isArray(stories)) {
    throw new Error(`CMS snapshot file ${path} is missing revision or stories — regenerate the snapshot and rebuild.`);
  }
  console.log(`Building from CMS snapshot revision ${revision} (${stories.length} published stories).`);

  return stories.map((s) => {
    const story = s as { id?: unknown; section?: unknown; slug?: unknown; publishedAt?: unknown; pubUpdatedAt?: unknown; document?: unknown };
    if (typeof story.id !== 'string' || typeof story.slug !== 'string' || typeof story.publishedAt !== 'string' || typeof story.pubUpdatedAt !== 'string' || !story.document) {
      throw new Error('CMS snapshot file contains a malformed published story — regenerate the snapshot and rebuild.');
    }
    const doc = story.document as { title?: unknown; body?: unknown };
    if (!doc.title || !doc.body) {
      throw new Error(`CMS snapshot story ${story.id} is missing title or body — republish the story and regenerate the snapshot.`);
    }
    return toPublishedStory({
      id: story.id,
      section: story.section as string,
      slug: story.slug,
      published_at: story.publishedAt,
      pub_updated_at: story.pubUpdatedAt,
      pub_doc: JSON.stringify(story.document),
    });
  });
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
  const cmsStories = process.env.CMS_SNAPSHOT_FILE
    ? fetchPublishedCmsStoriesFromSnapshotFile(process.env.CMS_SNAPSHOT_FILE)
    : await fetchPublishedCmsStories();
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