// Deployment state machine tests for the CMS publish-to-deploy pipeline.
// Runs against the real migration + real SQLite, so the revision counter
// (UPDATE … RETURNING) and deployment transitions are exercised exactly as D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db.ts';
import {
  currentRevision,
  currentDeployment,
  listDeployments,
  markDeploymentStatus,
  nextRevision,
  requestDeployment,
  deploymentSummary,
  buildPublishedSnapshot,
  authorizeDeployToken,
  type D1Like,
  type DeployDeps,
} from './deploy.ts';
import { createStory, publishStory, saveDraft, type Deps } from './db.ts';
import { emptyStoryDocument } from './schema.ts';

const fresh = () => createTestDb();

let tick = 0;
const clock = (): DeployDeps['now'] => () => new Date(Date.UTC(2026, 9, 10, 8, 0, tick++));
const deployDeps = (): Partial<DeployDeps> => ({ now: clock() });

const content = (title: string, text = 'Hello world.') => ({
  ...emptyStoryDocument(), title,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

const dbDeps = (): Partial<Deps> => ({ now: clock(), isSlugReserved: () => false });

/** Publish a story and return its id + publishedAt (via the real data layer). */
async function publishOne(db: D1Like, title = 'Story', at = '2026-09-01'): Promise<{ id: string; publishedAt: string }> {
  const s = await createStory(db, { section: 'observe' }, dbDeps());
  const r = await saveDraft(db, s.id, { baseRev: s.draftRev, document: content(title) }, dbDeps());
  assert.equal(r.ok, true);
  const pub = await publishStory(db, s.id, { baseRev: (r as { draftRev: number }).draftRev, publishedAt: at }, dbDeps());
  assert.equal(pub.ok, true);
  const story = await (await import('./db.ts')).getStory(db, s.id);
  return { id: s.id, publishedAt: story!.pubUpdatedAt ?? '' };
}

// ---------- revision counter ----------

test('deploy: nextRevision increments atomically and starts at 1', async () => {
  const db = fresh();
  assert.equal(await currentRevision(db), 0);
  assert.equal(await nextRevision(db), 1);
  assert.equal(await nextRevision(db), 2);
  assert.equal(await currentRevision(db), 2);
});

// ---------- lifecycle ----------

test('deploy: requestDeployment creates a deploy_requested row', async () => {
  const db = fresh();
  const d = await requestDeployment(db, { revision: 1, storyId: 's1', publishedAt: '2026-09-01T00:00:00.000Z', payload: { slug: 'a', title: 'A' } }, deployDeps());
  assert.equal(d.status, 'deploy_requested');
  assert.equal(d.revision, 1);
  const rows = await listDeployments(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.status, rows[0]!.storyId, rows[0]!.payload], ['deploy_requested', 's1', { slug: 'a', title: 'A' }]);
});

test('deploy: full lifecycle requested → building → deployed', async () => {
  const db = fresh();
  const d = await requestDeployment(db, { revision: 1, storyId: 's1', publishedAt: '2026-09-01T00:00:00.000Z', payload: { slug: 'a', title: 'A' } }, deployDeps());
  await markDeploymentStatus(db, { revision: d.revision, status: 'building', buildId: 'run-1' }, deployDeps());
  const built = await currentDeployment(db);
  assert.equal(built, null, 'nothing deployed yet');

  await markDeploymentStatus(db, { revision: d.revision, status: 'deployed', buildId: 'run-1' }, deployDeps());
  const cur = await currentDeployment(db);
  assert.ok(cur);
  assert.equal(cur!.status, 'deployed');
  assert.equal(cur!.buildId, 'run-1');
  assert.ok(cur!.deployedAt);
});

test('deploy: a newer deployed revision supersedes older deployed rows', async () => {
  const db = fresh();
  const storyId = 's1';
  const a = await requestDeployment(db, { revision: 1, storyId, publishedAt: '2026-09-01', payload: { slug: 'a', title: 'A' } }, deployDeps());
  await markDeploymentStatus(db, { revision: a.revision, status: 'deployed', buildId: 'run-1' }, deployDeps());

  const b = await requestDeployment(db, { revision: 2, storyId, publishedAt: '2026-09-02', payload: { slug: 'b', title: 'B' } }, deployDeps());
  await markDeploymentStatus(db, { revision: b.revision, status: 'building', buildId: 'run-2' }, deployDeps());
  await markDeploymentStatus(db, { revision: b.revision, status: 'deployed', buildId: 'run-2' }, deployDeps());

  const cur = await currentDeployment(db);
  assert.ok(cur);
  assert.equal(cur!.revision, 2, 'newest deployed revision is current');

  const rows = await listDeployments(db);
  const older = rows.find((r) => r.revision === 1);
  assert.equal(older?.superseded, 1, 'older deployed row superseded');
});

test('deploy: an old build finishing late is recorded but never becomes current', async () => {
  const db = fresh();
  const storyId = 's1';
  const a = await requestDeployment(db, { revision: 1, storyId, publishedAt: '2026-09-01', payload: { slug: 'a', title: 'A' } }, deployDeps());
  const b = await requestDeployment(db, { revision: 2, storyId, publishedAt: '2026-09-02', payload: { slug: 'b', title: 'B' } }, deployDeps());

  // newer deploy lands first
  await markDeploymentStatus(db, { revision: b.revision, status: 'deployed', buildId: 'run-2' }, deployDeps());
  // the stale build A completes late
  await markDeploymentStatus(db, { revision: a.revision, status: 'deployed', buildId: 'run-1' }, deployDeps());

  const cur = await currentDeployment(db);
  assert.equal(cur?.revision, 2, 'stale build cannot become current');
  const rows = await listDeployments(db);
  assert.equal(rows.find((r) => r.revision === 1)?.superseded, 1);
});

test('deploy: failed deployment is recorded and does not become current', async () => {
  const db = fresh();
  const d = await requestDeployment(db, { revision: 1, storyId: 's1', publishedAt: '2026-09-01', payload: { slug: 'a', title: 'A' } }, deployDeps());
  await markDeploymentStatus(db, { revision: d.revision, status: 'failed', buildId: 'run-1', error: 'D1_ERROR: x' }, deployDeps());
  assert.equal(await currentDeployment(db), null);
  const rows = await listDeployments(db);
  assert.equal(rows[0]!.status, 'failed');
  assert.equal(rows[0]!.error, 'D1_ERROR: x');
});

test('deploy: status for an unknown revision is not_found', async () => {
  const db = fresh();
  const r = await markDeploymentStatus(db, { revision: 99, status: 'deployed', buildId: 'x' }, deployDeps());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'not_found');
});

