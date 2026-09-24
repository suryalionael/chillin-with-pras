import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db.ts';
import {
  createStory, deleteDraft, getPublishedStory, getStory, insertImage, listPublishedStories, listStories,
  publishStory, saveDraft, type D1Like, type Deps,
} from './db.ts';
import { isValidSlug, slugify, uniqueSlug } from './slug.ts';
import { emptyStoryDocument } from './schema.ts';

const IMG_MISSING = '99999999-9999-4999-8999-999999999999';
let tick = 0;
const clock = (): Deps['now'] => () => new Date(Date.UTC(2026, 8, 20, 12, 0, tick++)); // strictly increasing
const legacy = new Set(['the-wall', 'desert-life']);
const deps = (): Partial<Deps> => ({ now: clock(), isSlugReserved: (s) => legacy.has(s) });

const content = (title: string, text = 'Hello world.', extra: unknown[] = []) => ({
  ...emptyStoryDocument(), title,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...extra] },
});
const fresh = () => createTestDb();
async function draft(db: D1Like, title = 'My Story') {
  const s = await createStory(db, {}, deps());
  const r = await saveDraft(db, s.id, { baseRev: s.draftRev, document: content(title) }, deps());
  assert.equal(r.ok, true);
  return { id: s.id, rev: r.ok ? r.draftRev : -1 };
}

test('createStory makes an empty draft at revision 1', async () => {
  const db = fresh();
  const s = await createStory(db, { section: 'show' }, deps());
  assert.deepEqual([s.status, s.section, s.draftRev, s.slug, s.publishedAt, s.hasUnpublishedChanges], ['draft', 'show', 1, null, null, false]);
  assert.deepEqual(s.draft, emptyStoryDocument());
});

test('saveDraft increments the revision and stores the normalized document', async () => {
  const db = fresh();
  const s = await createStory(db, {}, deps());
  const a = await saveDraft(db, s.id, { baseRev: 1, document: content('One') }, deps());
  assert.deepEqual(a.ok && a.draftRev, 2);
  const b = await saveDraft(db, s.id, { baseRev: 2, document: content('Two') }, deps());
  assert.deepEqual(b.ok && b.draftRev, 3);
  const got = await getStory(db, s.id);
  assert.equal(got?.draft.title, 'Two');
  assert.equal(got?.draftRev, 3);
});

test('a stale tab gets 409-style conflict and cannot overwrite newer work', async () => {
  const db = fresh();
  const s = await createStory(db, {}, deps());
  await saveDraft(db, s.id, { baseRev: 1, document: content('Newer, from tab A') }, deps()); // rev 2
  const stale = await saveDraft(db, s.id, { baseRev: 1, document: content('Older, from tab B') }, deps());
  assert.deepEqual(stale, { ok: false, reason: 'conflict', currentRev: 2 });
  assert.equal((await getStory(db, s.id))?.draft.title, 'Newer, from tab A');
  assert.equal((await getStory(db, s.id))?.draftRev, 2);
});

