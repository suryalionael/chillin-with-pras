import type { APIRoute } from 'astro';
import { getEnv } from '../../../../lib/cms/runtime.ts';
import { authorizeDeployToken, type D1Like } from '../../../../lib/cms/deploy.ts';
import { shipPublishedSnapshot, type GithubPublishEnv } from '../../../../lib/cms/github-publish.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';

export const prerender = false;

/**
 * Manual escape hatch: re-ships the current published-content snapshot to
 * GitHub regardless of what triggered the need — a failed publish/delete
 * ship that was never retried, or content that changed before this endpoint
 * (and the auto-ship-on-delete behavior) existed. Authenticated with the
 * same pipeline bearer token as the other build-facing endpoints, since it's
 * meant to be callable from outside an admin browser session too.
 *
 *   POST /api/deploy/resync/  Authorization: Bearer <CMS_PIPELINE_TOKEN>
 *   200 { build: { revision, status, requested, error? } }
 */
export const POST: APIRoute = async ({ request }) => {
  const env = await getEnv();
  const auth = authorizeDeployToken(env as Parameters<typeof authorizeDeployToken>[0], request);
  if (!auth.ok) {
    const code = auth.status === 503 ? 'not_configured' : 'unauthorized';
    return jsonError(auth.status, code, auth.message);
  }

  const db = env.DB as unknown as D1Like;
  const build = await shipPublishedSnapshot(db, env as unknown as GithubPublishEnv, {
    storyId: 'manual-resync',
    publishedAt: new Date().toISOString(),
    slug: null,
    title: 'Manual resync',
  });

  return new Response(JSON.stringify({ build }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
