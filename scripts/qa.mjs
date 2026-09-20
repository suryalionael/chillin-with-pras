// Fast, deterministic QA against the production build in dist/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const site = JSON.parse(fs.readFileSync('src/data/site.json', 'utf8'));
const dist = 'dist/client'; // static public output (dist/server is the admin Worker)

let problems = 0;
const report = (ok, label, detail = '') => {
  if (!ok) problems++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};

// ---------- 1. Static file/route inventory ----------
const expectedFiles = [
  'index.html',
  'to-observe-and-report/index.html',
  'to-show-and-tell/index.html',
  'sitemap-index.xml',
  'og.jpg',
  'favicon.svg',
  '404.html',
  ...site.articles.map((a) => a.path.slice(1) + 'index.html'),
];
for (const f of expectedFiles) {
  report(fs.existsSync(path.join(dist, f)), 'file ' + f);
}

// ---------- 1b. RSS is gone (files, markup, and live URLs) ----------
for (const f of ['rss.xml', 'index.xml']) {
  report(!fs.existsSync(path.join(dist, f)), `no ${f} in build output`);
}

// ---------- 2. Static link integrity ----------
const allHtml = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.html')) allHtml.push(full);
  }
}
walk(dist);

const linkRx = /href="([^"#]+)"/g;
for (const htmlFile of allHtml) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const hrefs = [...html.matchAll(linkRx)].map((m) => m[1]).filter((h) => !h.includes('://'));
  // also check img srcs
  const imgSrcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s.startsWith('/'));
  const candidates = [...hrefs, ...imgSrcs];
  for (let c of candidates) {
    c = c.split('?')[0];
    if (c === '/') continue;
    let target = c.startsWith('/') ? c.slice(1) : c;
    // resolve against dist root for absolute, page dir for relative
    const baseDir = c.startsWith('/') ? dist : path.dirname(htmlFile);
    let fullPath = path.join(baseDir, target);
    // normalize: if target ends with / or has no .html, check for index.html
    if (target.endsWith('/') || !target.includes('.')) {
      fullPath = path.join(fullPath, 'index.html');
    }
    if (!fs.existsSync(fullPath)) {
      problems++;
      console.log(`[FAIL] broken ref ${c} in ${path.relative(dist, htmlFile)} -> ${fullPath}`);
    }
  }
}
console.log('[DONE] link integrity checked');

// no page may advertise or link to a feed
{
  const feedRx = /application\/(rss|atom)\+xml|href="[^"]*(rss\.xml|index\.xml|atom\.xml)"|>\s*RSS( feed)?\s*</i;
  const offenders = allHtml.filter((f) => feedRx.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(dist, f));
  report(offenders.length === 0, 'no page references a feed', offenders.slice(0, 3).join(', '));
}


// ---------- 3. Browser probes (overflow / status / image resource failures) ----------
const base = 'http://localhost:4321';
const widths = [390, 768, 1024, 1380];
const probeRoutes = [
  '/',
  '/to-observe-and-report/',
  '/to-show-and-tell/',
  '/to-observe-and-report/the-wall/',
  '/to-observe-and-report/focus-on-havana/',
  '/to-observe-and-report/desert-life/',
  '/to-show-and-tell/windows-to-the-world/',
  '/to-show-and-tell/food-for-thought/',
  '/to-show-and-tell/carvin-pumpkin/',
];

