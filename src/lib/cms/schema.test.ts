import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStoryDocument, parseStoryDocument, publishIssues, referencedImageIds, serializeDocument, parseStoredDocument, isSafeHref, isSafeEmbedUrl, type StoryDocument } from './schema.ts';

const IMG = '11111111-1111-4111-8111-111111111111';
const IMG2 = '22222222-2222-4222-8222-222222222222';

const doc = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1, title: 'A title', subtitle: '', dateline: '', featuredImageId: null,
  body: { type: 'doc', content }, ...extra,
});
const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const ok = (input: unknown) => { const r = parseStoryDocument(input); assert.equal(r.ok, true, JSON.stringify(!r.ok && r.issues)); return r.ok ? r.value : (undefined as never); };
const bad = (input: unknown) => assert.equal(parseStoryDocument(input).ok, false);

test('a document using every supported concept is accepted', () => {
  const value = ok(doc([
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Subheading' }] },
    p('bold italic link', [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://example.com/x?y=1' } }]),
    { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('one'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('nested')] }] }] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('first')] }] },
    { type: 'blockquote', content: [p('quoted')] },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { imageId: IMG, alt: 'A wall', caption: 'The wall', size: 'inset' } },
    { type: 'embed', attrs: { url: 'https://www.youtube.com/watch?v=abc' } },
  ], { featuredImageId: IMG }));
  assert.equal(value.body.content.length, 10);
});

test('empty draft (no title, no content) is valid but not publishable', () => {
  const value = ok(emptyStoryDocument());
  assert.deepEqual(publishIssues(value).map((i) => i.path).sort(), ['body', 'title']);
});

test('unknown node types are rejected', () => {
  for (const type of ['script', 'html', 'iframe', 'codeBlock', 'table', 'heading1']) bad(doc([{ type, content: [] }]));
});

test('unknown attributes and keys are dropped, not stored', () => {
  const value = ok(doc([
    { type: 'paragraph', evil: '<script>', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://a.com', target: '_blank', rel: 'x', onclick: 'alert(1)', class: 'c' } }] }] },
    { type: 'image', attrs: { imageId: IMG, alt: 'a', style: 'position:fixed' } },
  ], { extraTopLevel: 1 }));
  const s = serializeDocument(value);
  for (const needle of ['evil', 'onclick', 'target', 'rel', 'style', 'extraTopLevel', 'class']) assert.equal(s.includes(needle), false, needle);
});

test('links are limited to safe protocols', () => {
  for (const good of ['https://a.com', 'http://a.com/x', 'mailto:me@a.com', '/to-observe-and-report/the-wall/']) assert.equal(isSafeHref(good), true, good);
  for (const evil of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', '//evil.com', '/\\evil.com', ' https://a.com', 'https://a.com/ x', '', 'ftp://a.com', 'java\nscript:alert(1)']) assert.equal(isSafeHref(evil), false, JSON.stringify(evil));
  bad(doc([p('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])]));
});

test('embeds must be https without credentials', () => {
  assert.equal(isSafeEmbedUrl('https://vimeo.com/123'), true);
  for (const evil of ['http://a.com', 'https://user:pw@a.com', 'javascript:1', 'https://localhost', 'https://a.com/a b', 'data:text/html,x']) assert.equal(isSafeEmbedUrl(evil), false, evil);
  bad(doc([{ type: 'embed', attrs: { url: 'http://insecure.example.com' } }]));
});

test('structural limits', () => {
  bad(doc([{ type: 'heading', attrs: { level: 1 }, content: [] }]));
  bad(doc([{ type: 'heading', attrs: { level: 4 }, content: [] }]));
  bad(doc([{ type: 'image', attrs: { imageId: 'not-a-uuid' } }]));
  bad(doc([{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]));
  bad(doc([p('x', [{ type: 'bold' }, { type: 'italic' }, { type: 'bold' }, { type: 'italic' }])]));
  bad(doc([p('x'.repeat(20_001))]));
  bad(doc([], { version: 2 }));
  bad(doc([], { title: 't'.repeat(201) }));
  bad({ ...doc([]), title: undefined });
  bad(null);
  bad('string');
  // 4 levels of list nesting is beyond the supported depth
  const l4 = { type: 'bulletList', content: [{ type: 'listItem', content: [p('d4')] }] };
  const l3 = { type: 'bulletList', content: [{ type: 'listItem', content: [p('d3'), l4] }] };
  const l2 = { type: 'bulletList', content: [{ type: 'listItem', content: [p('d2'), l3] }] };
  const l1 = { type: 'bulletList', content: [{ type: 'listItem', content: [p('d1'), l2] }] };
  bad(doc([l1]));
});

test('oversized documents are refused before parsing', () => {
  const big = Array.from({ length: 60 }, () => p('y'.repeat(19_000)));
  const r = parseStoryDocument(doc(big));
  assert.equal(r.ok, false);
});

test('image defaults are applied', () => {
  const value = ok(doc([{ type: 'image', attrs: { imageId: IMG } }]));
  const img = value.body.content[0];
  assert.equal(img?.type === 'image' && JSON.stringify(img.attrs), JSON.stringify({ imageId: IMG, alt: '', caption: '', decorative: false, size: 'wide' }));
});

test('publish rules: title, content, alt text', () => {
  const noAlt = ok(doc([{ type: 'image', attrs: { imageId: IMG } }]));
  assert.deepEqual(publishIssues(noAlt).map((i) => i.message.includes('alt')), [true]);
  const decorative = ok(doc([{ type: 'image', attrs: { imageId: IMG, decorative: true } }]));
  assert.equal(publishIssues(decorative).length, 0);
  const withAlt = ok(doc([{ type: 'image', attrs: { imageId: IMG, alt: 'x' } }]));
  assert.equal(publishIssues(withAlt).length, 0);
  assert.ok(publishIssues(ok(doc([{ type: 'horizontalRule' }, { type: 'paragraph' }]))).some((i) => i.path === 'body'));
  assert.ok(publishIssues(ok(doc([p('hello')], { title: '   ' }))).some((i) => i.path === 'title'));
  assert.equal(publishIssues(ok(doc([p('hello')]))).length, 0);
});

test('referencedImageIds collects body and featured images once', () => {
  const value = ok(doc([{ type: 'image', attrs: { imageId: IMG, alt: 'a' } }, { type: 'image', attrs: { imageId: IMG2, alt: 'b' } }, { type: 'image', attrs: { imageId: IMG, alt: 'c' } }], { featuredImageId: IMG }));
  assert.deepEqual(referencedImageIds(value).sort(), [IMG, IMG2]);
});

test('serialize/parse round trip is stable', () => {
  const value = ok(doc([p('hello', [{ type: 'bold' }]), { type: 'horizontalRule' }]));
  const text = serializeDocument(value);
  const back = parseStoredDocument(text);
  assert.equal(back.ok && serializeDocument(back.value as StoryDocument), text);
  assert.equal(parseStoredDocument('{not json').ok, false);
});
