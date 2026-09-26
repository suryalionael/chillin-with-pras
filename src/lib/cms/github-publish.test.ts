// publishSnapshotToGithub tests. Mocks fetch (GitHub's Contents API) and R2
// (image bytes) — the D1 side runs against a real SQLite instance like the
// rest of the CMS data-layer tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db.ts';
import { insertImage } from './db.ts';
import { publishSnapshotToGithub, type GithubPublishEnv } from './github-publish.ts';
import type { PublishedSnapshot } from './deploy.ts';

const REPO = 'someone/some-repo';
const BASE = `/repos/${REPO}/contents`;

function fakeMedia(bytesByKey: Record<string, Uint8Array>): GithubPublishEnv['MEDIA'] {
  return {
    async get(key: string) {
      const bytes = bytesByKey[key];
      if (!bytes) return null;
      return { async arrayBuffer() { return bytes.buffer as ArrayBuffer; } };
    },
  };
}

/** Routes each GitHub API call by method+path (query string ignored); missing routes fail loudly. */
function mockGithub(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const key = `${req.method} ${url.pathname}`;
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected GitHub call: ${key}`);
    return route(req);
  };
  return { fetchMock, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const contentFile = (obj: unknown, sha: string) =>
  json({ sha, content: Buffer.from(JSON.stringify(obj)).toString('base64') });

function snapshot(overrides: Partial<PublishedSnapshot> = {}): PublishedSnapshot {
  return { revision: 1, generatedAt: '2026-09-26T00:00:00.000Z', stories: [], ...overrides };
}

test('github-publish: not configured is reported as skipped, not an error', async () => {
  const db = createTestDb();
  const result = await publishSnapshotToGithub({ MEDIA: fakeMedia({}) } as GithubPublishEnv, db, snapshot());
  assert.equal(result.ok, false);
  assert.equal((result as { skipped: boolean }).skipped, true);
});

test('github-publish: happy path writes manifest + snapshot, no new images', async (t) => {
  const db = createTestDb();
  const { fetchMock, calls } = mockGithub({
    [`GET ${BASE}/.cms/media-manifest.json`]: () => contentFile({}, 'manifest-sha'),
    [`PUT ${BASE}/.cms/media-manifest.json`]: () => json({ commit: { sha: 'manifest-commit' } }),
    [`GET ${BASE}/.cms/snapshot.json`]: () => contentFile({ revision: 0, stories: [] }, 'snapshot-sha'),
    [`PUT ${BASE}/.cms/snapshot.json`]: () => json({ commit: { sha: 'snapshot-commit' } }),
  });
  t.mock.method(globalThis, 'fetch', fetchMock);

  const env: GithubPublishEnv = { GITHUB_TOKEN: 'tok', GITHUB_REPO: REPO, MEDIA: fakeMedia({}) };
  const result = await publishSnapshotToGithub(env, db, snapshot());

  assert.equal(result.ok, true);
  assert.equal((result as { commitSha: string }).commitSha, 'snapshot-commit');
  assert.deepEqual(calls, [
    `GET ${BASE}/.cms/media-manifest.json`,
    `PUT ${BASE}/.cms/media-manifest.json`,
    `GET ${BASE}/.cms/snapshot.json`,
    `PUT ${BASE}/.cms/snapshot.json`,
  ]);
});

test('github-publish: creates the manifest/snapshot fresh when neither exists yet', async (t) => {
  const db = createTestDb();
  const putBodies: Record<string, unknown> = {};
  const { fetchMock } = mockGithub({
    [`GET ${BASE}/.cms/media-manifest.json`]: () => new Response('not found', { status: 404 }),
    [`PUT ${BASE}/.cms/media-manifest.json`]: async (req) => {
      putBodies.manifest = await req.json();
      return json({ commit: { sha: 'manifest-commit' } });
    },
    [`GET ${BASE}/.cms/snapshot.json`]: () => new Response('not found', { status: 404 }),
    [`PUT ${BASE}/.cms/snapshot.json`]: async (req) => {
      putBodies.snapshot = await req.json();
      return json({ commit: { sha: 'snapshot-commit' } });
    },
  });
  t.mock.method(globalThis, 'fetch', fetchMock);

  const env: GithubPublishEnv = { GITHUB_TOKEN: 'tok', GITHUB_REPO: REPO, MEDIA: fakeMedia({}) };
  const result = await publishSnapshotToGithub(env, db, snapshot());

  assert.equal(result.ok, true);
  // no sha on either PUT — these are brand new files, not updates
  assert.equal('sha' in (putBodies.manifest as object), false);
  assert.equal('sha' in (putBodies.snapshot as object), false);
});

test('github-publish: uploads only images missing from the existing manifest, non-ASCII text survives', async (t) => {
  const db = createTestDb();
  const imgId = await insertImage(db, {
    r2Original: 'images/abc.jpg',
    variants: [],
    width: 10,
    height: 10,
    bytes: 3,
    mime: 'image/jpeg',
    sha256: 'x',
    filename: 'photo.jpg',
  });

  const putBodies: { path: string; body: { content: string; sha?: string } }[] = [];
  const { fetchMock } = mockGithub({
    [`GET ${BASE}/.cms/media-manifest.json`]: () => contentFile({ 'already-there': 'already-there.jpg' }, 'manifest-sha'),
    [`PUT ${BASE}/.cms/media/${imgId}.jpg`]: async (req) => {
      putBodies.push({ path: 'image', body: (await req.json()) as { content: string } });
      return json({ commit: { sha: 'image-commit' } });
    },
    [`PUT ${BASE}/.cms/media-manifest.json`]: async (req) => {
      putBodies.push({ path: 'manifest', body: (await req.json()) as { content: string; sha?: string } });
      return json({ commit: { sha: 'manifest-commit' } });
    },
    [`GET ${BASE}/.cms/snapshot.json`]: () => new Response('not found', { status: 404 }),
    [`PUT ${BASE}/.cms/snapshot.json`]: async (req) => {
      putBodies.push({ path: 'snapshot', body: (await req.json()) as { content: string } });
      return json({ commit: { sha: 'snapshot-commit' } });
    },
  });
  t.mock.method(globalThis, 'fetch', fetchMock);

  const env: GithubPublishEnv = {
    GITHUB_TOKEN: 'tok',
    GITHUB_REPO: REPO,
    MEDIA: fakeMedia({ 'images/abc.jpg': new Uint8Array([1, 2, 3]) }),
  };
  const doc = { ...emptyDoc('Café “Déjà Vu”'), featuredImageId: imgId };
  const result = await publishSnapshotToGithub(env, db, snapshot({ stories: [publishedStory(doc)] }));

  assert.equal(result.ok, true);
  const imageBody = putBodies.find((b) => b.path === 'image')!.body;
  assert.equal(Buffer.from(imageBody.content, 'base64').toString('hex'), Buffer.from([1, 2, 3]).toString('hex'));

  const manifestBody = putBodies.find((b) => b.path === 'manifest')!.body;
  const manifest = JSON.parse(Buffer.from(manifestBody.content, 'base64').toString('utf-8'));
  assert.equal(manifest[imgId], `${imgId}.jpg`);
  assert.equal(manifest['already-there'], 'already-there.jpg');

  // the whole point of textToBase64: unicode in story content must round-trip intact
  const snapshotBody = putBodies.find((b) => b.path === 'snapshot')!.body;
  const decoded = JSON.parse(Buffer.from(snapshotBody.content, 'base64').toString('utf-8'));
  assert.equal(decoded.stories[0].document.title, 'Café “Déjà Vu”');
});

test('github-publish: a failed GitHub call is reported, never thrown', async (t) => {
  const db = createTestDb();
  const { fetchMock } = mockGithub({
    [`GET ${BASE}/.cms/media-manifest.json`]: () => new Response('server error', { status: 500 }),
  });
  t.mock.method(globalThis, 'fetch', fetchMock);

  const env: GithubPublishEnv = { GITHUB_TOKEN: 'tok', GITHUB_REPO: REPO, MEDIA: fakeMedia({}) };
  const result = await publishSnapshotToGithub(env, db, snapshot());
  assert.equal(result.ok, false);
  assert.equal((result as { skipped: boolean }).skipped, false);
});

function emptyDoc(title = 'T') {
  return {
    version: 1 as const,
    title,
    subtitle: '',
    dateline: '',
    featuredImageId: null as string | null,
    body: { type: 'doc' as const, content: [] },
  };
}

function publishedStory(document: ReturnType<typeof emptyDoc>): PublishedSnapshot['stories'][number] {
  return {
    id: 'story-1',
    section: 'observe',
    slug: 'story-1',
    publishedAt: '2026-09-01',
    pubUpdatedAt: '2026-09-01T00:00:00.000Z',
    document: document as unknown as PublishedSnapshot['stories'][number]['document'],
  };
}
