// D1 access for the CMS. A story is ONE row holding a working draft and the
// published snapshot:
//
//   draft_doc  autosaved working copy   (draft_rev increments on every save)
//   pub_doc    immutable snapshot taken at Publish; the public build reads only this
//
// Every mutation that depends on what the editor last saw is guarded by
// `draft_rev` in the UPDATE's WHERE clause, so a stale browser tab can never
// silently overwrite newer work: it gets a `conflict` instead.
import {
  emptyStoryDocument,
  isSection,
  parseStoredDocument,
  parseStoryDocument,
  publishIssues,
  referencedImageIds,
  serializeDocument,
  type Issue,
  type Section,
  type StoryDocument,
} from './schema.ts';
import { isValidSlug, slugify, uniqueSlug } from './slug.ts';

// ---------- minimal D1 surface (D1Database satisfies it; tests use node:sqlite) ----------

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
export interface D1Like {
  prepare(sql: string): D1StatementLike;
}

export interface Deps {
  now: () => Date;
  newId: () => string;
  /** true for slugs that already exist outside the CMS (the legacy articles) */
  isSlugReserved: (slug: string) => boolean;
}
const defaultDeps: Deps = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
  isSlugReserved: () => false,
};
const withDeps = (d?: Partial<Deps>): Deps => ({ ...defaultDeps, ...d });

// ---------- shapes ----------

export type Status = 'draft' | 'published';

interface StoryRow {
  id: string;
  section: string;
  slug: string | null;
  status: string;
  draft_doc: string;
  draft_rev: number;
  draft_updated_at: string;
  pub_doc: string | null;
  published_at: string | null;
  pub_updated_at: string | null;
  created_at: string;
}

export interface Story {
  id: string;
  section: Section;
  slug: string | null;
  status: Status;
  draftRev: number;
  draftUpdatedAt: string;
  createdAt: string;
  publishedAt: string | null;
  pubUpdatedAt: string | null;
  draft: StoryDocument;
  /** true when a published story has edits that are not yet republished */
  hasUnpublishedChanges: boolean;
}

export interface PublishedStory {
  id: string;
  section: Section;
  slug: string;
  publishedAt: string;
  pubUpdatedAt: string;
  document: StoryDocument;
}

export interface StorySummary {
  id: string;
  section: Section;
  slug: string | null;
  status: Status;
  title: string;
  draftRev: number;
  draftUpdatedAt: string;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
}

export class CorruptDocumentError extends Error {
  storyId: string;
  issues: Issue[];
  constructor(storyId: string, issues: Issue[]) {
    super(`Stored document for story ${storyId} is invalid.`);
    this.storyId = storyId;
    this.issues = issues;
  }
}

const SELECT_ROW = `SELECT id, section, slug, status, draft_doc, draft_rev, draft_updated_at,
  pub_doc, published_at, pub_updated_at, created_at FROM stories WHERE id = ?`;

function toStory(row: StoryRow): Story {
  const parsed = parseStoredDocument(row.draft_doc);
  if (!parsed.ok) throw new CorruptDocumentError(row.id, parsed.issues);
  return {
    id: row.id,
    section: isSection(row.section) ? row.section : 'observe',
    slug: row.slug,
    status: row.status === 'published' ? 'published' : 'draft',
    draftRev: row.draft_rev,
    draftUpdatedAt: row.draft_updated_at,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    pubUpdatedAt: row.pub_updated_at,
    draft: parsed.value,
    hasUnpublishedChanges: row.pub_doc !== null && row.pub_doc !== row.draft_doc,
  };
}

const isUniqueViolation = (e: unknown): boolean => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
const iso = (d: Date) => d.toISOString();
const isRealDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

// ---------- create / read ----------

