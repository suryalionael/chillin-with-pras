// Pages build verification for the deploy-pages workflow.
// Checks the base-prefixed output (dist/client/<pages base>) that GitHub Pages
// will serve: legacy routes, committed-snapshot CMS routes (when present),
// exported media consistency, and absence of secrets/draft data.
//
//   node scripts/verify-pages.mjs [dist] [snapshot]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = '/chillin-with-pras';
const dist = process.argv[2] ?? join('dist', 'client', BASE.slice(1));
const fixture = process.argv[3] ?? '.cms/snapshot.json';

let problems = 0;
const report = (ok, label, detail = '') => {
  if (!ok) problems++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

// ---------- structure ----------
report(existsSync(join(dist, 'index.html')), `homepage at ${dist}/index.html`);
report(existsSync(join(dist, '_astro')), 'asset directory (_astro) present');

// ---------- legacy routes ----------
const site = JSON.parse(readFileSync('src/data/site.json', 'utf8'));
report(site.articles.length === 35, 'legacy article count unchanged', String(site.articles.length));
for (const a of site.articles.slice(0, 5)) {
  report(existsSync(join(dist, a.path.slice(1), 'index.html')), `legacy route ${a.path} exists`);
}
report(existsSync(join(dist, 'to-observe-and-report', 'index.html')), 'observe archive exists');
report(existsSync(join(dist, 'to-show-and-tell', 'index.html')), 'show archive exists');

// ---------- base-prefixed links ----------
const home = read(join(dist, 'index.html')) ?? '';
report(home.includes(`${BASE}/to-observe-and-report/`), 'homepage nav link is base-prefixed');
report(/src="\/chillin-with-pras\/_astro\//.test(home), 'homepage asset URL is base-prefixed');
const theWall = read(join(dist, 'to-observe-and-report', 'the-wall', 'index.html'));
report(!!theWall, 'the-wall article readable');
if (theWall) {
  report(theWall.includes('href="/chillin-with-pras/'), 'article internal links base-prefixed');
}

// ---------- CMS snapshot routes used by Pages ----------
if (existsSync(fixture)) {
  const snap = JSON.parse(readFileSync(fixture, 'utf8'));
  const sections = { observe: 'to-observe-and-report', show: 'to-show-and-tell' };
  for (const story of snap.stories ?? []) {
    const page = join(dist, sections[story.section], story.slug, 'index.html');
    report(existsSync(page), `CMS route ${story.section}/${story.slug} built from snapshot`);
    const html = read(page) ?? '';
    report(html.includes(story.document.title), `CMS title renders for ${story.slug}`);
  }
} else {
  console.log('[INFO] no committed snapshot — Pages built legacy-only (a CMS snapshot is written by npm run cms:publish-pages).');
}

// ---------- media manifest consistency ----------
const manifestPath = '.cms/media-manifest.json';
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [id, file] of Object.entries(manifest)) {
    report(existsSync(join('.cms', 'media', file)), `manifest media file exists for ${id}`, file);
    report(existsSync(join(dist, 'cms-media', file)), `media copied into build for ${id}`, `cms-media/${file}`);
  }
}

// ---------- secrets / drafts ----------
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}
const forbidden = ['CLOUDFLARE_API_TOKEN', 'CMS_PIPELINE_TOKEN=', 'CMS_DEPLOY_TRIGGER_TOKEN=', 'dev-pipeline-token', 'DRAFT_LEAK_MARKER'];
for (const f of walk(dist)) {
  const content = read(f) ?? '';
  for (const t of forbidden) {
    if (content.includes(t)) { problems++; console.log(`[FAIL] ${t} leaked in ${f}`); }
  }
}
report(!JSON.stringify(site).includes('draft_doc'), 'legacy source contains no draft_doc');
if (existsSync(fixture)) report(!readFileSync(fixture, 'utf8').includes('draft_doc'), 'published snapshot contains no draft_doc');

console.log(problems ? `\n${problems} problem(s)` : '\nAll Pages verification checks passed');
process.exit(problems ? 1 : 0);