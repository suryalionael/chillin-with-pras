import type { APIRoute } from 'astro';
import { adminEndpoint, failureResponse, isUuid, json, notFound, readJson } from '../../../../../lib/cms/api.ts';
import { saveDraft } from '../../../../../lib/cms/db.ts';
import { isLegacySlug } from '../../../../../lib/cms/legacy-slugs.ts';
import { isSection } from '../../../../../lib/cms/schema.ts';
import { jsonError } from '../../../../../lib/cms/guard.ts';

export const prerender = false;

/**
 * Autosave.
 *
 *   PUT /api/admin/stories/:id/draft/
 *   { "baseRev": 7, "document": <StoryDocument>, "section"?: "observe"|"show", "slug"?: string|null }
 *
 *   200 { draftRev: 8, draftUpdatedAt }        saved; use draftRev as the next baseRev
 *   409 { error: { code: "conflict", currentRev } }   another tab saved newer work; nothing was written
 *   409 { error: { code: "slug_taken" | "locked" } }
 *   422 { error: { code: "validation", issues } }
 */
export const PUT: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, request }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();

    const body = await readJson(request);
    if (!body.ok) return body.response;
    const v = body.value as { baseRev?: unknown; document?: unknown; section?: unknown; slug?: unknown } | null;
    if (!v || typeof v !== 'object') return jsonError(400, 'bad_request', 'Expected a JSON object.');
    if (!Number.isInteger(v.baseRev) || (v.baseRev as number) < 1) return jsonError(422, 'validation', 'baseRev must be a positive integer.');
    if (v.section !== undefined && !isSection(v.section)) return jsonError(422, 'validation', 'section must be "observe" or "show".');
    if (v.slug !== undefined && v.slug !== null && typeof v.slug !== 'string') return jsonError(422, 'validation', 'slug must be a string or null.');

    const result = await saveDraft(
      db,
      id,
      { baseRev: v.baseRev as number, document: v.document, section: v.section as 'observe' | 'show' | undefined, slug: v.slug as string | null | undefined },
      { isSlugReserved: isLegacySlug },
    );
    return result.ok ? json({ draftRev: result.draftRev, draftUpdatedAt: result.draftUpdatedAt }) : failureResponse(result);
  });
