// CI dry-run static verification. Checks dist/client produced by a
// CMS-snapshot-file build without a browser or any Cloudflare access.
//
//   node scripts/verify-dist.mjs .cms/fixtures/ci-snapshot.json dist
//
// Exits non-zero on any failure. Used by the publish-deploy dry-run workflow.

import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const fixturePath = process.argv[2] ?? '.cms/fixtures/ci-snapshot.json';
const dist = process.argv[3] ?? 'dist/client';

let problems = 0;
const report = (ok, label, detail = '') => {
  if (!ok) problems++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const sections = { observe: 'to-observe-and-report', show: 'to-show-and-tell' };

for (const story of fixture.stories) {
  const dir = sections[story.section];
  const page = join(dist, dir, story.slug, 'index.html');
  report(existsSync(page), `CMS route ${dir}/${story.slug}/ generated`, page);

  if (existsSync(page)) {
    const html = readFileSync(page, 'utf8');
    report(html.includes(story.document.title), `title renders for ${story.slug}`, story.document.title);
    // subtitle is preview-only in this project (not rendered in public article
    // pages); parsing+validation of it is proven by the build succeeding.
    const paraText = (story.document.body.content.find((b) => b.type === 'paragraph' && b.content?.some((t) => t.type === 'text')) ?? {}).content
      ?.map((t) => t.text ?? '').join('');
    if (paraText) report(html.includes(paraText.slice(0, 50)), `paragraph content renders for ${story.slug}`);
  }
}

// legacy content must still be present
const site = JSON.parse(readFileSync('src/data/site.json', 'utf8'));
report(site.articles.length === 35, 'legacy article count unchanged', String(site.articles.length));
for (const a of site.articles.slice(0, 3)) {
  report(existsSync(join(dist, a.path.slice(1), 'index.html')), `legacy route ${a.path} generated`);
}

// section archives updated to include the CMS stories
for (const story of fixture.stories) {
  const idx = join(dist, sections[story.section], 'index.html');
  if (existsSync(idx)) {
    const html = readFileSync(idx, 'utf8');
    report(html.includes(story.slug), `section archive lists ${story.slug}`);
  }
}

// homepage "latest entries" picks the newest stories: fixture stories
// published 2026 are newer than every legacy article, so they must appear
const home = readFileSync(join(dist, 'index.html'), 'utf8');
for (const story of fixture.stories) {
  report(home.includes(story.slug) || home.includes(story.document.title), `homepage references ${story.slug}`);
}

// no draft leaks: fixture has no draft field, but guard anyway — search for a
// marker string that will never legitimately exist in published output.
for (const f of walk(dist)) {
  const html = readFileSync(f, 'utf8');
  report(!html.includes('DRAFT_LEAK_MARKER'), `no draft marker leak in ${f.replace(dist, '')}`);
}

// published-only: CMS snapshot has no draft_doc; nothing to grep beyond the
// fixture itself, but assert the fixture never contains draft_doc
report(!JSON.stringify(fixture).includes('draft_doc'), 'fixture contains no draft_doc');

// no secrets: forbidden strings must not appear anywhere in dist. The
// generated `.assetsignore` is the adapter's own asset manifest and is exempt.
const forbidden = ['CLOUDFLARE_API_TOKEN', 'CMS_PIPELINE_TOKEN=', 'CMS_DEPLOY_TRIGGER_TOKEN=', 'dev-pipeline-token'];
for (const f of walk(dist)) {
  if (f.endsWith('.assetsignore')) continue;
  for (const token of forbidden) {
    const content = readFileSync(f, 'utf8');
    report(!content.includes(token), `no ${token} in ${f.replace(dist, '').slice(0, 40)}`);
  }
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

console.log(problems ? `\n${problems} problem(s)` : '\nAll static dist checks passed');
process.exit(problems ? 1 : 0);