import type { APIRoute } from 'astro';
import { adminEndpoint, json } from '../../../../lib/cms/api.ts';
import { getDeploymentByRevision, type D1Like } from '../../../../lib/cms/deploy.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';

export const prerender = false;

/**
 * GET /api/admin/deploy-status/?revision=N
 *
 * Polled by the editor and the story gallery right after a publish or delete
 * so they can show "Deploying…" then "Live"/"Deployment failed" instead of a
 * static "give it a couple of minutes" message. `revision` is the number the
 * publish/delete response already returned as `build.revision`.
 */
export const GET: APIRoute = (context) =>
  adminEndpoint(context, async ({ db }) => {
    const raw = new URL(context.request.url).searchParams.get('revision');
    const revision = raw === null ? NaN : Number(raw);
    if (!Number.isInteger(revision) || revision < 1) {
      return jsonError(422, 'validation', 'revision must be a positive integer.');
    }
    const deployment = await getDeploymentByRevision(db as unknown as D1Like, revision);
    if (!deployment) return jsonError(404, 'not_found', 'No deployment exists for that revision.');
    return json({
      revision: deployment.revision,
      status: deployment.status,
      buildId: deployment.buildId,
      error: deployment.error,
      requestedAt: deployment.requestedAt,
      deployedAt: deployment.deployedAt,
      failedAt: deployment.failedAt,
    });
  });
