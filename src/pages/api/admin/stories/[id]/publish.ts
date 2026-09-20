import type { APIRoute } from 'astro';
import { adminEndpoint, failureResponse, isUuid, json, notFound, readJson, storyJson } from '../../../../../lib/cms/api.ts';
import { publishStory } from '../../../../../lib/cms/db.ts';
import { isLegacySlug } from '../../../../../lib/cms/legacy-slugs.ts';
import { jsonError } from '../../../../../lib/cms/guard.ts';

export const prerender = false;

/**
 * Publish (or republish) the working draft.
 *
 *   POST /api/admin/stories/:id/publish/
 *   { "baseRev": 8, "publishedAt"?: "YYYY-MM-DD", "slug"?: string }
 *
 * baseRev must equal the current draft revision: you publish exactly what you last saw.
 * Copies draft -> published snapshot atomically.
 *
 *   200 { story, build: { triggered: false } }
 *   409 conflict | slug_taken | locked      422 validation (missing title/content/alt text…)
 *
 * `build.triggered` is always false for now: rebuilding the static site on publish
 * (a Workers Builds deploy hook) is a later phase.
 */
export const POST: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, request }) => {
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
    return result.ok ? json({ story: storyJson(result.story), build: { triggered: false } }) : failureResponse(result);
  });