test('two concurrent saves from the same revision: exactly one wins', async () => {
  const db = fresh();
  const s = await createStory(db, {}, deps());
  const [x, y] = await Promise.all([
    saveDraft(db, s.id, { baseRev: 1, document: content('X') }, deps()),
    saveDraft(db, s.id, { baseRev: 1, document: content('Y') }, deps()),
  ]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  assert.equal([x, y].filter((r) => !r.ok && r.reason === 'conflict').length, 1);
  assert.equal((await getStory(db, s.id))?.draftRev, 2);
});

test('the atomic UPDATE (not just the pre-read) rejects a stale revision', async () => {
  const db = fresh();
  const s = await createStory(db, {}, deps());
  // bump the revision behind the data layer's back between its read and write
  const real = db.prepare.bind(db);
  let armed = true;
  const racy: D1Like = {
    prepare(sql) {
      const st = real(sql);
      if (armed && sql.startsWith('UPDATE stories SET draft_doc')) {
        armed = false;
        db.exec(`UPDATE stories SET draft_rev = 5 WHERE id = '${s.id}'`);
      }
      return st;
    },
  };
  const r = await saveDraft(racy, s.id, { baseRev: 1, document: content('lost the race') }, deps());
  assert.deepEqual(r, { ok: false, reason: 'conflict', currentRev: 5 });
  assert.equal((await getStory(db, s.id))?.draft.title, '');
});

test('invalid documents are rejected and nothing is stored', async () => {
  const db = fresh();
  const s = await createStory(db, {}, deps());
  const bad = { ...content('x'), body: { type: 'doc', content: [{ type: 'script' }] } };
  const r = await saveDraft(db, s.id, { baseRev: 1, document: bad }, deps());
  assert.equal(!r.ok && r.reason, 'invalid');
  assert.equal((await getStory(db, s.id))?.draftRev, 1);
  const link = { ...content('x'), body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } };
  assert.equal((await saveDraft(db, s.id, { baseRev: 1, document: link }, deps())).ok, false);
});

test('saving a missing story is not_found', async () => {
  assert.deepEqual(await saveDraft(fresh(), 'nope', { baseRev: 1, document: content('x') }, deps()), { ok: false, reason: 'not_found' });
});

test('slug rules: format, uniqueness, legacy collisions, clearing', async () => {
  const db = fresh();
  const a = await createStory(db, {}, deps());
  const b = await createStory(db, {}, deps());
  const save = (id: string, rev: number, slug: string | null) => saveDraft(db, id, { baseRev: rev, document: content('t'), slug }, deps());
  for (const badSlug of ['ab', 'Has-Caps', 'has space', '-lead', 'trail-', 'dou--ble', 'x'.repeat(81), 'under_score']) {
    const r = await save(a.id, 1, badSlug);
    assert.equal(!r.ok && r.reason, 'invalid', badSlug);
  }
  assert.equal((await save(a.id, 1, 'my-first-story')).ok, true);
  assert.deepEqual(await save(b.id, 1, 'my-first-story'), { ok: false, reason: 'slug_taken' });
  assert.deepEqual(await save(b.id, 1, 'the-wall'), { ok: false, reason: 'slug_taken' }); // legacy slug
  const cleared = await save(a.id, 2, null);
  assert.equal(cleared.ok, true);
  assert.equal((await getStory(db, a.id))?.slug, null);
});

test('publish: validates, snapshots the draft, derives slug and date', async () => {
  const db = fresh();
  const { id, rev } = await draft(db, 'Fun Dining in the Big Apple');
  const empty = await createStory(db, {}, deps());
  const refused = await publishStory(db, empty.id, { baseRev: 1 }, deps());
  assert.equal(!refused.ok && refused.reason, 'invalid');

  const r = await publishStory(db, id, { baseRev: rev }, deps());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([r.story.status, r.story.slug, r.story.publishedAt, r.story.hasUnpublishedChanges], ['published', 'fun-dining-in-the-big-apple', '2026-09-20', false]);
  const pub = await getPublishedStory(db, id);
  assert.equal(pub?.document.title, 'Fun Dining in the Big Apple');
  assert.equal(pub?.slug, 'fun-dining-in-the-big-apple');
});

test('editing a published story never changes the public snapshot until republished', async () => {
  const db = fresh();
  const { id, rev } = await draft(db, 'Original');
  await publishStory(db, id, { baseRev: rev, slug: 'original-story' }, deps());
  const s1 = await getStory(db, id);
  const edit = await saveDraft(db, id, { baseRev: s1!.draftRev, document: content('Edited but not republished') }, deps());
  assert.equal(edit.ok, true);
  const s2 = await getStory(db, id);
  assert.equal(s2?.hasUnpublishedChanges, true);
  assert.equal(s2?.draft.title, 'Edited but not republished');
  assert.equal((await getPublishedStory(db, id))?.document.title, 'Original'); // public view unchanged
  assert.equal((await listPublishedStories(db))[0]?.document.title, 'Original');

  const re = await publishStory(db, id, { baseRev: s2!.draftRev }, deps());
  assert.equal(re.ok, true);
  assert.equal((await getPublishedStory(db, id))?.document.title, 'Edited but not republished');
  assert.equal((await getStory(db, id))?.hasUnpublishedChanges, false);
});

