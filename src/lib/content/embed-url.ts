// Recognizes YouTube/Vimeo links and turns them into an iframe embed src.
// Shared between the CMS editor (live preview while writing), the editor's
// own input validation, the server-side StoryDocument schema (cms/schema.ts
// imports isSafeEmbedUrl from here), and the public renderer
// (ArticleBody.astro) — one definition of "is this a usable embed URL" that
// every layer checks against, so none of them can silently disagree with
// another about whether a given link is valid. They used to not: the editor
// accepted http:// links (rendering a live preview that looked fully
// inserted) while the server's own, separately-maintained check required
// https — so saving a document with an http:// embed would fail validation
// with no indication of why, well after the user believed it had worked.

export interface ParsedEmbed {
  provider: 'youtube' | 'vimeo';
  embedSrc: string;
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

  return null;
}
