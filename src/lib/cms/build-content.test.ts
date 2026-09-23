// Build-time content source: reads published CMS stories from a local D1 file
// using libsql. Failure is loud by design — a missing DB or malformed snapshot
// must fail the build rather than silently drop content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPublishedCmsStories, fetchPublishedCmsStoriesFromSnapshotFile } from './build-content.ts';
import { createTestDb } from './test-db.ts';
import { createStory, publishStory, saveDraft, type Deps } from './db.ts';
import { emptyStoryDocument } from './schema.ts';
import { assembleArticles, legacyArticles, type RawSite } from '../content/article.ts';

let tick = 0;
const clock = (): Deps['now'] => () => new Date(Date.UTC(2026, 8, 20, 12, 0, tick++));
const deps = (): Partial<Deps> => ({ now: clock(), isSlugReserved: () => false });

const content = (title: string, text = 'Hello world.') => ({
  ...emptyStoryDocument(), title,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

/** A real file-backed SQLite database (what a local D1 state file looks like). */
function fileDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cms-build-content-'));
  const path = join(dir, 'state.sqlite');
  const db = createTestDb(path);
  return { db, path, dir };
}

/** Direct insert of a published row, bypassing the data layer, for corrupted-snapshot tests. */
function insertPublishedRow(db: ReturnType<typeof createTestDb>, id: string, slug: string, pubDoc: string) {
  db.exec(`INSERT INTO stories (id, section, draft_doc, draft_rev, draft_updated_at, status, slug, pub_doc, published_at, pub_updated_at, created_at)
           VALUES ('${id}', 'observe', '{}', 1, '2026-09-20T00:00:00.000Z', 'published', '${slug}', '${pubDoc.replace(/'/g, "''")}', '2026-09-20', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z')`);
}

test('build-content: a missing D1 database fails the build loudly', async () => {
  await assert.rejects(() => fetchPublishedCmsStories(null), /No local D1 database found/);
});

test('build-content: a database that cannot be read fails the build loudly', async () => {
  await assert.rejects(() => fetchPublishedCmsStories(join(tmpdir(), 'does-not-exist', 'x.sqlite')), /Could not read local D1/);
});

test('build-content: maps a published story to the PublishedStory model', async () => {
  const { db, path, dir } = fileDb();
  try {
    const s = await createStory(db, { section: 'show' }, deps());
    const r = await saveDraft(db, s.id, { baseRev: s.draftRev, document: content('A Quiet Afternoon') }, deps());
    assert.equal(r.ok, true);
    const pub = await publishStory(db, s.id, { baseRev: r.ok ? r.draftRev : -1, publishedAt: '2026-09-21' }, deps());
    assert.equal(pub.ok, true);

    const stories = await fetchPublishedCmsStories(path);
    assert.equal(stories.length, 1);
    assert.deepEqual(
      [stories[0]!.id, stories[0]!.section, stories[0]!.slug, stories[0]!.publishedAt, stories[0]!.document.title],
      [s.id, 'show', 'a-quiet-afternoon', '2026-09-21', 'A Quiet Afternoon'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: only published stories are returned, in publication order', async () => {
  const { db, path, dir } = fileDb();
  try {
    const a = await createStory(db, {}, deps());
    await saveDraft(db, a.id, { baseRev: a.draftRev, document: content('Alpha') }, deps());
    await publishStory(db, a.id, { baseRev: 2, publishedAt: '2026-03-01' }, deps());

    const b = await createStory(db, {}, deps());
    await saveDraft(db, b.id, { baseRev: b.draftRev, document: content('Beta') }, deps());
    await publishStory(db, b.id, { baseRev: 2, publishedAt: '2026-01-01' }, deps());

    const draft = await createStory(db, {}, deps());
    await saveDraft(db, draft.id, { baseRev: draft.draftRev, document: content('Never published') }, deps());

    const stories = await fetchPublishedCmsStories(path);
    assert.deepEqual(stories.map((s) => [s.document.title, s.publishedAt]), [
      ['Beta', '2026-01-01'],
      ['Alpha', '2026-03-01'],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: a corrupt pub_doc fails the build loudly', async () => {
  const { db, path, dir } = fileDb();
  try {
    insertPublishedRow(db, '11111111-1111-4111-8111-111111111111', 'bad-json', 'not json');
    await assert.rejects(() => fetchPublishedCmsStories(path), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: a snapshot missing required fields fails the build loudly', async () => {
  const { db, path, dir } = fileDb();
  try {
    insertPublishedRow(db, '22222222-2222-4222-8222-222222222222', 'empty-doc', '{}');
    await assert.rejects(() => fetchPublishedCmsStories(path), /missing title or body/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: e2e — publishing "A Quiet Afternoon" lands it as the 31st observe article', async () => {
  const site = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/site.json', import.meta.url)), 'utf8')) as RawSite;
  const { db, path, dir } = fileDb();
  try {
    const s = await createStory(db, {}, deps());
    await saveDraft(db, s.id, { baseRev: s.draftRev, document: content('A Quiet Afternoon', 'The afternoon was quiet.') }, deps());
    const pub = await publishStory(db, s.id, { baseRev: 2, publishedAt: '2026-09-21' }, deps());
    assert.equal(pub.ok, true);

    const stories = await fetchPublishedCmsStories(path);
    const all = assembleArticles(legacyArticles(site), stories);
    const article = all.find((a) => a.slug === 'a-quiet-afternoon');
    assert.ok(article, 'the published story must appear in the public article list');
    assert.deepEqual(
      [article.source, article.section, article.order, article.path, article.title],
      ['cms', 'observe', 31, '/to-observe-and-report/a-quiet-afternoon/', 'A Quiet Afternoon'],
    );
    const observeOrdered = all.filter((a) => a.section === 'observe').sort((a, b) => a.order - b.order);
    assert.equal(observeOrdered[observeOrdered.length - 1]!.order, 31);
    assert.ok(article.blocks.some((b) => b.type === 'p' && (b as { text: string }).text === 'The afternoon was quiet.'));
    assert.equal(new Set(all.map((a) => a.path)).size, all.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
// The snapshot-file build source mirrors what the deploy pipeline (CI) passes
// to `astro build` (CMS_SNAPSHOT_FILE). Same PublishedStory validation, from a
// JSON file instead of the local D1 SQLite.

const snapshotJson = (revision: number, stories: unknown[]) => JSON.stringify({ revision, generatedAt: '2026-09-20T00:00:00.000Z', stories });

const storyJson = (id: string, slug: string, title: string) => ({
  id,
  section: 'observe',
  slug,
  publishedAt: '2026-09-21',
  pubUpdatedAt: '2026-09-21T00:00:00.000Z',
  document: { version: 1, title, subtitle: '', dateline: '', featuredImageId: null, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Snapshot body.' }] }] } },
});

function snapshotFile() {
  const dir = mkdtempSync(join(tmpdir(), 'cms-snapshot-'));
  const path = join(dir, 'snapshot.json');
  return { dir, path };
}

test('build-content: snapshot file maps published stories to the PublishedStory model', () => {
  const { dir, path } = snapshotFile();
  try {
    writeFileSync(path, snapshotJson(7, [storyJson('00000000-0000-4000-8000-000000000001', 'from-snapshot', 'From Snapshot')]));
    const stories = fetchPublishedCmsStoriesFromSnapshotFile(path);
    assert.equal(stories.length, 1);
    assert.deepEqual([stories[0]!.slug, stories[0]!.document.title], ['from-snapshot', 'From Snapshot']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: snapshot file with a missing file fails loudly', () => {
  assert.throws(() => fetchPublishedCmsStoriesFromSnapshotFile(join(tmpdir(), 'nope', 'x.json')), /Could not read CMS snapshot file/);
});

test('build-content: snapshot file with invalid JSON fails loudly', () => {
  const { dir, path } = snapshotFile();
  try {
    writeFileSync(path, 'not json');
    assert.throws(() => fetchPublishedCmsStoriesFromSnapshotFile(path), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: snapshot file missing revision or stories fails loudly', () => {
  const { dir, path } = snapshotFile();
  try {
    writeFileSync(path, JSON.stringify({ generatedAt: 'now' }));
    assert.throws(() => fetchPublishedCmsStoriesFromSnapshotFile(path), /missing revision or stories/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: snapshot file with a malformed story fails loudly', () => {
  const { dir, path } = snapshotFile();
  try {
    writeFileSync(path, snapshotJson(1, [{ id: '00000000-0000-4000-8000-000000000001' }]));
    assert.throws(() => fetchPublishedCmsStoriesFromSnapshotFile(path), /malformed published story/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: snapshot file story missing title or body fails loudly', () => {
  const { dir, path } = snapshotFile();
  try {
    writeFileSync(path, snapshotJson(1, [{ ...storyJson('00000000-0000-4000-8000-000000000001', 'a', 'A'), document: {} }]));
    assert.throws(() => fetchPublishedCmsStoriesFromSnapshotFile(path), /missing title or body/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-content: snapshot file merges with legacy articles and builds routes', () => {
  const site = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/site.json', import.meta.url)), 'utf8')) as RawSite;
  const { dir, path } = snapshotFile();
  try {
    writeFileSync(path, snapshotJson(7, [storyJson('00000000-0000-4000-8000-000000000001', 'from-snapshot', 'From Snapshot')]));
    const stories = fetchPublishedCmsStoriesFromSnapshotFile(path);
    const all = assembleArticles(legacyArticles(site), stories);
    const article = all.find((a) => a.slug === 'from-snapshot');
    assert.ok(article, 'snapshot story must appear in the public article list');
    assert.deepEqual([article!.source, article!.section, article!.path], ['cms', 'observe', '/to-observe-and-report/from-snapshot/']);
    assert.equal(new Set(all.map((a) => a.path)).size, all.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
