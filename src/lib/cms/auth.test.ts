import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWK } from 'jose';
import {
  ACCESS_JWT_HEADER,
  createAccessAuthenticator,
  createDevAuthenticator,
  isAdminEmail,
  resolveAuthenticator,
  type AuthEnv,
} from './auth.ts';
import { authorizeAdminRequest, isAdminPath, isAdminRoutePattern, isSameOrigin } from './guard.ts';

const ADMIN = 'suryalionael@gmail.com';
const TEAM = 'chillin.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const ENV: AuthEnv = { ADMIN_EMAIL: ADMIN, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

const keys = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const getKey = createLocalJWKSet({ keys: [jwk] });

async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number; alg?: string } = {}) {
  return new SignJWT({ email: ADMIN, type: 'app', ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? keys.privateKey);
}
const req = (jwt?: string, url = 'https://www.chillinwithpras.com/api/admin/stories/', init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { ...(jwt ? { [ACCESS_JWT_HEADER]: jwt } : {}), ...(init.headers as Record<string, string>) } });
const auth = (env: AuthEnv = ENV) => createAccessAuthenticator(env, { getKey });

test('valid token for the admin is authorized', async () => {
  const r = await auth().authenticate(req(await token()));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.identity, { email: ADMIN, source: 'cloudflare-access' });
});

test('email match is case-insensitive but otherwise exact', async () => {
  assert.equal((await auth().authenticate(req(await token({ email: 'SuryaLionael@Gmail.com' })))).ok, true);
  for (const bad of ['suryalionael@gmail.com.evil.com', 'evil+suryalionael@gmail.com', 'x@suryalionael@gmail.com', 'suryalionael@gmail.co', 'surya.lionael@gmail.com', '']) {
    const r = await auth().authenticate(req(await token({ email: bad })));
    assert.equal(r.ok, false, bad);
  }
});

test('a valid token for a different account is 403', async () => {
  const r = await auth().authenticate(req(await token({ email: 'someone@else.com' })));
  assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.code], [false, 403, 'forbidden']);
});

test('service-token style JWT without an email claim is rejected', async () => {
  const jwt = await new SignJWT({ common_name: 'svc' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(`https://${TEAM}`).setAudience(AUD).setExpirationTime('5m').sign(keys.privateKey);
  const r = await auth().authenticate(req(jwt));
  assert.equal(r.ok, false);
});

test('missing header is 401', async () => {
  const r = await auth().authenticate(req());
  assert.deepEqual([r.ok, !r.ok && r.status], [false, 401]);
});

test('forged / invalid tokens are 401', async () => {
  const cases: Record<string, string> = {
    'signed with an unknown key': await token({}, { key: other.privateKey }),
    'wrong audience': await token({}, { aud: 'someone-elses-app' }),
    'wrong issuer': await token({}, { iss: 'https://evil.cloudflareaccess.com' }),
    expired: await token({}, { exp: Math.floor(Date.now() / 1000) - 60 }),
    garbage: 'not.a.jwt',
    'alg none': `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=/g, '')}.${btoa(JSON.stringify({ email: ADMIN, iss: `https://${TEAM}`, aud: AUD, exp: 9999999999 })).replace(/=/g, '')}.`,
  };
  for (const [name, jwt] of Object.entries(cases)) {
    const r = await auth().authenticate(req(jwt));
    assert.deepEqual([name, r.ok, !r.ok && r.status], [name, false, 401]);
  }
});

test('HS256 token signed with the public key as secret (algorithm confusion) is rejected', async () => {
  const secret = new TextEncoder().encode(JSON.stringify(jwk));
  const jwt = await new SignJWT({ email: ADMIN }).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).setIssuer(`https://${TEAM}`).setAudience(AUD).setExpirationTime('5m').sign(secret);
  const r = await auth().authenticate(req(jwt));
  assert.equal(r.ok, false);
});

test('missing or malformed configuration fails closed (503)', async () => {
  for (const env of [
    {},
    { ...ENV, ADMIN_EMAIL: '' },
    { ...ENV, ACCESS_AUD: '' },
    { ...ENV, ACCESS_TEAM_DOMAIN: '' },
    { ...ENV, ACCESS_TEAM_DOMAIN: 'evil.example.com' },
    { ...ENV, ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com.evil.com' },
  ]) {
    const r = await auth(env).authenticate(req(await token()));
    assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.code], [false, 503, 'not_configured'], JSON.stringify(env));
  }
});

