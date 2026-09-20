import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assembleArticles, docToBlocks, formatDateline, legacyArticles, plainText, publishedToArticle, type ArticleBlock, type RawSite } from './article.ts';
import { parseStoryDocument, type StoryDocument } from '../cms/schema.ts';
import type { PublishedStory } from '../cms/db.ts';

const site = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/site.json', import.meta.url)), 'utf8')) as RawSite;

const IMG = '11111111-1111-4111-8111-111111111111';
const parse = (x: unknown): StoryDocument => {
  const r = parseStoryDocument(x);
  assert.equal(r.ok, true, JSON.stringify(!r.ok && r.issues));
  return (r as { value: StoryDocument }).value;
};
const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const story = (over: Partial<PublishedStory> = {}, content: unknown[] = [p('Hello')], docExtra: Record<string, unknown> = {}): PublishedStory => ({
  id: '00000000-0000-4000-8000-000000000001', section: 'observe', slug: 'my-new-story', publishedAt: '2026-09-20', pubUpdatedAt: '2026-09-20T10:00:00.000Z',
  document: parse({ version: 1, title: 'My New Story', subtitle: 'A subtitle', dateline: '', featuredImageId: null, body: { type: 'doc', content }, ...docExtra }), ...over,
});

test('legacy articles convert without changing any content', () => {
  const all = legacyArticles(site);
  assert.equal(all.length, 35);
  assert.equal(all.filter((a) => a.section === 'observe').length, 30);
  assert.equal(all.filter((a) => a.section === 'show').length, 5);
  site.articles.forEach((raw, i) => {
    const a = all[i]!;
    assert.deepEqual([a.path, a.slug, a.title, a.order, a.dateline, a.dateISO, a.source], [raw.path, raw.slug, raw.title, raw.order, raw.dateline ?? '', raw.dateISO ?? '', 'legacy']);
    assert.equal(a.blocks.length, raw.blocks.length);
    raw.blocks.forEach((rb, j) => {
      const b = a.blocks[j]!;
      if (rb.type === 'img') assert.deepEqual(b, { type: 'img', file: rb.file, alt: rb.alt ?? '' });
      else assert.deepEqual([b.type, (b as { text: string }).text, (b as { subhead?: boolean }).subhead === true], ['p', rb.text, rb.subhead === true]);
    });
  });
  // photographs: 215 image blocks across the site, exactly as before
  assert.equal(all.flatMap((a) => a.blocks).filter((b) => b.type === 'img').length, site.articles.flatMap((a) => a.blocks).filter((b) => b.type === 'img').length);
});

test('CMS document maps every supported concept to article blocks', () => {
  const doc = parse({
    version: 1, title: 't', subtitle: '', dateline: '', featuredImageId: null,
    body: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub' }] },
      p('mixed', [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://a.com' } }]),
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
      { type: 'paragraph' },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('one'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('nested')] }] }] }] },
      { type: 'blockquote', content: [p('quoted'), { type: 'paragraph' }] },
      { type: 'horizontalRule' },
      { type: 'image', attrs: { imageId: IMG, alt: 'alt', caption: 'cap', size: 'inset' } },
      { type: 'embed', attrs: { url: 'https://vimeo.com/1' } },
    ] },
  });
  const b = docToBlocks(doc);
  assert.deepEqual(b.map((x) => x.type + (x.type === 'p' && x.subhead ? ':subhead' : '')), ['p:subhead', 'subheading', 'p', 'p', 'list', 'quote', 'divider', 'img', 'embed']);
  assert.deepEqual((b[2] as { inline: unknown[] }).inline, [{ text: 'mixed', bold: true, italic: true, href: 'https://a.com' }]);
  assert.equal((b[3] as { text: string }).text, 'a\nb');
  const list = b[4] as Extract<ArticleBlock, { type: 'list' }>;
  assert.equal(list.ordered, false);
  assert.equal(plainText(list.items[0]!.inline), 'one');
  assert.equal(list.items[0]!.children[0]?.ordered, true);
  assert.equal((b[5] as { paragraphs: unknown[] }).paragraphs.length, 1); // empty paragraph dropped
  assert.deepEqual(b[7], { type: 'img', source: 'cms', imageId: IMG, alt: 'alt', caption: 'cap', decorative: false, size: 'inset' });
});

test('published story becomes an Article at the standard public path', () => {
  const a = publishedToArticle(story(), 31);
  assert.deepEqual([a.source, a.path, a.section, a.order, a.title, a.subtitle, a.dateISO], ['cms', '/to-observe-and-report/my-new-story/', 'observe', 31, 'My New Story', 'A subtitle', '2026-09-20']);
  assert.equal(a.dateline, 'September 20, 2026');
  assert.equal(publishedToArticle(story({ section: 'show' }), 6).path, '/to-show-and-tell/my-new-story/');
  assert.equal(publishedToArticle(story({}, [p('x')], { dateline: 'Late summer 2026' }), 1).dateline, 'Late summer 2026');
});

test('assembleArticles: legacy is untouched, CMS continues each section\'s numbering in date order', () => {
  const legacy = legacyArticles(site);
  const a = story({ id: '00000000-0000-4000-8000-00000000000a', slug: 'first-new', publishedAt: '2026-01-05' });
  const b = story({ id: '00000000-0000-4000-8000-00000000000b', slug: 'second-new', publishedAt: '2026-03-01' });
  const s = story({ id: '00000000-0000-4000-8000-00000000000c', slug: 'a-show-piece', section: 'show', publishedAt: '2026-02-01' });
  const all = assembleArticles(legacy, [b, s, a]); // deliberately unsorted input
  assert.deepEqual(all.slice(0, 35), legacy);
  const cms = all.slice(35);
  assert.deepEqual(cms.map((x) => [x.slug, x.order]), [['first-new', 31], ['a-show-piece', 6], ['second-new', 32]]);
  assert.equal(all.length, 38);
  assert.equal(new Set(all.map((x) => x.path)).size, all.length); // no duplicate URLs
});

test('a CMS slug that collides with a legacy or another CMS slug is a build error', () => {
  const legacy = legacyArticles(site);
  assert.throws(() => assembleArticles(legacy, [story({ slug: 'the-wall' })]), /collides/);
  assert.throws(() => assembleArticles(legacy, [story({ id: '00000000-0000-4000-8000-000000000002' }), story()]), /collides/);
});

test('no CMS published stories leaves the legacy site exactly as is', () => {
  const legacy = legacyArticles(site);
  assert.deepEqual(assembleArticles(legacy, []), legacy);
});

test('formatDateline matches the legacy style', () => {
  assert.equal(formatDateline('2012-05-28'), 'May 28, 2012');
  assert.equal(formatDateline('2026-09-05'), 'September 5, 2026');
  assert.equal(formatDateline('not-a-date'), 'not-a-date');
});