export async function createStory(db: D1Like, input: { section?: Section } = {}, deps?: Partial<Deps>): Promise<Story> {
  const d = withDeps(deps);
  const id = d.newId();
  const now = iso(d.now());
  const doc = serializeDocument(emptyStoryDocument());
  await db
    .prepare(
      `INSERT INTO stories (id, section, status, draft_doc, draft_rev, draft_updated_at, created_at)
       VALUES (?, ?, 'draft', ?, 1, ?, ?)`,
    )
    .bind(id, input.section ?? 'observe', doc, now, now)
    .run();
  const story = await getStory(db, id);
  if (!story) throw new Error('Story vanished after insert.');
  return story;
}

export async function getStory(db: D1Like, id: string): Promise<Story | null> {
  const row = await db.prepare(SELECT_ROW).bind(id).first<StoryRow>();
  return row ? toStory(row) : null;
}

export async function listStories(db: D1Like, filter: { status?: Status } = {}): Promise<StorySummary[]> {
  const where = filter.status ? 'WHERE status = ?' : '';
  const stmt = db.prepare(
    `SELECT id, section, slug, status,
            COALESCE(json_extract(draft_doc, '$.title'), '') AS title,
            draft_rev, draft_updated_at, published_at,
            (pub_doc IS NOT NULL AND pub_doc <> draft_doc) AS unpublished
       FROM stories ${where}
      ORDER BY draft_updated_at DESC, id`,
  );
  const { results } = await (filter.status ? stmt.bind(filter.status) : stmt).all<{
    id: string; section: string; slug: string | null; status: string; title: string;
    draft_rev: number; draft_updated_at: string; published_at: string | null; unpublished: number;
  }>();
  return results.map((r) => ({
    id: r.id,
    section: isSection(r.section) ? r.section : 'observe',
    slug: r.slug,
    status: r.status === 'published' ? 'published' : 'draft',
    title: r.title,
    draftRev: r.draft_rev,
    draftUpdatedAt: r.draft_updated_at,
    publishedAt: r.published_at,
    hasUnpublishedChanges: !!r.unpublished,
  }));
}

function toPublished(row: StoryRow): PublishedStory | null {
  if (row.status !== 'published' || !row.pub_doc || !row.slug || !row.published_at || !row.pub_updated_at) return null;
  const parsed = parseStoredDocument(row.pub_doc);
  if (!parsed.ok) throw new CorruptDocumentError(row.id, parsed.issues);
  return {
    id: row.id,
    section: isSection(row.section) ? row.section : 'observe',
    slug: row.slug,
    publishedAt: row.published_at,
    pubUpdatedAt: row.pub_updated_at,
    document: parsed.value,
  };
}

/** The published snapshot of one story (never the working draft). */
export async function getPublishedStory(db: D1Like, id: string): Promise<PublishedStory | null> {
  const row = await db.prepare(SELECT_ROW).bind(id).first<StoryRow>();
  return row ? toPublished(row) : null;
}

/** Every published snapshot, oldest first. This is what the static build consumes. */
export async function listPublishedStories(db: D1Like): Promise<PublishedStory[]> {
  const { results } = await db
    .prepare(
      `SELECT id, section, slug, status, draft_doc, draft_rev, draft_updated_at, pub_doc, published_at, pub_updated_at, created_at
         FROM stories WHERE status = 'published' ORDER BY published_at ASC, id`,
    )
    .all<StoryRow>();
  return results.map(toPublished).filter((s): s is PublishedStory => s !== null);
}

// ---------- autosave ----------

export type SaveResult =
  | { ok: true; draftRev: number; draftUpdatedAt: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; currentRev: number }
  | { ok: false; reason: 'invalid'; issues: Issue[] }
  | { ok: false; reason: 'slug_taken' }
  | { ok: false; reason: 'locked'; field: 'slug' | 'section' };

export interface SaveInput {
  /** the draft_rev the editor last received; the save only applies if it is still current */
  baseRev: number;
  /** untrusted client JSON; validated and normalized here */
  document: unknown;
  section?: Section;
  /** omit = unchanged; null/'' = clear (unpublished stories only) */
  slug?: string | null;
}

