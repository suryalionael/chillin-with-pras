import type { APIRoute } from 'astro';
import { adminEndpoint, isUuid, json, notFound, storyJson } from '../../../../../lib/cms/api.ts';
import { deleteDraft, getStory } from '../../../../../lib/cms/db.ts';
import { shipPublishedSnapshot, type GithubPublishEnv } from '../../../../../lib/cms/github-publish.ts';

export const prerender = false;

/** GET /api/admin/stories/:id/  ->  { story }  (includes the working draft and its revision) */
export const GET: APIRoute = (context) =>
  adminEndpoint(context, async ({ db }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();
    const story = await getStory(db, id);
    return story ? json({ story: storyJson(story) }) : notFound();
  });

/**
 * DELETE /api/admin/stories/:id/  ->  204. Deletes the story (draft or published).
 *
 * Deleting a published story changes what should be live just as much as
 * publishing one does — the live site must stop showing it. So this ships an
 * updated snapshot (the database naturally excludes the just-deleted story
 * from it) the same way publishing does, best-effort: if shipping fails the
 * delete still stands, and the admin dashboard's Deployments section shows
 * the failure the same way a failed publish would.
 */
export const DELETE: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, env }) => {
    const id = context.params.id;
    if (!isUuid(id)) return notFound();

    const before = await getStory(db, id);
    if (!before) return notFound();

    const r = await deleteDraft(db, id);
    if (!r.ok) return notFound();

    if (before.status === 'published') {
      await shipPublishedSnapshot(db, env as unknown as GithubPublishEnv, {
        storyId: before.id,
        publishedAt: before.publishedAt ?? before.pubUpdatedAt ?? new Date().toISOString(),
        slug: before.slug,
        title: before.draft.title,
      });
    }

    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
