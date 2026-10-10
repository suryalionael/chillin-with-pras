// Regression coverage for the save-failure bug this session traced to its
// root cause: parseEmbedUrl (what the editor's live preview checks) used to
// accept http:// links that isSafeEmbedUrl (what the server validates a saved
// document against) always rejected. An http:// link would render a working
// preview in the editor and then fail schema validation on save with no
// indication why. The fix made both checks share one implementation; these
// tests pin that they still agree, and that http is rejected by both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeEmbedUrl, parseEmbedUrl } from './embed-url.ts';

test('parseEmbedUrl: recognizes https YouTube/Vimeo links in their common forms', () => {
  assert.equal(parseEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.provider, 'youtube');
  assert.equal(parseEmbedUrl('https://youtu.be/dQw4w9WgXcQ')?.provider, 'youtube');
  assert.equal(parseEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.provider, 'youtube');
  assert.equal(parseEmbedUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')?.provider, 'youtube');
  assert.equal(parseEmbedUrl('https://vimeo.com/76979871')?.provider, 'vimeo');
  assert.equal(parseEmbedUrl('https://player.vimeo.com/video/76979871')?.provider, 'vimeo');
});

test('parseEmbedUrl: rejects http:// even for an otherwise-valid YouTube link (the save-failure bug)', () => {
  assert.equal(parseEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseEmbedUrl('http://youtu.be/dQw4w9WgXcQ'), null);
});

test('parseEmbedUrl: unrecognized providers and garbage input return null without throwing', () => {
  assert.equal(parseEmbedUrl('https://example.com/video'), null);
  assert.equal(parseEmbedUrl('not a url'), null);
  assert.equal(parseEmbedUrl(''), null);
});

test('isSafeEmbedUrl and parseEmbedUrl agree on protocol: nothing parseEmbedUrl accepts is rejected by isSafeEmbedUrl', () => {
  const candidates = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://vimeo.com/76979871',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://example.com/not-a-video',
  ];
  for (const url of candidates) {
    const parsed = parseEmbedUrl(url);
    if (parsed) assert.equal(isSafeEmbedUrl(url), true, `${url} parses but isSafeEmbedUrl rejects it`);
  }
});

test('isSafeEmbedUrl: rejects credentials, non-https schemes, and missing hostnames', () => {
  for (const bad of ['http://a.com', 'https://user:pw@a.com', 'javascript:alert(1)', 'https://localhost', 'data:text/html,x', '']) {
    assert.equal(isSafeEmbedUrl(bad), false, bad);
  }
  assert.equal(isSafeEmbedUrl('https://example.com/article'), true);
});