export async function saveDraft(db: D1Like, id: string, input: SaveInput, deps?: Partial<Deps>): Promise<SaveResult> {
  const d = withDeps(deps);

  const parsed = parseStoryDocument(input.document);
  if (!parsed.ok) return { ok: false, reason: 'invalid', issues: parsed.issues };

  const row = await db.prepare(SELECT_ROW).bind(id).first<StoryRow>();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.draft_rev !== input.baseRev) return { ok: false, reason: 'conflict', currentRev: row.draft_rev };

  const section = input.section ?? (isSection(row.section) ? row.section : 'observe');
  const requestedSlug = input.slug === undefined ? row.slug : input.slug === '' ? null : input.slug;
  const published = row.status === 'published';

  if (published && section !== row.section) return { ok: false, reason: 'locked', field: 'section' };
  if (published && requestedSlug !== row.slug) return { ok: false, reason: 'locked', field: 'slug' };
  if (requestedSlug !== null) {
    if (!isValidSlug(requestedSlug)) {
      return { ok: false, reason: 'invalid', issues: [{ path: 'slug', message: 'Use 3–80 lowercase letters, numbers and single hyphens.' }] };
    }
    if (requestedSlug !== row.slug && d.isSlugReserved(requestedSlug)) return { ok: false, reason: 'slug_taken' };
  }

  const now = iso(d.now());
  let changes = 0;
  try {
    const r = await db
      .prepare(
        // draft_rev in the WHERE clause makes check-and-write atomic: a concurrent save loses.
        `UPDATE stories SET draft_doc = ?, draft_rev = draft_rev + 1, draft_updated_at = ?, section = ?, slug = ?
          WHERE id = ? AND draft_rev = ?`,
      )
      .bind(serializeDocument(parsed.value), now, section, requestedSlug, id, input.baseRev)
      .run();
    changes = r.meta.changes ?? 0;
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: 'slug_taken' };
    throw e;
  }

  if (changes === 1) return { ok: true, draftRev: input.baseRev + 1, draftUpdatedAt: now };

  // lost a race (or it was deleted) between the read and the write
  const again = await db.prepare('SELECT draft_rev FROM stories WHERE id = ?').bind(id).first<{ draft_rev: number }>();
  return again ? { ok: false, reason: 'conflict', currentRev: again.draft_rev } : { ok: false, reason: 'not_found' };
}

// ---------- publish ----------

export type PublishResult =
  | { ok: true; story: Story }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; currentRev: number }
  | { ok: false; reason: 'invalid'; issues: Issue[] }
  | { ok: false; reason: 'slug_taken' }
  | { ok: false; reason: 'locked'; field: 'slug' };

export interface PublishInput {
  /** the draft_rev being published: you publish exactly what you last saw */
  baseRev: number;
  /** YYYY-MM-DD; defaults to the existing date, else today (UTC) */
  publishedAt?: string;
  /** used only for a first publish; otherwise derived from the title */
  slug?: string;
}

