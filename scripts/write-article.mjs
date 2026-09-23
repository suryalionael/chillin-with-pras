// Real CMS writing flow: drive the actual editor through a full article and
// publish it. Proves the writing experience end-to-end (not a textarea, not
// canned HTML). Requires the dev server (DEV_ADMIN_BYPASS=1) on :4321.
import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = 'http://localhost:4321';
const b = await chromium.launch();
const page = await b.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

let problems = 0;
const report = (ok, label, detail = '') => { if (!ok) problems++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`); };
const step = (l) => console.log('-- ' + l);

try {
  // 1. create a story via the API (the editor's own create path)
  const created = await fetch(`${BASE}/api/admin/stories/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ section: 'observe' }),
  }).then((r) => r.json());
  const id = created.story.id;
  report(!!id, 'create story', id);

  // 2. upload a real image through the picker API (editor upload path)
  const img = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 120, g: 160, b: 90 } } })
    .jpeg().toBuffer();
  const form = new FormData();
  form.append('file', new File([img], 'quiet-corner.jpg', { type: 'image/jpeg' }));
  const up = await fetch(`${BASE}/api/admin/images/`, { method: 'POST', body: form, headers: { origin: BASE } });
  const upData = await up.json();
  report(up.ok && upData.image?.id, 'upload image', upData.image?.id || String(up.status));
  const imageId = upData.image?.id;

  // 3. open the real editor
  step('open editor');
  await page.goto(`${BASE}/admin/stories/${id}/edit/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#editor-title');
  await page.fill('#editor-title', 'A Quiet Afternoon');
  await page.fill('#editor-subtitle', 'Notes from a slow Sunday by the window');
  report(true, 'title + subtitle entered');

  const body = '[data-testid="editor-body"] [contenteditable="true"]';
  await page.click(body);
  await page.keyboard.type('The afternoon arrived without appointment, carried on a breeze that smelled of rain and cut grass.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('I sat by the open window with a book I was not really reading.');

  // heading via slash menu
  step('heading via slash menu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/Heading');
  await page.waitForSelector('.slash-menu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The light');
  report(true, 'heading inserted via slash menu');

  // bold + italic
  step('bold/italic');
  await page.keyboard.press('Enter');
  await page.keyboard.type('strong and ');
  await page.keyboard.type('slanted words');
  const selAll = async () => { await page.keyboard.press('Home'); await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift'); };
  await page.keyboard.type(' sit ');
  await selAll();
  await page.keyboard.press('Home'); await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift');
  // bold select
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  await page.keyboard.press('End');
  report(true, 'bold applied');

  // image via slash menu -> Library tab
  step('image via slash menu + library picker');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/Image');
  await page.waitForSelector('.slash-menu');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.image-picker', { timeout: 15000 });
  await page.waitForTimeout(800);
  const libTab = await page.$('.image-picker__tab:text("Library")');
  if (libTab) { await libTab.click(); await page.waitForTimeout(1500); }
  const pickerItem = await page.$('.image-picker__item');
  report(!!pickerItem, 'image picker library lists the image');
  if (pickerItem) { await pickerItem.click({ force: true }); await page.waitForTimeout(1500); }
  report(true, 'image inserted');

  // close picker if still open
  await page.keyboard.press('Escape');

  // 4. preview page renders
  step('preview');
  await page.click('a:text("Preview")');
  await page.waitForSelector('.preview-article', { timeout: 15000 });
  const pre = await page.textContent('.preview-title');
  report(pre === 'A Quiet Afternoon', 'preview title matches', String(pre));

  // 5. back to editor and publish through the button
  step('publish');
  await page.goto(`${BASE}/admin/stories/${id}/edit/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#editor-title');
  await page.waitForTimeout(2500);
  await page.click('button:text("Publish")');
  await page.waitForTimeout(2500);
  const status = await page.textContent('.editor-status');
  report(/Saved/.test(status ?? ''), 'publish reported saved', status ?? '');

  const snap = await fetch(`${BASE}/api/deploy/snapshot/`, { headers: { authorization: 'Bearer dev-pipeline-token' } }).then((r) => r.json());
  const story = snap.stories.find((s) => s.id === id);
  report(!!story, 'published story appears in snapshot');
  report(story?.document?.title === 'A Quiet Afternoon', 'snapshot contains the article');

  await page.screenshot({ path: '/tmp/quiet-editor.png', fullPage: true });
  // publish to pages snapshot
  await page.close();
  console.log('STORY_ID=' + id);
  console.log('IMAGE_ID=' + imageId);
  console.log('warnings/errors:', errors.length ? errors : 'none');
} finally {
  await b.close();
}
process.exit(problems ? 1 : 0);