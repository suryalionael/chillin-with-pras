import { buildFeed } from '../lib/feed.mjs';

export function GET() {
  return new Response(buildFeed('https://www.chillinwithpras.com/rss.xml'), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'max-age=0, s-maxage=3600',
    },
  });
}