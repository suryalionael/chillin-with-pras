import type { APIRoute } from 'astro';
import { adminEndpoint, failureResponse, isUuid, json, notFound, readJson, storyJson } from '../../../../../lib/cms/api.ts';
import { publishStory } from '../../../../../lib/cms/db.ts';
import { isLegacySlug } from '../../../../../lib/cms/legacy-slugs.ts';
import { jsonError } from '../../../../../lib/cms/guard.ts';
import { buildPublishedSnapshot, markDeploymentStatus, nextRevision, requestDeployment } from '../../../../../lib/cms/deploy.ts';
import { publishSnapshotToGithub, type GithubPublishEnv } from '../../../../../lib/cms/github-publish.ts';

export const prerender = false;

/**
 * Publish (or republish) the working draft.
 *
 *   POST /api/admin/stories/:id/publish/
 *   { "baseRev": 8, "publishedAt"?: "YYYY-MM-DD", "slug"?: string }
 *
 * baseRev must equal the current draft revision: you publish exactly what you last saw.
 * Copies draft -> published snapshot atomically, records a durable deployment request
 * (monotonic revision), then ships that revision straight to the live site by committing
 * the published snapshot + any new referenced images to `.cms/` on `main` (GitHub's Git
 * Data API — see github-publish.ts). That push is what the `deploy-pages` GitHub Actions
 * workflow rebuilds and deploys from. No local step, no separate CI trigger.
 *
 *   200 { story, build: { revision, status, requested, error? } }
 *   409 conflict | slug_taken | locked      422 validation (missing title/content/alt text…)
 *
 * Publishing the CMS snapshot and shipping it to GitHub are separate events. If either the
 * revision bookkeeping or the GitHub push fails, the publish still stands (content is
 * authoritative) — this just reports that the site was not updated, so retrying is safe
 * and never risks the CMS's own record of what's published.
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

    // Content is now published. Record a durable deployment request, then try to
    // ship it immediately. If the revision bookkeeping itself fails, report that
    // no deployment was requested rather than pretending one was.
    let build: { revision: number | null; status: string; requested: boolean; error: string | null };
    try {
      const revision = await nextRevision(db);
      await requestDeployment(db, {
        revision,
        storyId: result.story.id,
        publishedAt: result.story.publishedAt ?? result.story.pubUpdatedAt ?? new Date().toISOString(),
        payload: { slug: result.story.slug, title: result.story.draft.title },
      });

      const snapshot = await buildPublishedSnapshot(db);
      const shipped = await publishSnapshotToGithub(env as unknown as GithubPublishEnv, db, snapshot);
      if (shipped.ok) {
        await markDeploymentStatus(db, { revision, status: 'deployed', buildId: shipped.commitSha });
        build = { revision, status: 'deployed', requested: true, error: null };
      } else if (shipped.skipped) {
        build = { revision, status: 'deploy_requested', requested: true, error: null };
      } else {
        await markDeploymentStatus(db, { revision, status: 'failed', error: shipped.reason });
        build = { revision, status: 'failed', requested: true, error: shipped.reason };
      }
    } catch (e) {
      console.error('deployment request failed after publish', e instanceof Error ? e.message : e);
      build = { revision: null, status: 'deploy_error', requested: false, error: 'Deployment request could not be recorded.' };
    }

    return json({ story: storyJson(result.story), build });
  });
