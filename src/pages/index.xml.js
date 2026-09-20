import { buildFeed } from '../lib/feed.mjs';

// Preserve the original feed URL for existing subscribers.
export function GET() {
  return new Response(buildFeed('https://www.chillinwithpras.com/index.xml'), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'max-age=0, s-maxage=3600',
    },
  });
}