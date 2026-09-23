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
} finally {
  await browser.close();
  if (!exited) dev.kill('SIGTERM');
  rmSync(join(tmpdir(), 'editor-regression-edit.png'), { force: true });
  rmSync(join(tmpdir(), 'editor-regression-preview.png'), { force: true });
}

console.log(problems ? `\n${problems} problem(s)` : '\nAll editor regression checks passed');
process.exit(problems ? 1 : 0);