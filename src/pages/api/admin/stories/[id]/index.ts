import type { APIRoute } from 'astro';
import { adminEndpoint, isUuid, json, notFound, storyJson } from '../../../../../lib/cms/api.ts';
import { deleteDraft, getStory } from '../../../../../lib/cms/db.ts';
import { jsonError } from '../../../../../lib/cms/guard.ts';

export const prerender = false;

/** GET /api/admin/stories/:id/  ->  { story }  (includes the working draft and its revision) */
export const GET: APIRoute = (context) =>
  adminEndpoint(context, async ({ db }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();
    const story = await getStory(db, id);
    return story ? json({ story: storyJson(story) }) : notFound();
  });

/** DELETE /api/admin/stories/:id/  ->  204. Never-published drafts only. */
export const DELETE: APIRoute = (context) =>
  adminEndpoint(context, async ({ db }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();
    const r = await deleteDraft(db, id);
    if (r.ok) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    return r.reason === 'published'
      ? jsonError(409, 'published', 'A published story cannot be deleted.')
      : notFound();
  });