test('slug and section are locked once published', async () => {
  const db = fresh();
  const { id, rev } = await draft(db, 'Locked');
  await publishStory(db, id, { baseRev: rev, slug: 'locked-story' }, deps());
  const s = (await getStory(db, id))!;
  assert.deepEqual(await saveDraft(db, id, { baseRev: s.draftRev, document: content('Locked'), slug: 'other-slug' }, deps()), { ok: false, reason: 'locked', field: 'slug' });
  assert.deepEqual(await saveDraft(db, id, { baseRev: s.draftRev, document: content('Locked'), section: 'show' }, deps()), { ok: false, reason: 'locked', field: 'section' });
  assert.deepEqual(await publishStory(db, id, { baseRev: s.draftRev, slug: 'other-slug' }, deps()), { ok: false, reason: 'locked', field: 'slug' });
  assert.equal((await saveDraft(db, id, { baseRev: s.draftRev, document: content('Locked again'), slug: 'locked-story', section: s.section }, deps())).ok, true);
});

test('publishing a stale revision conflicts', async () => {
  const db = fresh();
  const { id, rev } = await draft(db, 'Race');
  await saveDraft(db, id, { baseRev: rev, document: content('Race, newer') }, deps());
  assert.deepEqual(await publishStory(db, id, { baseRev: rev }, deps()), { ok: false, reason: 'conflict', currentRev: rev + 1 });
  assert.equal((await getStory(db, id))?.status, 'draft');
});

test('auto slugs avoid database and legacy collisions', async () => {
  const db = fresh();
  const one = await draft(db, 'Desert Life'); // "desert-life" is a legacy slug
  const r1 = await publishStory(db, one.id, { baseRev: one.rev }, deps());
  assert.equal(r1.ok && r1.story.slug, 'desert-life-2');
  const two = await draft(db, 'Desert Life');
  const r2 = await publishStory(db, two.id, { baseRev: two.rev }, deps());
  assert.equal(r2.ok && r2.story.slug, 'desert-life-3');
  const three = await draft(db, 'Anything');
  assert.deepEqual(await publishStory(db, three.id, { baseRev: three.rev, slug: 'the-wall' }, deps()), { ok: false, reason: 'slug_taken' });
});

test('publish requires the referenced photographs to exist', async () => {
  const db = fresh();
  const s = await createStory(db, {}, deps());
  const withImg = (id: string) => content('Photos', 'text', [{ type: 'image', attrs: { imageId: id, alt: 'A photo' } }]);
  const r = await saveDraft(db, s.id, { baseRev: 1, document: withImg(IMG_MISSING) }, deps());
  assert.equal(r.ok, true);
  const refused = await publishStory(db, s.id, { baseRev: 2 }, deps());
  assert.equal(!refused.ok && refused.reason, 'invalid');

  const real = await insertImage(db, { r2Original: 'orig/a.jpg', variants: [], width: 4000, height: 3000, bytes: 1234, mime: 'image/jpeg', sha256: 'ab'.repeat(32), filename: 'a.jpg' }, deps());
  await saveDraft(db, s.id, { baseRev: 2, document: withImg(real) }, deps());
  assert.equal((await publishStory(db, s.id, { baseRev: 3 }, deps())).ok, true);
});

test('publishedAt: validated, defaulted, and editable on republish', async () => {
  const db = fresh();
  const { id, rev } = await draft(db, 'Dated');
  for (const bad of ['2026-13-01', '2026-02-30', 'yesterday', '20260920']) {
    const r = await publishStory(db, id, { baseRev: rev, publishedAt: bad }, deps());
    assert.equal(!r.ok && r.reason, 'invalid', bad);
  }
  const r = await publishStory(db, id, { baseRev: rev, publishedAt: '2017-08-01' }, deps());
  assert.equal(r.ok && r.story.publishedAt, '2017-08-01');
});

