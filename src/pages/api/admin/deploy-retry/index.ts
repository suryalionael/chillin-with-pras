import type { APIRoute } from 'astro';
import { adminEndpoint, json } from '../../../../lib/cms/api.ts';
import type { D1Like } from '../../../../lib/cms/deploy.ts';
import { shipPublishedSnapshot, type GithubPublishEnv } from '../../../../lib/cms/github-publish.ts';

export const prerender = false;

/**
 * POST /api/admin/deploy-retry/
 *
 * The "Retry" action behind a failed publish/delete deployment. Re-ships the
 * current published-content snapshot — never re-runs publishStory/deleteDraft,
 * since the CMS-side mutation already succeeded; only getting it onto the
 * live site failed. Same admin session auth as every other editor action
 * (unlike /api/deploy/resync/, which is the bearer-token version of this for
 * callers outside a browser).
 */
export const POST: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, env }) => {
    const build = await shipPublishedSnapshot(db as unknown as D1Like, env as unknown as GithubPublishEnv, {
      storyId: 'manual-retry',
      publishedAt: new Date().toISOString(),
      slug: null,
      title: 'Manual retry',
    });
    return json({ build });
  });
