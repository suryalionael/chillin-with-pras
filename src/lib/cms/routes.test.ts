// Structural guarantees about which routes are dynamic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = fileURLToPath(new URL('../../pages/', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(PAGES).map((f) => relative(PAGES, f));
const adminFiles = files.filter((f) => /^(api\/)?admin(\/|\.)/.test(f) || f.startsWith('api/'));

// Public dynamic routes that are intentionally server-rendered (not part of admin/API)
const publicDynamicRoutes = new Set(['images/[id].ts']);

test('there are admin and API routes to check', () => {
  assert.ok(adminFiles.length >= 8, adminFiles.join(', '));
});

test('every /admin and /api route opts out of prerendering', () => {
  for (const f of adminFiles) {
    const src = readFileSync(join(PAGES, f), 'utf8');
    assert.match(src, /export\s+const\s+prerender\s*=\s*false\s*;/, `${f} must export const prerender = false`);
  }
});

test('nothing outside /admin and /api opts out of prerendering (the public site stays static)', () => {
  for (const f of files.filter((file) => !adminFiles.includes(file) && !publicDynamicRoutes.has(file))) {
    const src = readFileSync(join(PAGES, f), 'utf8');
    assert.doesNotMatch(src, /prerender\s*=\s*false/, `${f} would make a public route dynamic`);
  }
});

test('every API handler authorizes independently of the middleware', () => {
  for (const f of files.filter((file) => file.startsWith('api/admin/'))) {
    const src = readFileSync(join(PAGES, f), 'utf8');
    assert.match(src, /adminEndpoint\(|authorizeAdminRequest\(/, `${f} must call adminEndpoint()/authorizeAdminRequest()`);
  }
});

test('admin pages that change state re-check authorization on POST', () => {
  const src = readFileSync(join(PAGES, 'admin/stories/new.astro'), 'utf8');
  assert.match(src, /authorizeAdminRequest\(/);
});