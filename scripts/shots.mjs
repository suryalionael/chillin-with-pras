// Capture screenshots for visual QA across breakpoints.
import { chromium } from 'playwright';

const base = 'http://localhost:4321';
const out = 'screenshots';

const targets = [
  { name: 'home-desktop', url: '/', width: 1380, height: 900 },
  { name: 'home-mobile', url: '/', width: 390, height: 844 },
  { name: 'observe-desktop', url: '/to-observe-and-report/', width: 1380, height: 900 },
  { name: 'observe-mobile', url: '/to-observe-and-report/', width: 390, height: 844 },
  { name: 'article-desktop', url: '/to-observe-and-report/the-wall/', width: 1380, height: 900 },
  { name: 'article-mobile', url: '/to-observe-and-report/the-wall/', width: 390, height: 844 },
  { name: 'gallery-desktop', url: '/to-observe-and-report/focus-on-havana/', width: 1380, height: 900 },
  { name: 'show-desktop', url: '/to-show-and-tell/windows-to-the-world/', width: 1380, height: 900 },
  { name: 'show-mobile', url: '/to-show-and-tell/windows-to-the-world/', width: 390, height: 844 },
  { name: 'showindex-desktop', url: '/to-show-and-tell/', width: 1380, height: 900 },
  { name: 'mend-desktop', url: '/to-observe-and-report/mend-my-broken-heart/', width: 1380, height: 900 },
  { name: 'guitar-desktop', url: '/to-observe-and-report/my-guitar-gently-weeps/', width: 1380, height: 900 },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + t.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${t.name}.png`, fullPage: true });
  console.log(t.name, errors.length ? `CONSOLE ERRORS: ${errors.join(' | ')}` : 'ok');
  await page.close();
}
await browser.close();
console.log('done');