// Recognizes links from supported embed providers and turns them into an
// iframe embed src. Shared between the CMS editor (live preview while
// writing), the editor's own input validation, the server-side
// StoryDocument schema (cms/schema.ts imports isSafeEmbedUrl from here), and
// the public renderer (ArticleBody.astro) — one definition of "is this a
// usable embed URL" that every layer checks against, so none of them can
// silently disagree with another about whether a given link is valid. They
// used to not: the editor accepted http:// links (rendering a live preview
// that looked fully inserted) while the server's own, separately-maintained
// check required https — so saving a document with an http:// embed would
// fail validation with no indication of why, well after the user believed
// it had worked.
//
// Only providers that (a) allow being iframed at all (most sites send
// X-Frame-Options/CSP frame-ancestors specifically to block this, and
// nothing client- or server-side here can override that) and (b) expose a
// stable, documented-or-long-standing URL -> iframe-src conversion that
// works without a server-side API call are supported. A link to anything
// else deliberately falls back to a plain clickable link (see
// EmbedExtension.ts / PreviewRenderer.tsx / ArticleBody.astro) rather than
// an iframe that would just render blank.

export interface ParsedEmbed {
  provider: 'youtube' | 'vimeo' | 'spotify' | 'soundcloud' | 'google-maps' | 'codepen';
  embedSrc: string;
  /** Fixed pixel height for providers whose widget isn't a 16:9 video (a
   * compact Spotify player, a SoundCloud waveform, a Maps pane, a CodePen
   * demo). Omitted for youtube/vimeo, which render in the usual 16:9 box. */
  height?: number;
}

/** Must match LIMITS.url in cms/schema.ts (not imported from there — this
 * module has to stay dependency-free so the editor's client bundle doesn't
 * pull in Zod just for one constant). */
const MAX_URL_LENGTH = 2048;

/** Is this safe to fetch from a visitor's browser as an embed? https only,
 * no embedded credentials, a real hostname. The single gate both the editor
 * (before it ever commits a URL into the document) and the server (before
 * it accepts a saved document) check a candidate embed URL against. */
export function isSafeEmbedUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH || /[ -\s]/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export function parseEmbedUrl(rawUrl: string): ParsedEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  // https only — must agree with isSafeEmbedUrl in cms/schema.ts, the
  // server-side gate a saved document is actually validated against. This
  // used to also accept http:, so a pasted http:// link would render a live
  // preview right here in the editor (looking fully inserted and working)
  // and then fail schema validation the moment the document was saved, with
  // the editor and the server disagreeing about whether the embed was valid.
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    if (id) return { provider: 'youtube', embedSrc: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      if (id) return { provider: 'youtube', embedSrc: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    const embedMatch = /^\/(embed|shorts)\/([^/]+)/.exec(url.pathname);
    if (embedMatch) return { provider: 'youtube', embedSrc: `https://www.youtube-nocookie.com/embed/${embedMatch[2]}` };
  }
  if (host === 'vimeo.com') {
    const id = /^\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return { provider: 'vimeo', embedSrc: `https://player.vimeo.com/video/${id}` };
  }
  if (host === 'player.vimeo.com') {
    const id = /^\/video\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return { provider: 'vimeo', embedSrc: `https://player.vimeo.com/video/${id}` };
  }

  if (host === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(url.pathname);
    if (match) {
      const [, type, id] = match;
      // A single track/episode is a short compact player; everything else
      // (album/playlist/show/artist) shows a tracklist and needs more room.
      const height = type === 'track' || type === 'episode' ? 152 : 352;
      return { provider: 'spotify', embedSrc: `https://open.spotify.com/embed/${type}/${id}`, height };
    }
  }

  if (host === 'soundcloud.com' && url.pathname.length > 1) {
    const isSet = /\/sets\//.test(url.pathname);
    const params = new URLSearchParams({ url: url.toString(), color: '#ff5500', auto_play: 'false', show_comments: 'false' });
    return { provider: 'soundcloud', embedSrc: `https://w.soundcloud.com/player/?${params.toString()}`, height: isSet ? 300 : 166 };
  }

  // Google Maps doesn't require an API key for this: appending output=embed
  // to an ordinary maps.google.com / google.com/maps URL (the same link you'd
  // copy from the address bar) is a long-standing, widely relied-on way to
  // get an embeddable iframe src, distinct from the API-key-gated Maps
  // Embed API. A maps.app.goo.gl short link can't be handled here — turning
  // it into a real maps.google.com URL requires following a redirect, which
  // this function can't do (it has to stay a synchronous, dependency-free
  // check usable on both the client and the server).
  const isMapsHost = host === 'maps.google.com' || ((host === 'google.com' || host === 'google.co.uk') && url.pathname.startsWith('/maps'));
  if (isMapsHost) {
    const embed = new URL(url.toString());
    embed.searchParams.set('output', 'embed');
    return { provider: 'google-maps', embedSrc: embed.toString(), height: 450 };
  }

  if (host === 'codepen.io') {
    const match = /^\/([^/]+)\/pen\/([^/]+)/.exec(url.pathname);
    if (match) {
      const [, user, slug] = match;
      return { provider: 'codepen', embedSrc: `https://codepen.io/${user}/embed/${slug}?default-tab=result`, height: 400 };
    }
  }

  return null;
}