export async function publishStory(db: D1Like, id: string, input: PublishInput, deps?: Partial<Deps>): Promise<PublishResult> {
  const d = withDeps(deps);
  const row = await db.prepare(SELECT_ROW).bind(id).first<StoryRow>();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.draft_rev !== input.baseRev) return { ok: false, reason: 'conflict', currentRev: row.draft_rev };

  const parsed = parseStoredDocument(row.draft_doc);
  if (!parsed.ok) throw new CorruptDocumentError(id, parsed.issues);
  const doc = parsed.value;

  const issues = publishIssues(doc);

  // referenced photographs must exist
  const ids = referencedImageIds(doc);
  if (ids.length > 0) {
    const marks = ids.map(() => '?').join(',');
    const { results } = await db.prepare(`SELECT id FROM images WHERE id IN (${marks})`).bind(...ids).all<{ id: string }>();
    const found = new Set(results.map((r) => r.id));
    for (const missing of ids.filter((i) => !found.has(i))) issues.push({ path: 'images', message: `Image ${missing} does not exist.` });
  }

  const alreadyPublished = row.status === 'published';
  let slug = row.slug;
  if (alreadyPublished) {
    if (input.slug !== undefined && input.slug !== row.slug) return { ok: false, reason: 'locked', field: 'slug' };
  } else {
    slug = input.slug ?? row.slug;
    if (slug === null || slug === '') {
      slug = await uniqueSlug(slugify(doc.title || 'story'), async (s) => d.isSlugReserved(s) || (await slugExists(db, s)));
    } else if (!isValidSlug(slug)) {
      issues.push({ path: 'slug', message: 'Use 3–80 lowercase letters, numbers and single hyphens.' });
    } else if (slug !== row.slug && d.isSlugReserved(slug)) {
      return { ok: false, reason: 'slug_taken' };
    }
  }

  const today = iso(d.now()).slice(0, 10);
  const publishedAt = input.publishedAt ?? row.published_at ?? today;
  if (!isRealDate(publishedAt)) issues.push({ path: 'publishedAt', message: 'Use a real date as YYYY-MM-DD.' });

  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };

  let changes = 0;
  try {
    const r = await db
      .prepare(
        `UPDATE stories
            SET slug = ?, status = 'published', pub_doc = draft_doc, published_at = ?, pub_updated_at = ?
          WHERE id = ? AND draft_rev = ?`,
      )
      .bind(slug, publishedAt, iso(d.now()), id, input.baseRev)
      .run();
    changes = r.meta.changes ?? 0;
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: 'slug_taken' };
    throw e;
  }
  if (changes !== 1) {
    const again = await db.prepare('SELECT draft_rev FROM stories WHERE id = ?').bind(id).first<{ draft_rev: number }>();
    return again ? { ok: false, reason: 'conflict', currentRev: again.draft_rev } : { ok: false, reason: 'not_found' };
  }
  const story = await getStory(db, id);
  if (!story) return { ok: false, reason: 'not_found' };
  return { ok: true, story };
}

async function slugExists(db: D1Like, slug: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS x FROM stories WHERE slug = ?').bind(slug).first()) !== null;
}

// ---------- delete ----------

export type DeleteResult = { ok: true } | { ok: false; reason: 'not_found' };

/**
 * Deletes a story and its published snapshot. Deleting removes it from the CMS
 * and (after a rebuild) from the public site; the row and its pub_doc are gone
 * and cannot be restored. Used by the dashboard Delete action.
 */
export async function deleteDraft(db: D1Like, id: string): Promise<DeleteResult> {
  const r = await db.prepare(`DELETE FROM stories WHERE id = ?`).bind(id).run();
  if ((r.meta.changes ?? 0) === 1) return { ok: true };
  return { ok: false, reason: 'not_found' };
}

// ---------- images (rows only; upload lives in a later phase) ----------

export interface ImageRecord {
  id: string;
  r2Original: string;
  variants: unknown[];
  width: number;
  height: number;
  bytes: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  sha256: string;
  filename: string;
}

export interface ImageExportMeta {
  r2Original: string;
  mime: string;
  filename: string;
}

/** The R2 key + mime an image needs to be re-served from elsewhere (e.g. exported for GitHub Pages). */
export async function getImageExportMeta(db: D1Like, id: string): Promise<ImageExportMeta | null> {
  const row = await db
    .prepare('SELECT r2_original, mime, filename FROM images WHERE id = ?')
    .bind(id)
    .first<{ r2_original: string; mime: string; filename: string }>();
  return row ? { r2Original: row.r2_original, mime: row.mime, filename: row.filename } : null;
}

export async function insertImage(db: D1Like, img: Omit<ImageRecord, 'id'> & { id?: string }, deps?: Partial<Deps>): Promise<string> {
  const d = withDeps(deps);
  const id = img.id ?? d.newId();
  await db
    .prepare(
      `INSERT INTO images (id, r2_original, variants, width, height, bytes, mime, sha256, filename, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, img.r2Original, JSON.stringify(img.variants), img.width, img.height, img.bytes, img.mime, img.sha256, img.filename, iso(d.now()))
    .run();
  return id;
}
