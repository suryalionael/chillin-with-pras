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

test('parseEmbedUrl: recognizes Spotify tracks/episodes (compact) vs albums/playlists/shows/artists (tall)', () => {
  const track = parseEmbedUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(track?.provider, 'spotify');
  assert.equal(track?.embedSrc, 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(track?.height, 152);

  const playlist = parseEmbedUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(playlist?.provider, 'spotify');
  assert.equal(playlist?.height, 352);

  // A locale-prefixed path, as Spotify sometimes generates.
  assert.equal(parseEmbedUrl('https://open.spotify.com/intl-en/track/4cOdK2wGLETKBW3PvgPWqT')?.provider, 'spotify');
});

test('parseEmbedUrl: recognizes SoundCloud tracks and sets, wrapping the original URL in the player widget', () => {
  const track = parseEmbedUrl('https://soundcloud.com/someartist/sometrack');
  assert.equal(track?.provider, 'soundcloud');
  assert.equal(track?.height, 166);
  assert.ok(track?.embedSrc.startsWith('https://w.soundcloud.com/player/?'));
  assert.ok(track?.embedSrc.includes(encodeURIComponent('https://soundcloud.com/someartist/sometrack')));

  const set = parseEmbedUrl('https://soundcloud.com/someartist/sets/someplaylist');
  assert.equal(set?.height, 300);

  assert.equal(parseEmbedUrl('https://soundcloud.com/'), null);
});

test('parseEmbedUrl: recognizes Google Maps links by adding output=embed', () => {
  const place = parseEmbedUrl('https://www.google.com/maps/place/Eiffel+Tower/@48.8584,2.2945,17z');
  assert.equal(place?.provider, 'google-maps');
  assert.equal(place?.height, 450);
  assert.ok(place?.embedSrc.includes('output=embed'));

  const query = parseEmbedUrl('https://maps.google.com/?q=Eiffel+Tower');
  assert.equal(query?.provider, 'google-maps');

  assert.equal(parseEmbedUrl('https://www.google.com/search?q=eiffel+tower'), null);
});

test('parseEmbedUrl: recognizes CodePen pens', () => {
  const pen = parseEmbedUrl('https://codepen.io/someuser/pen/abcXYZ');
  assert.equal(pen?.provider, 'codepen');
  assert.equal(pen?.embedSrc, 'https://codepen.io/someuser/embed/abcXYZ?default-tab=result');
  assert.equal(pen?.height, 400);
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
