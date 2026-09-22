// renderSequence turns flat ArticleBlocks into a render sequence, preserving
// legacy figure grouping while passing CMS-only block types through unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSequence } from './render.mjs';

const p = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'p', text, ...extra });
const img = (file: string, alt = '') => ({ type: 'img', file, alt });
const cmsImg = (over: Record<string, string> = {}) => ({ type: 'img', source: 'cms', imageId: 'i-1', alt: 'Alt', caption: 'Cap', decorative: false, size: 'inset', ...over });

test('renderSequence: paragraphs carry text, subhead and dateline', () => {
  const out = renderSequence([p('Intro'), p('A heading', { subhead: true }), p('Late summer 2026.'), p('Body')], 'Late summer 2026.');
  assert.deepEqual(out.map((x) => x.type), ['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  assert.equal((out[0] as { text: string }).text, 'Intro');
  assert.equal((out[1] as { subhead: boolean }).subhead, true);
  assert.equal((out[2] as { dateline: boolean }).dateline, true);
  assert.equal((out[3] as { dateline: boolean }).dateline, false);
});

test('renderSequence: paragraphs keep inline content and a plain paragraph is not a dateline', () => {
  const out = renderSequence([p('Over the wall.', { inline: [{ text: 'Over the ' }, { text: 'wall', bold: true }] })], 'Late summer 2026.');
  assert.equal((out[0] as { text: string }).text, 'Over the wall.');
  assert.equal((out[0] as { dateline: boolean }).dateline, false);
  assert.deepEqual((out[0] as { inline: unknown[] }).inline, [{ text: 'Over the ' }, { text: 'wall', bold: true }]);
});

test('renderSequence: groups consecutive legacy images into single/pair/cluster', () => {
  const out = renderSequence([img('a.jpg'), img('b.jpg'), img('c.jpg'), img('d.jpg'), p('x')]);
  assert.deepEqual(out.map((x) => x.type), ['figure', 'paragraph']);
  const f = out[0] as { variant: string; files: unknown[] };
  assert.deepEqual([f.variant, f.files.length], ['cluster', 4]);
  assert.equal('isCms' in f, false);
});

test('renderSequence: a single CMS image becomes an isCms figure', () => {
  const out = renderSequence([cmsImg()]);
  const f = out[0] as Record<string, unknown>;
  assert.deepEqual([f.type, f.variant, f.isCms], ['figure', 'single', true]);
  assert.deepEqual((f.files as Record<string, unknown>[])[0], { imageId: 'i-1', alt: 'Alt', caption: 'Cap', decorative: false, size: 'inset' });
});

test('renderSequence: clusters are capped at six images and the index always advances', () => {
  const images = Array.from({ length: 20 }, (_, n) => img(`p${n}.jpg`));
  const out = renderSequence(images);
  assert.deepEqual(out.map((x) => x.type), ['figure', 'figure', 'figure', 'figure']);
  assert.deepEqual((out[0] as { files: unknown[] }).files.length, 6);
  assert.deepEqual((out[2] as { files: unknown[] }).files.length, 6);
  assert.deepEqual((out[3] as { files: unknown[] }).files.length, 2);
});

test('renderSequence: CMS block types pass through unchanged', () => {
  const out = renderSequence([
    { type: 'subheading', text: 'Sub', inline: [] },
    { type: 'quote', paragraphs: [[{ text: 'quoted' }]] },
    { type: 'list', ordered: true, items: [{ inline: [{ text: 'one' }], children: [] }] },
    { type: 'divider' },
    { type: 'embed', url: 'https://vimeo.com/1' },
  ]);
  assert.deepEqual(out, [
    { type: 'subheading', text: 'Sub', inline: [] },
    { type: 'quote', paragraphs: [[{ text: 'quoted' }]] },
    { type: 'list', ordered: true, items: [{ inline: [{ text: 'one' }], children: [] }] },
    { type: 'divider' },
    { type: 'embed', url: 'https://vimeo.com/1' },
  ]);
});

test('renderSequence: unknown blocks are skipped without stalling', () => {
  const out = renderSequence([{ type: 'mystery' }, p('Keep going'), { type: 'script' }]);
  assert.deepEqual(out.map((x) => x.type), ['paragraph']);
  assert.equal((out[0] as { text: string }).text, 'Keep going');
});

test('renderSequence: an empty block list renders nothing', () => {
  assert.deepEqual(renderSequence([]), []);
});