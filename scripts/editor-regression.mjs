// Browser regression for the CMS editor + preview + image flow.
// Boots the local dev server (Cloudflare adapter) with the admin bypass,
// drives the real pages, and asserts the React islands hydrate.
//
//   node scripts/editor-regression.mjs
//
// Requires a local D1 (npm run db:migrate:local) and Playwright.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4329;
const BASE = `http://localhost:${PORT}`;

let problems = 0;
const report = (ok, label, detail = '') => {
  if (!ok) problems++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};

async function waitFor(url, ms) {
  const dead = Date.now() + ms;
  while (Date.now() < dead) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ---------- start the dev server ----------
const dev = spawn('npx', ['astro', 'dev', '--port', String(PORT), '--host', '127.0.0.1'], {
  cwd: ROOT,
  env: { ...process.env, DEV_ADMIN_BYPASS: 'true' },
  stdio: 'ignore',
});
let exited = false;
dev.once('exit', () => { exited = true; });
const up = await waitFor(`${BASE}/`, 60_000);
if (!up) {
  console.error('dev server did not start');
  dev.kill('SIGTERM');
  process.exit(1);
}

const browser = await chromium.launch();
const fixtureDir = mkdtempSync(join(tmpdir(), 'editor-regression-fixtures-'));
const landscapeJpg = join(fixtureDir, 'landscape.jpg');
const portraitJpg = join(fixtureDir, 'portrait.jpg');

async function insertViaSlash(page, label) {
  await page.waitForSelector('.slash-menu', { timeout: 5000 });
  await page.click(`.slash-menu__item:has-text("${label}")`);
}

async function insertImage(page, filePath) {
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/image');
  await insertViaSlash(page, 'Image');
  await page.waitForSelector('.image-picker', { timeout: 5000 });
  await page.setInputFiles('#image-upload-input', filePath);
  await page.waitForSelector('.editor-image img.editor-image__img', { timeout: 15_000 });
  await page.waitForTimeout(200);
}

async function freshStory(section = 'observe') {
  const created = await fetch(`${BASE}/api/admin/stories/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ section }),
  }).then((r) => r.json());
  return created.story;
}

try {
  // ---------- find/create a story to edit ----------
  const list = await fetch(`${BASE}/api/admin/stories/`).then((r) => r.json());
  let story = list.stories?.find((s) => s.status === 'draft' || s.status === 'published');
  if (!story) {
    const created = await fetch(`${BASE}/api/admin/stories/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ section: 'observe' }),
    }).then((r) => r.json());
    story = created.story;
  }

  const editUrl = `${BASE}/admin/stories/${story.id}/edit/`;
  const previewUrl = `${BASE}/admin/stories/${story.id}/preview/`;

  // ---------- editor page ----------
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`); });

    const res = await page.goto(editUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1200);

    report(res.status() === 200, 'edit page returns 200', `got ${res.status()}`);
    const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
    report(bodyLen > 1000, 'edit page body is non-empty', `${bodyLen} chars`);

    const root = await page.$('[data-testid="editor-root"]');
    report(root !== null, 'editor root exists (data-testid="editor-root")');
    report(await page.$('#editor-title') !== null, 'title input exists');
    report(await page.$('#editor-subtitle') !== null, 'subtitle input exists');
    const writingSurface = await page.$('[data-testid="editor-body"] [contenteditable="true"]');
    report(writingSurface !== null, 'Tiptap contenteditable writing surface exists');
    report(await page.$('.ProseMirror') !== null, 'ProseMirror renders');
    const publishVisible = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Publish'));
    report(publishVisible, 'Publish button visible');

    // typing persists via autosave -> draft API
    await page.fill('#editor-title', 'Regression Editor Title');
    await page.waitForTimeout(2200);
    const statusText = (await page.textContent('.editor-status'))?.trim() ?? '';
    report(/Saved/.test(statusText) || /Ready/.test(statusText), 'editor reports saved after typing', statusText);

    report(consoleErrors.length === 0, 'no browser console/page errors on edit', consoleErrors.join(' | '));
    await page.screenshot({ path: join(tmpdir(), 'editor-regression-edit.png'), fullPage: true });
    await page.close();
  }

  // ---------- preview page ----------
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`); });

    const res = await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1000);

    report(res.status() === 200, 'preview page returns 200', `got ${res.status()}`);
    const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
    report(bodyLen > 1000, 'preview page body is non-empty', `${bodyLen} chars`);
    report(await page.$('.preview-article') !== null, 'preview article renders');
    report(await page.$('.preview-title') !== null, 'preview title renders');
    report(consoleErrors.length === 0, 'no browser console/page errors on preview', consoleErrors.join(' | '));
    await page.screenshot({ path: join(tmpdir(), 'editor-regression-preview.png'), fullPage: true });
    await page.close();
  }

  // ---------- mixed-content round trip (save -> reload -> preview -> publish) ----------
  // Regression coverage for the "Save Failed" bug: a realistic document
  // combining every block type the brief called out, saved, reloaded,
  // previewed and published for real — not just type-checked in isolation.
  {
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 120, g: 70, b: 40 } } }).jpeg().toFile(landscapeJpg);
    await sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 40, g: 70, b: 120 } } }).jpeg().toFile(portraitJpg);

    const mixed = await freshStory('observe');
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`); });

    await page.goto(`${BASE}/admin/stories/${mixed.id}/edit/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.prose-editor', { timeout: 15_000 });

    await page.fill('#editor-title', 'Mixed Content Regression');
    await page.fill('#editor-subtitle', 'Every block type in one document.');

    await page.click('.prose-editor');
    await page.keyboard.type('Plain text with a bold word and an italic word together.');
    // scrollIntoViewIfNeeded + click before dblclick: a bare dblclick on an
    // element Playwright had to auto-scroll to reach can land without ever
    // producing a real text selection, so the floating toolbar never shows
    // and the bold click below silently no-ops — not a product bug, a
    // Playwright timing quirk, but one that bit an earlier version of this
    // suite, so it's spelled out here deliberately.
    const target = page.locator('.prose-editor p').first();
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await target.dblclick();
    await page.waitForSelector('.floating-toolbar', { timeout: 3000 });
    await page.click('button[aria-label^="Bold"]');
    await page.waitForTimeout(200);

    await page.click('.prose-editor');
    // A real click needs a moment to actually land a selection in
    // ProseMirror before the browser's next paint — pressing End/Enter
    // within the same tick (only possible at automation speed, never at
    // human input speed) can race ahead of it and split the paragraph
    // against a stale selection, dropping the mark that was just applied.
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/heading');
    await insertViaSlash(page, 'Heading');
    await page.keyboard.type('A Heading');

    await page.keyboard.press('Enter');
    await page.keyboard.type('/subheading');
    await insertViaSlash(page, 'Subheading');
    await page.keyboard.type('A Subheading');

    await page.keyboard.press('Enter');
    await page.keyboard.type('/quote');
    await insertViaSlash(page, 'Quote');
    await page.keyboard.type('Poetry or a quotation, set apart from the prose.');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/bulleted');
    await insertViaSlash(page, 'Bulleted list');
    await page.keyboard.type('First bullet');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second bullet');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/numbered');
    await insertViaSlash(page, 'Numbered list');
    await page.keyboard.type('First step');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second step');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/divider');
    await insertViaSlash(page, 'Divider');

    await insertImage(page, landscapeJpg);
    await page.click('.editor-image__caption--input');
    await page.keyboard.type('A landscape photo.');
    await page.click('.prose-editor', { position: { x: 5, y: 5 } });

    await page.click('.prose-editor');
    await page.keyboard.press('End');
    await insertImage(page, portraitJpg);
    await page.click('.editor-image__caption--input');
    await page.keyboard.type('A portrait photo.');
    await page.click('.prose-editor', { position: { x: 5, y: 5 } });

    await page.click('.prose-editor');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/embed');
    await insertViaSlash(page, 'Embed');
    await page.waitForSelector('.editor-embed__input', { timeout: 5000 });
    await page.fill('.editor-embed__input', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.editor-embed__frame iframe', { timeout: 5000 }).catch(() => {});

    await page.click('button:has-text("Save")');
    await page.waitForTimeout(1500);
    const saveStatus = await page.locator('.editor-status').innerText().catch(() => '?');
    report(/Saved/i.test(saveStatus), 'mixed-content document saves without error', saveStatus);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prose-editor', { timeout: 15_000 });
    const afterReload = await page.evaluate(() => ({
      bold: document.querySelectorAll('.prose-editor strong').length,
      h2: document.querySelectorAll('.prose-editor h2').length,
      h3: document.querySelectorAll('.prose-editor h3').length,
      quote: document.querySelectorAll('.prose-editor blockquote').length,
      ul: document.querySelectorAll('.prose-editor ul li').length,
      ol: document.querySelectorAll('.prose-editor ol li').length,
      hr: document.querySelectorAll('.prose-editor hr').length,
      images: document.querySelectorAll('.editor-image img.editor-image__img').length,
      embedFrame: document.querySelectorAll('.editor-embed__frame iframe').length,
    }));
    report(afterReload.bold >= 1, 'reload: bold text survived', JSON.stringify(afterReload));
    report(afterReload.h2 >= 1 && afterReload.h3 >= 1, 'reload: heading + subheading survived', JSON.stringify(afterReload));
    report(afterReload.quote >= 1, 'reload: blockquote survived', JSON.stringify(afterReload));
    report(afterReload.ul >= 2, 'reload: bulleted list survived', JSON.stringify(afterReload));
    report(afterReload.ol >= 2, 'reload: numbered list survived', JSON.stringify(afterReload));
    report(afterReload.hr >= 1, 'reload: divider survived', JSON.stringify(afterReload));
    report(afterReload.images === 2, 'reload: both images survived', JSON.stringify(afterReload));
    report(afterReload.embedFrame >= 1, 'reload: embed survived', JSON.stringify(afterReload));

    await page.goto(`${BASE}/admin/stories/${mixed.id}/preview/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(500);
    const previewCounts = await page.evaluate(() => ({
      images: document.querySelectorAll('img').length,
      iframe: document.querySelectorAll('iframe').length,
      list: document.querySelectorAll('ul li, ol li').length,
    }));
    report(previewCounts.images >= 2, 'preview: both images render', JSON.stringify(previewCounts));
    report(previewCounts.iframe >= 1, 'preview: embed renders', JSON.stringify(previewCounts));
    report(previewCounts.list >= 4, 'preview: lists render', JSON.stringify(previewCounts));

    await page.goto(`${BASE}/admin/stories/${mixed.id}/edit/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.prose-editor', { timeout: 15_000 });
    await page.click('button:has-text("Publish")');
    await page.waitForTimeout(2000);
    const conflictShown = await page.locator('.editor-conflict').isVisible().catch(() => false);
    report(!conflictShown, 'publish: mixed-content document publishes without a conflict/error banner');

    report(consoleErrors.length === 0, 'mixed-content flow: no browser console/page errors', consoleErrors.join(' | '));
    await page.close();
  }

  // ---------- manual save races a pending autosave ----------
  {
    const s = await freshStory('observe');
    const page = await browser.newPage();
    await page.goto(`${BASE}/admin/stories/${s.id}/edit/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.prose-editor', { timeout: 15_000 });
    await page.fill('#editor-title', 'Race Title');
    await page.click('.prose-editor');
    await page.keyboard.type('Typed just before the manual save.');
    // Autosave debounces 1.5s; click Save well inside that window so the two overlap.
    await page.waitForTimeout(300);
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(2000);
    const status = await page.locator('.editor-status').innerText().catch(() => '?');
    report(/Saved/i.test(status), 'manual save during a pending autosave resolves to Saved, not stuck', status);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prose-editor', { timeout: 15_000 });
    const titleAfter = await page.inputValue('#editor-title').catch(() => '');
    const bodyAfter = await page.locator('.prose-editor').innerText().catch(() => '');
    report(titleAfter === 'Race Title', 'title from the race survived reload', titleAfter);
    report(bodyAfter.includes('Typed just before the manual save.'), 'body text from the race survived reload', bodyAfter);
    await page.close();
  }

  // ---------- stale revision (409 conflict) is shown and recoverable ----------
  {
    const s = await freshStory('observe');
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await pageA.goto(`${BASE}/admin/stories/${s.id}/edit/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await pageA.waitForSelector('.prose-editor', { timeout: 15_000 });
    await pageB.goto(`${BASE}/admin/stories/${s.id}/edit/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await pageB.waitForSelector('.prose-editor', { timeout: 15_000 });

    // Tab A saves first and advances the server's revision.
    await pageA.fill('#editor-title', 'Tab A wins the race');
    await pageA.click('button:has-text("Save")');
    await pageA.waitForTimeout(1200);
    const statusA = await pageA.locator('.editor-status').innerText().catch(() => '?');
    report(/Saved/i.test(statusA), 'tab A (first writer) saves cleanly', statusA);

    // Tab B still holds the old revision; its save must be rejected as a conflict, not silently overwrite A.
    await pageB.fill('#editor-title', 'Tab B is now stale');
    await pageB.click('button:has-text("Save")');
    await pageB.waitForTimeout(1200);
    const conflictVisible = await pageB.locator('.editor-conflict').isVisible().catch(() => false);
    report(conflictVisible, 'tab B (stale writer) is shown a conflict banner, not a silent failure or overwrite');

    if (conflictVisible) {
      await pageB.click('.editor-conflict button:has-text("Load server version")');
      await pageB.waitForTimeout(500);
      const titleB = await pageB.inputValue('#editor-title').catch(() => '');
      report(titleB === 'Tab A wins the race', 'resolving the conflict loads the real current server content', titleB);
      const statusB = await pageB.locator('.editor-status').innerText().catch(() => '?');
      report(statusB !== 'Save failed' && !/error/i.test(statusB), 'editor is usable again after resolving the conflict', statusB);
    }

    await pageA.close();
    await pageB.close();
  }

  // ---------- an invalid embed link is rejected before it ever reaches save ----------
  {
    const s = await freshStory('observe');
    const page = await browser.newPage();
    const saveResponses = [];
    page.on('response', (r) => {
      if (r.url().includes('/draft/') && r.request().method() === 'PUT') saveResponses.push(r.status());
    });
    await page.goto(`${BASE}/admin/stories/${s.id}/edit/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.prose-editor', { timeout: 15_000 });
    await page.fill('#editor-title', 'Bad Embed');
    await page.click('.prose-editor');
    await page.keyboard.type('/embed');
    await insertViaSlash(page, 'Embed');
    await page.waitForSelector('.editor-embed__input', { timeout: 5000 });
    await page.fill('.editor-embed__input', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const errorShown = await page.locator('.editor-embed__error').isVisible().catch(() => false);
    report(errorShown, 'http:// embed link is rejected inline, in the editor, before save');
    const stillLiveFrame = await page.locator('.editor-embed__frame iframe').count();
    report(stillLiveFrame === 0, 'rejected embed never renders as if it had succeeded');

    await page.click('button:has-text("Save")');
    await page.waitForTimeout(1200);
    report(saveResponses.every((s) => s === 200), 'the rejected URL never reached the server as a failing save', JSON.stringify(saveResponses));
    await page.close();
  }
} finally {
  await browser.close();
  if (!exited) dev.kill('SIGTERM');
  rmSync(join(tmpdir(), 'editor-regression-edit.png'), { force: true });
  rmSync(join(tmpdir(), 'editor-regression-preview.png'), { force: true });
  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log(problems ? `\n${problems} problem(s)` : '\nAll editor regression checks passed');
process.exit(problems ? 1 : 0);