// ---------- summary ----------

test('deploy: summary reflects behind=true when a newer publish is not deployed', async () => {
  const db = fresh();
  const storyId = 's1';
  await requestDeployment(db, { revision: 1, storyId, publishedAt: '2026-09-01', payload: { slug: 'a', title: 'A' } }, deployDeps());
  await markDeploymentStatus(db, { revision: 1, status: 'deployed', buildId: 'run-1' }, deployDeps());
  await requestDeployment(db, { revision: 2, storyId, publishedAt: '2026-09-02', payload: { slug: 'b', title: 'B' } }, deployDeps());

  const s = await deploymentSummary(db);
  assert.equal(s.current?.revision, 1);
  assert.equal(s.newestRequestedRevision, 2);
  assert.equal(s.behind, true);
  assert.equal(s.requestChainProgress, 'deploy_requested');
});

test('deploy: summary reports none when no deployments exist', async () => {
  const s = await deploymentSummary(fresh());
  assert.equal(s.current, null);
  assert.equal(s.newestRequestedRevision, null);
  assert.equal(s.behind, false);
  assert.equal(s.requestChainProgress, 'none');
});

test('deploy: summary latest is newest-first', async () => {
  const db = fresh();
  await requestDeployment(db, { revision: 1, storyId: 's', publishedAt: '2026-09-01', payload: { slug: 'a', title: 'A' } }, deployDeps());
  await requestDeployment(db, { revision: 2, storyId: 's', publishedAt: '2026-09-02', payload: { slug: 'b', title: 'B' } }, deployDeps());
  const s = await deploymentSummary(db);
  assert.ok(s.latest.length >= 2);
  assert.equal(s.latest[0]!.revision, 2);
  assert.equal(s.latest[1]!.revision, 1);
});

// ---------- snapshot ----------

test('deploy: snapshot contains only published stories with a revision', async () => {
  const db = fresh();
  await publishOne(db, 'Alpha', '2026-03-01');
  await publishOne(db, 'Beta', '2026-01-01');
  const draftS = await createStory(db, {}, dbDeps());
  await saveDraft(db, draftS.id, { baseRev: 1, document: content('Never published') }, dbDeps());

  const rev = await nextRevision(db); // allocate a revision like publish does
  await requestDeployment(db, { revision: rev, storyId: 'ignored', publishedAt: 'd', payload: { slug: 'x', title: 'x' } }, deployDeps());
  const snap = await buildPublishedSnapshot(db, deployDeps());
  assert.equal(snap.revision, rev);
  const titles = snap.stories.map((s) => s.document.title).sort();
  assert.deepEqual(titles, ['Alpha', 'Beta']);
});

test('deploy: snapshot failure is loud for a missing DB', async () => {
  // D1-like that throws on prepare — snapshot must fail loudly, not silently drop.
  const bad: D1Like = { prepare: () => { throw new Error('boom'); } };
  await assert.rejects(() => buildPublishedSnapshot(bad), /boom/);
});

// ---------- auth ----------

test('deploy: bearer token auth — configured accept/reject/fail-closed', async () => {
  const env = (t: string) => ({ CMS_PIPELINE_TOKEN: t });
  const req = (token?: string) => new Request('https://x/', { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.deepEqual(authorizeDeployToken(env('sekrit'), req('sekrit')), { ok: true });
  assert.equal(authorizeDeployToken(env('sekrit'), req('wrong')).ok, false);
  assert.equal(authorizeDeployToken(env('sekrit'), req()).ok, false);
  const noConfig = authorizeDeployToken(env(''), req('anything'));
  assert.equal(noConfig.ok, false);
  assert.equal(!noConfig.ok && noConfig.status, 503);
});

// ---------- publish integration via the real data layer ----------

test('deploy: publish → requestDeployment keeps the published snapshot intact', async () => {
  const db = fresh();
  const { id, publishedAt } = await publishOne(db, 'Keep me', '2026-09-05');
  const rev = await nextRevision(db);
  await requestDeployment(db, { revision: rev, storyId: id, publishedAt, payload: { slug: 'keep-me', title: 'Keep me' } }, deployDeps());
  // published content still readable
  const published = await (await import('./db.ts')).getPublishedStory(db, id);
  assert.ok(published);
  assert.equal(published!.document.title, 'Keep me');
});