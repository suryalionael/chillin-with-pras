import type { APIRoute } from 'astro';
import { adminEndpoint, isUuid, json, notFound } from '../../../../../lib/cms/api.ts';
import { getPublishedStory } from '../../../../../lib/cms/db.ts';

export const prerender = false;

/**
 * GET /api/admin/stories/:id/published/  ->  { published: { id, section, slug, publishedAt, pubUpdatedAt, document } }
 * The immutable snapshot the public site is built from (never the working draft). 404 if never published.
 */
export const GET: APIRoute = (context) =>
  adminEndpoint(context, async ({ db }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();
    const published = await getPublishedStory(db, id);
    return published ? json({ published }) : notFound();
  });
