import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSessionCookie, readSessionCookie, verifyAccessCode, logoutCookieHeader, isLoginLocked, SESSION_COOKIE } from './session.ts';
import { createTestDb } from './test-db.ts';

const SECRET = 's'.repeat(43);
const CODE = 'correct-horse-battery';

test('session: access code matches constant-time, wrong/empty fails', () => {
  const env = { CMS_ACCESS_CODE: CODE };
  assert.equal(verifyAccessCode(env, CODE), true);
  assert.equal(verifyAccessCode(env, 'wrong'), false);
  assert.equal(verifyAccessCode(env, CODE + 'x'), false);
  assert.equal(verifyAccessCode({}, CODE), false);
});

test('session: issue + read round trip for an allowlisted email', async () => {
  const env = { CMS_SESSION_SECRET: SECRET };
  const { name, value, header } = await issueSessionCookie(env, 'coauthor@example.com');
  assert.equal(name, SESSION_COOKIE);
  assert.match(header, /HttpOnly; SameSite=Strict/);
  const read = await readSessionCookie(env, value);
  assert.deepEqual(read, { ok: true, payload: { email: 'coauthor@example.com', source: 'access-code' } });
});

test('session: rejects missing, garbage, wrong secret, expired', async () => {
  const env = { CMS_SESSION_SECRET: SECRET };
  const other = { CMS_SESSION_SECRET: 'k'.repeat(43) };
  const good = (await issueSessionCookie(env, 'a@b.co')).value;
  assert.equal((await readSessionCookie(env, null)).ok, false);
  assert.equal((await readSessionCookie(env, 'garbage')).ok, false);
  assert.equal((await readSessionCookie(env, good)).ok, true);
  assert.equal((await readSessionCookie(other, good)).ok, false);

  // expired cookie
  const { SignJWT } = await import('jose');
  const past = Math.floor(Date.now() / 1000) - 10;
  const expired = await new SignJWT({ email: 'a@b.co', source: 'access-code' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(past - 100).setExpirationTime(past)
    .sign(new TextEncoder().encode(SECRET));
  const r = await readSessionCookie(env, expired);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'expired');
});

test('session: logout clears the cookie', () => {
  assert.match(logoutCookieHeader(), /Max-Age=0/);
});

test('session: rate limiter locks after too many failed attempts', async () => {
  const db = createTestDb();
  const email = 'writer@example.com';
  assert.equal(await isLoginLocked(db, email), false);
  const nowIso = new Date().toISOString();
  for (let i = 0; i < 10; i++) {
    await db.prepare('INSERT INTO access_attempts (email, attempted_at, succeeded, ip) VALUES (?, ?, 0, ?)').bind(email, nowIso, 'ip').run();
  }
  assert.equal(await isLoginLocked(db, email), true);
  // a different email is unaffected
  assert.equal(await isLoginLocked(db, 'other@example.com'), false);
});

test('session: successful attempts do not count toward the lock', async () => {
  const db = createTestDb();
  const email = 'writer2@example.com';
  const nowIso = new Date().toISOString();
  for (let i = 0; i < 10; i++) {
    await db.prepare('INSERT INTO access_attempts (email, attempted_at, succeeded, ip) VALUES (?, ?, 1, ?)').bind(email, nowIso, 'ip').run();
  }
  assert.equal(await isLoginLocked(db, email), false);
});