import site from '../data/site.json';

function head(selfUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Observations of a Slacker | Chillin’ with Pras</title>
    <link>https://www.chillinwithpras.com/</link>
    <description>Observations of a Slacker — the personal photographic archive of Chillin' with Pras.</description>
    <language>en</language>
    <atom:link href="${selfUrl}" rel="self" type="application/rss+xml"/>
`;
}

function item(a) {
  const iso = a.dateISO || '2012-01-01';
  const text = a.blocks
    .filter((b) => b.type === 'p')
    .map((b) => b.text)
    .join('\n\n');
  return `    <item>
      <title>${a.title}</title>
      <link>https://www.chillinwithpras.com${a.path}</link>
      <guid isPermaLink="true">https://www.chillinwithpras.com${a.path}</guid>
      <description><![CDATA[${text.slice(0, 1200)}]]></description>
      <pubDate>${new Date(iso + 'T12:00:00Z').toUTCString()}</pubDate>
    </item>
`;
}

export function buildFeed(selfUrl) {
  return (
    head(selfUrl) + site.articles.map(item).join('') + '  </channel>\n</rss>\n'
  );
}