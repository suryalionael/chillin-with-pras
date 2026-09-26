// Recognizes YouTube/Vimeo links and turns them into an iframe embed src.
// Shared between the CMS editor (live preview while writing) and the public
// renderer (ArticleBody.astro), so both agree on what counts as embeddable.

export interface ParsedEmbed {
  provider: 'youtube' | 'vimeo';
  embedSrc: string;
}

export function parseEmbedUrl(rawUrl: string): ParsedEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
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
