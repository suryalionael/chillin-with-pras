// Development-only helper: publish the locally written CMS content into the
// committed Pages snapshot + media the GitHub Pages build consumes.
//
//   npm run cms:publish-pages        (requires `npm run dev` running for images)
//
// What it does
//   1. Reads published (pub_doc) stories straight from the local D1 SQLite
//      state file — the same source the local build already uses. No server.
//   2. Writes `.cms/snapshot.json` in the exact shape build-content.ts reads.
//   3. For every image a published story references, fetches the bytes from the
//      running local dev server (the proven `/images/{id}` path) and copies
//      them into `.cms/media/{id}.{ext}`.
//   4. Writes `.cms/media-manifest.json` mapping imageId -> `{id}.{ext}` so the
//      Pages build resolves CMS images to static media instead of `/images/{id}`.
//   5. Validates the written snapshot by feeding it through the same parser the
//      Astro build uses.
//
// It never touches Cloudflare, never writes production data, and the CMS model
// stays untouched (the Article still carries imageId; only the URL resolution
// changes). After running, commit `.cms/` together with the new articles on
// main, and the deploy-pages workflow builds the site.
import { createClient } from '@libsql/client';
import { globSync } from 'glob';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const DEV_ORIGIN = process.env.CMS_DEV_ORIGIN || 'http://localhost:4321';

// find the local D1 sqlite file (mirrors build-content.ts)
function findLocalDbPath() {
  const files = globSync('.wrangler/state/**/d1/*/*.sqlite', { absolute: true });
  return files.find((f) => !f.endsWith('metadata.sqlite') && !f.endsWith('*.sqlite')) || null;
}

const dbPath = findLocalDbPath();
if (!dbPath) {
  console.error('No local D1 database found. Run `npm run db:migrate:local` first.');
  process.exit(1);
}

const db = createClient({ url: `file:${dbPath}` });

async function publishedRows() {
  const result = await db.execute(`
    SELECT id, section, slug, pub_doc, published_at, pub_updated_at
    FROM stories WHERE status = 'published'
    ORDER BY published_at ASC, id
  `);
  return result.rows;
}

function imageIdsIn(doc) {
  const ids = new Set();
  if (doc.featuredImageId) ids.add(doc.featuredImageId);
  for (const b of doc.body?.content ?? []) if (b.type === 'image') ids.add(b.attrs.imageId);
  return [...ids];
}

async function fetchImage(id) {
  const res = await fetch(`${DEV_ORIGIN}/images/${id}/`);
  if (res.status === 404) throw new Error(`image ${id} is missing locally — ensure the dev server is running (npm run dev)`);
  if (!res.ok) throw new Error(`image ${id} fetch failed (${res.status})`);
  const type = res.headers.get('content-type') || '';
  const mime = type.split(';')[0].trim();
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] || 'bin';
  const buf = Buffer.from(await res.arrayBuffer());
  return { ext, buf };
}

// ---------- 1. snapshot ----------
const rows = await publishedRows();
const stories = rows.map((r) => {
  const doc = JSON.parse(r.pub_doc);
  return {
    id: r.id, section: r.section, slug: r.slug,
    publishedAt: r.published_at, pubUpdatedAt: r.pub_updated_at,
    document: doc,
  };
});

const meta = await db.execute(`SELECT v FROM deploy_meta WHERE k='revision'`);
const revision = (meta.rows[0]?.v ?? 0);

const snapshot = {
  revision,
  generatedAt: new Date().toISOString(),
  stories,
};

// ---------- 2. media ----------
mkdirSync('.cms/media', { recursive: true });
const manifest = {};
let mediaCount = 0;
for (const s of stories) {
  for (const id of imageIdsIn(s.document)) {
    if (manifest[id]) continue;
    const { ext, buf } = await fetchImage(id);
    writeFileSync(join('.cms/media', `${id}.${ext}`), buf);
    manifest[id] = `${id}.${ext}`;
    mediaCount++;
  }
}
writeFileSync('.cms/media-manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// ---------- 3. validate through the real build parser ----------
// Import build-content's snapshot reader to prove the file the Pages workflow
// will use actually parses.
const { fetchPublishedCmsStoriesFromSnapshotFile } = await import('../src/lib/cms/build-content.ts');
writeFileSync('.cms/snapshot.json', JSON.stringify(snapshot, null, 2) + '\n');
const parsed = fetchPublishedCmsStoriesFromSnapshotFile('.cms/snapshot.json');
if (parsed.length !== stories.length) throw new Error('snapshot validation mismatch');

console.log(`Published CMS snapshot written: revision ${revision}, ${stories.length} story(ies), ${mediaCount} image(s).`);
console.log(`  .cms/snapshot.json        — the Pages build reads this`);
console.log(`  .cms/media-manifest.json  — resolves CMS imageIds to static media`);
console.log(`  .cms/media/               — exported image bytes`);
console.log('');
console.log('Next: commit .cms/ together with the article changes on main, then the');
console.log('GitHub Pages workflow rebuilds the site from this snapshot.');
await db.close();