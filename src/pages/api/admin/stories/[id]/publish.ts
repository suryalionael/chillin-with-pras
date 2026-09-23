import type { APIRoute } from 'astro';
import { adminEndpoint, failureResponse, isUuid, json, notFound, readJson, storyJson } from '../../../../../lib/cms/api.ts';
import { publishStory } from '../../../../../lib/cms/db.ts';
import { isLegacySlug } from '../../../../../lib/cms/legacy-slugs.ts';
import { jsonError } from '../../../../../lib/cms/guard.ts';
import { githubDispatchTrigger, nextRevision, requestDeployment } from '../../../../../lib/cms/deploy.ts';

export const prerender = false;

/**
 * Publish (or republish) the working draft.
 *
 *   POST /api/admin/stories/:id/publish/
 *   { "baseRev": 8, "publishedAt"?: "YYYY-MM-DD", "slug"?: string }
 *
 * baseRev must equal the current draft revision: you publish exactly what you last saw.
 * Copies draft -> published snapshot atomically, then records a durable deployment
 * request (monotonic revision) and fires the deploy trigger (best-effort).
 *
 *   200 { story, build: { triggered, revision, status, error? } }
 *   409 conflict | slug_taken | locked      422 validation (missing title/content/alt text…)
 *
 * Publishing the CMS snapshot and requesting the static deployment are separate
 * events. A trigger failure never undoes the publish (content is authoritative);
 * it is surfaced as `build.triggered=false` and the deployment row stays
 * `deploy_requested`.
 */
export const POST: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, env, request }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();

    const body = await readJson(request, 4_096);
    if (!body.ok) return body.response;
    const v = body.value as { baseRev?: unknown; publishedAt?: unknown; slug?: unknown } | null;
    if (!v || typeof v !== 'object') return jsonError(400, 'bad_request', 'Expected a JSON object.');
    if (!Number.isInteger(v.baseRev) || (v.baseRev as number) < 1) return jsonError(422, 'validation', 'baseRev must be a positive integer.');
    if (v.publishedAt !== undefined && typeof v.publishedAt !== 'string') return jsonError(422, 'validation', 'publishedAt must be YYYY-MM-DD.');
    if (v.slug !== undefined && typeof v.slug !== 'string') return jsonError(422, 'validation', 'slug must be a string.');

    const result = await publishStory(
      db,
      id,
      { baseRev: v.baseRev as number, publishedAt: v.publishedAt as string | undefined, slug: v.slug as string | undefined },
      { isSlugReserved: isLegacySlug },
    );
    if (!result.ok) return failureResponse(result);

    // Content is now published. Record a durable deployment request. If this
    // bookkeeping fails, the publish stands and we report that no deployment
    // was requested rather than pretending one was.
    let build: { triggered: boolean; revision: number | null; status: string; requested: boolean; error: string | null };
    try {
      const revision = await nextRevision(db);
      const deployment = await requestDeployment(db, {
        revision,
        storyId: result.story.id,
        publishedAt: result.story.publishedAt ?? result.story.pubUpdatedAt ?? new Date().toISOString(),
        payload: { slug: result.story.slug, title: result.story.draft.title },
      });
      const trigger = await githubDispatchTrigger(env as Parameters<typeof githubDispatchTrigger>[0], deployment);
      build = {
        triggered: trigger.ok,
        revision,
        status: 'deploy_requested',
        requested: true,
        error: trigger.ok ? null : trigger.reason,
      };
    } catch (e) {
      console.error('deployment request failed after publish', e instanceof Error ? e.message : e);
      build = { triggered: false, revision: null, status: 'deploy_error', requested: false, error: 'Deployment request could not be recorded.' };
    }

    return json({ story: storyJson(result.story), build });
  });