test('dev bypass: only under DEV, only when opted in, only on loopback', async () => {
  const bypass: AuthEnv = { ADMIN_EMAIL: ADMIN, DEV_ADMIN_BYPASS: 'true' };
  const local = new Request('http://localhost:4321/admin/');
  // production build (isDev=false): the opt-in variable is ignored
  assert.equal((await resolveAuthenticator(bypass, false).authenticate(local)).ok, false);
  // dev without opt-in: still denied
  assert.equal((await resolveAuthenticator({ ADMIN_EMAIL: ADMIN }, true).authenticate(local)).ok, false);
  // dev + opt-in + loopback: allowed
  const ok = await resolveAuthenticator(bypass, true).authenticate(local);
  assert.equal(ok.ok, true);
  // dev + opt-in but reached through a non-loopback host: denied
  assert.equal((await createDevAuthenticator(bypass).authenticate(new Request('http://192.168.1.20:4321/admin/'))).ok, false);
  assert.equal((await createDevAuthenticator(bypass).authenticate(new Request('https://www.chillinwithpras.com/admin/'))).ok, false);
});

test('isAdminEmail rejects empty and non-string', () => {
  assert.equal(isAdminEmail(undefined, ADMIN), false);
  assert.equal(isAdminEmail('', ''), false);
  assert.equal(isAdminEmail(ADMIN, ''), false);
});

test('isAdminPath protects admin surfaces regardless of encoding, case or slashes', () => {
  for (const p of ['/admin', '/admin/', '/admin/stories/1/edit/', '/api/admin/stories/', '/Admin/', '/ADMIN', '//admin/', '/x/../admin/', '/%61dmin/', '/api//admin/x', '/admin%2Fstories', '/api/%41dmin/', '/admin\\stories', '/%zzadmin']) {
    assert.equal(isAdminPath(p), true, p);
  }
  for (const p of ['/', '/to-observe-and-report/the-wall/', '/administration/', '/api/other/', '/adminx', '/to-show-and-tell/']) {
    assert.equal(isAdminPath(p), false, p);
  }
  assert.equal(isAdminRoutePattern('/admin/stories/[id]/edit'), true);
  assert.equal(isAdminRoutePattern('/api/admin/stories'), true);
  assert.equal(isAdminRoutePattern('/to-observe-and-report/[slug]'), false);
});

test('authorizeAdminRequest: needs locals.admin AND matching configured email', () => {
  const get = new Request('https://x.test/api/admin/stories/');
  assert.equal(authorizeAdminRequest({ locals: {}, request: get }, ADMIN).ok, false);
  const forged = { locals: { admin: { email: 'evil@x.com', source: 'cloudflare-access' as const } }, request: get };
  assert.equal(authorizeAdminRequest(forged, ADMIN).ok, false);
  const good = { locals: { admin: { email: ADMIN, source: 'cloudflare-access' as const } }, request: get };
  assert.equal(authorizeAdminRequest(good, ADMIN).ok, true);
  assert.equal(authorizeAdminRequest(good, undefined).ok, false);
});

test('state-changing requests must be same-origin', () => {
  const admin = { email: ADMIN, source: 'cloudflare-access' as const };
  const post = (headers: Record<string, string>) => new Request('https://www.chillinwithpras.com/api/admin/stories/', { method: 'POST', headers });
  assert.equal(isSameOrigin(post({ origin: 'https://www.chillinwithpras.com' })), true);
  assert.equal(isSameOrigin(post({ origin: 'https://evil.example' })), false);
  assert.equal(isSameOrigin(post({ 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(authorizeAdminRequest({ locals: { admin }, request: post({ origin: 'https://evil.example' }) }, ADMIN).ok, false);
  assert.equal(authorizeAdminRequest({ locals: { admin }, request: post({ origin: 'https://www.chillinwithpras.com' }) }, ADMIN).ok, true);
});