await import('playwright').then(async ({ chromium }) => {
  const browser = await chromium.launch();
  for (const route of probeRoutes) {
    const page = await browser.newPage();
    const resErrors = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.request().resourceType() === 'image') resErrors.push(`${r.status()} ${r.request().url().slice(-30)}`);
    });
    page.on('requestfailed', (req) => {
      if (req.resourceType() === 'image') resErrors.push('failed ' + req.url().slice(-30));
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) report(false, `overflow ${route} @${width}`, `${overflow}px`);
      else report(true, `overflow ${route} @${width}`);
    }
    report(resErrors.length === 0, `images ${route}`, resErrors.slice(0, 3).join('; '));
    await page.close();
  }

  // ---------- 4. Image presence + sharpness, handwriting collisions, nav ----------
  const scrollAll = async (page) => {
    await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    });
  };

  const allRoutes = [
    '/', '/to-observe-and-report/', '/to-show-and-tell/',
    ...site.articles.map((a) => a.path),
  ];
  for (const width of [390, 1380]) {
    for (const route of allRoutes) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await scrollAll(page);
      const res = await page.evaluate(() => {
        const out = { soft: [], tiny: [], broken: [], hand: [], overflow: document.documentElement.scrollWidth - innerWidth };
        for (const img of document.querySelectorAll('main img')) {
          const r = img.getBoundingClientRect();
          if (!img.complete || img.naturalWidth === 0) out.broken.push(img.currentSrc.slice(-30));
          // the largest file offered in srcset must comfortably cover the displayed size
          // (naturalWidth is density-corrected in Chrome, so read the srcset itself)
          else if (r.width > 0) {
            const widths = (img.getAttribute('srcset') || '').split(',').map((c) => parseInt(c.trim().split(/\s+/)[1], 10)).filter(Boolean);
            const best = widths.length ? Math.max(...widths) : img.naturalWidth;
            if (best < r.width * 1.25) out.soft.push(`best file ${best}px shown at ${Math.round(r.width)}px`);
          }
          // photographs must not be thumbnails: at least 60% of the column on phones, 300px on desktop
          if (r.width > 0 && r.width < (innerWidth < 600 ? innerWidth * 0.6 : 300)) out.tiny.push(`${Math.round(r.width)}px ${img.currentSrc.slice(-24)}`);
        }
        // handwriting must not collide with any other text
        const textEls = [...document.querySelectorAll('main *, header *')].filter((el) => el.checkVisibility() && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        const isHand = (el) => getComputedStyle(el).fontFamily.includes('Caveat');
        for (const h of textEls.filter(isHand)) {
          const a = h.getBoundingClientRect();
          if (!a.width) continue;
          for (const o of textEls) {
            if (o === h || isHand(o) || h.contains(o) || o.contains(h)) continue;
            const b = o.getBoundingClientRect();
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 2 && iy > 4) out.hand.push(`${h.textContent.trim().slice(0, 20)} × ${o.textContent.trim().slice(0, 20)}`);
          }
        }
        return out;
      });
      const tag = `${route} @${width}`;
      report(res.broken.length === 0, `no broken images ${tag}`, res.broken.slice(0, 2).join('; '));
      report(res.tiny.length === 0, `no thumbnail-sized photos ${tag}`, res.tiny.slice(0, 2).join('; '));
      report(res.soft.length === 0, `photos sharp (not upscaled by browser) ${tag}`, res.soft.slice(0, 2).join('; '));
      report(res.hand.length === 0, `handwriting clear ${tag}`, res.hand.slice(0, 2).join('; '));
      report(res.overflow <= 1, `no horizontal overflow ${tag}`, `${res.overflow}px`);
      await page.close();
    }
  }

  // one shared left edge: logo, page content (title or hero photo) and footer line up
  for (const width of [390, 768, 1024, 1380]) {
    for (const route of ['/', '/to-observe-and-report/', '/to-show-and-tell/', '/to-observe-and-report/the-wall/', '/to-show-and-tell/carvin-pumpkin/']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const edges = await page.evaluate(() => {
        const left = (sel) => document.querySelector(sel)?.getBoundingClientRect().left;
        return {
          logo: left('.site-mark'),
          content: left('.story__hero .photo-frame') ?? left('main h1'),
          footer: left('.site-footer__copy'),
        };
      });
      const ok = Math.abs(edges.logo - edges.content) < 2 && Math.abs(edges.logo - edges.footer) < 2;
      report(ok, `left edges align ${route} @${width}`, ok ? '' : JSON.stringify(edges));
      await page.close();
    }
  }

  // handwritten dates must never be forced to uppercase
  {
    const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
    await page.goto(base + '/to-observe-and-report/the-wall/', { waitUntil: 'networkidle' });
    const tt = await page.evaluate(() => getComputedStyle(document.querySelector('.article-head .hand-date')).textTransform);
    report(tt === 'none', 'handwritten date not uppercased', tt);
    await page.close();
  }

  // legacy feed URLs are ordinary 404s (no redirects, no replacement feed)
  for (const url of ['/rss.xml', '/index.xml']) {
    const res = await fetch(base + url);
    report(res.status === 404, `${url} returns 404`, `got ${res.status}`);
  }

  // header nav: never wraps to more than one line at any width
  for (const width of [390, 768, 900, 901, 1024, 1380]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const h = await page.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().height);
    report(h < 100, `header stays one row @${width}`, `${Math.round(h)}px`);
    await page.close();
  }

  await browser.close();
});

console.log(problems ? `\n${problems} problem(s)` : '\nAll QA checks passed');