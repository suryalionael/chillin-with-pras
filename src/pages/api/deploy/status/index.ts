import type { APIRoute } from 'astro';
import { getEnv } from '../../../../lib/cms/runtime.ts';
import { authorizeDeployToken, markDeploymentStatus, type DeploymentStatus, type D1Like } from '../../../../lib/cms/deploy.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';
import { readJson } from '../../../../lib/cms/api.ts';

// Build-facing status callback: the CI workflow reports building/deployed/failed
// for the revision it built. Authenticated with the pipeline bearer token.
export const prerender = false;

const STATUSES: DeploymentStatus[] = ['deploy_requested', 'building', 'deployed', 'failed'];

/** POST /api/deploy/status/  Authorization: Bearer <CMS_PIPELINE_TOKEN> */
export const POST: APIRoute = async ({ request }) => {
  const env = await getEnv();
  const auth = authorizeDeployToken(env as Parameters<typeof authorizeDeployToken>[0], request);
  if (!auth.ok) {
    const code = auth.status === 503 ? 'not_configured' : 'unauthorized';
    return jsonError(auth.status, code, auth.message);
  }

  const body = await readJson(request, 8_192);
  if (!body.ok) return body.response;
  const v = body.value as { revision?: unknown; status?: unknown; buildId?: unknown; error?: unknown } | null;
  if (!v || typeof v !== 'object') return jsonError(400, 'bad_request', 'Expected a JSON object.');
  if (!Number.isInteger(v.revision) || (v.revision as number) < 1) return jsonError(422, 'validation', 'revision must be a positive integer.');
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status as DeploymentStatus)) {
    return jsonError(422, 'validation', 'status must be one of deploy_requested|building|deployed|failed.');
  }
  if (v.buildId !== undefined && typeof v.buildId !== 'string') return jsonError(422, 'validation', 'buildId must be a string.');
  if (v.error !== undefined && typeof v.error !== 'string') return jsonError(422, 'validation', 'error must be a string.');

  try {
    const result = await markDeploymentStatus(env.DB as unknown as D1Like, {
      revision: v.revision as number,
      status: v.status as DeploymentStatus,
      buildId: v.buildId as string | undefined,
      error: v.error as string | undefined,
    });
    if (!result.ok) return jsonError(404, 'not_found', 'No deployment exists for that revision.');
    return new Response(JSON.stringify({ ok: true, deployment: result.deployment }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    console.error('deployment status update failed', e instanceof Error ? e.message : e);
    return jsonError(500, 'internal', 'Could not record the deployment status.');
  }
};