test('lists: filters, titles, unpublished flag, and only published snapshots for the build', async () => {
  const db = fresh();
  const a = await draft(db, 'Alpha');
  const b = await draft(db, 'Beta');
  await publishStory(db, b.id, { baseRev: b.rev, publishedAt: '2026-01-01' }, deps());
  await saveDraft(db, b.id, { baseRev: b.rev, document: content('Beta v2') }, deps());
  const all = await listStories(db);
  assert.equal(all.length, 2);
  const drafts = await listStories(db, { status: 'draft' });
  assert.deepEqual(drafts.map((s) => s.title), ['Alpha']);
  const published = await listStories(db, { status: 'published' });
  assert.deepEqual(published.map((s) => [s.title, s.hasUnpublishedChanges]), [['Beta v2', true]]);
  assert.equal((await listPublishedStories(db)).length, 1);
  assert.equal(await getPublishedStory(db, a.id), null);
});

test('deleteDraft removes draft and published stories', async () => {
  const db = fresh();
  const a = await draft(db, 'Gone');
  const b = await draft(db, 'Stays');
  await publishStory(db, b.id, { baseRev: b.rev }, deps());
  assert.deepEqual(await deleteDraft(db, a.id), { ok: true });
  assert.deepEqual(await deleteDraft(db, a.id), { ok: false, reason: 'not_found' });
  assert.deepEqual(await deleteDraft(db, b.id), { ok: true }, 'a published story can be deleted');
  assert.equal(await getStory(db, b.id), null);
});

test('database constraints hold even if application code is bypassed', async () => {
  const db = fresh();
  const ins = (cols: string, vals: string) => db.exec(`INSERT INTO stories (${cols}) VALUES (${vals})`);
  const base = `'x','observe','{}',1,'t','t'`;
  const cols = 'id, section, draft_doc, draft_rev, draft_updated_at, created_at';
  assert.throws(() => ins(cols.replace('section', 'section'), `'a','bogus','{}',1,'t','t'`), /CHECK/);
  assert.throws(() => ins(`${cols}, slug`, `${base}, 'Bad Slug'`), /CHECK/);
  assert.throws(() => ins(`${cols}, slug`, `${base}, '-x-'`), /CHECK/);
  assert.throws(() => ins(`${cols}, status`, `${base}, 'published'`), /CHECK/); // published without snapshot
  assert.throws(() => ins(`${cols}, status`, `${base}, 'weird'`), /CHECK/);
  assert.throws(() => ins(cols, `'y','observe','{}',0,'t','t'`), /CHECK/);
  ins(cols, base);
  assert.throws(() => ins(cols, base), /UNIQUE|PRIMARY/);
  assert.throws(() => db.exec(`INSERT INTO images (id, r2_original, width, height, bytes, mime, sha256, filename, created_at) VALUES ('i','k',10,10,1,'image/tiff','h','f','t')`), /CHECK/);
  db.exec(`INSERT INTO images (id, r2_original, width, height, bytes, mime, sha256, filename, created_at) VALUES ('i','k',10,10,1,'image/gif','h','f','t')`);
});

test('slug helpers', async () => {
  assert.equal(slugify('Fun Dining in the Big Apple!'), 'fun-dining-in-the-big-apple');
  assert.equal(slugify('  Café Münster — Pras’s "best"  '), 'cafe-munster-prass-best');
  assert.equal(slugify('日本語'), 'story');
  assert.equal(slugify('A'), 'a-story');
  assert.equal(slugify('x'.repeat(200)).length, 80);
  assert.equal(isValidSlug(slugify('Whatever   -- Title??')), true);
  assert.equal(isValidSlug(undefined), false);
  const taken = new Set(['a-story', 'a-story-2']);
  assert.equal(await uniqueSlug('a-story', (s) => taken.has(s)), 'a-story-3');
});
