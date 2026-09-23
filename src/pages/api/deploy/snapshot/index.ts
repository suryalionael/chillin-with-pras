import type { APIRoute } from 'astro';
import { getEnv } from '../../../../lib/cms/runtime.ts';
import { authorizeDeployToken, buildPublishedSnapshot, type D1Like } from '../../../../lib/cms/deploy.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';

// Public-facing deploy endpoint that serves the exact published-content
// snapshot the static build consumes. It is NOT part of /api/admin (the CI
// runner holds no Cloudflare Access identity), so it authenticates with its
// own bearer token. It only ever emits published (pub_doc) content.
export const prerender = false;

/** GET /api/deploy/snapshot/  Authorization: Bearer <CMS_PIPELINE_TOKEN> */
export const GET: APIRoute = async ({ request }) => {
  const env = await getEnv();
  const auth = authorizeDeployToken(env as Parameters<typeof authorizeDeployToken>[0], request);
  if (!auth.ok) {
    const code = auth.status === 503 ? 'not_configured' : 'unauthorized';
    return jsonError(auth.status, code, auth.message);
  }

  try {
    const snapshot = await buildPublishedSnapshot(env.DB as unknown as D1Like);
    return new Response(JSON.stringify(snapshot), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    console.error('snapshot generation failed', e instanceof Error ? e.message : e);
    return jsonError(500, 'snapshot_error', 'Could not generate the published-content snapshot.');
  }
};