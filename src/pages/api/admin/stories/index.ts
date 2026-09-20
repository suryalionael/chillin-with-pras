import type { APIRoute } from 'astro';
import { adminEndpoint, json, readJson, storyJson } from '../../../../lib/cms/api.ts';
import { createStory, listStories, type Status } from '../../../../lib/cms/db.ts';
import { isSection } from '../../../../lib/cms/schema.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';

export const prerender = false;

/** GET /api/admin/stories/?status=draft|published  ->  { stories: StorySummary[] } */
export const GET: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, request }) => {
    const status = new URL(request.url).searchParams.get('status');
    if (status !== null && status !== 'draft' && status !== 'published') {
      return jsonError(400, 'bad_request', 'status must be "draft" or "published".');
    }
    return json({ stories: await listStories(db, status ? { status: status as Status } : {}) });
  });

/** POST /api/admin/stories/  { section?: "observe" | "show" }  ->  201 { story } (a new empty draft, revision 1) */
export const POST: APIRoute = (context) =>
  adminEndpoint(context, async ({ db, request }) => {
    let section: 'observe' | 'show' | undefined;
    if (request.headers.get('content-length') !== '0' && request.body) {
      const body = await readJson(request, 4_096);
      if (!body.ok) return body.response;
      const value = body.value as { section?: unknown } | null;
      if (value?.section !== undefined) {
        if (!isSection(value.section)) return jsonError(422, 'validation', 'section must be "observe" or "show".');
        section = value.section;
      }
    }
    return json({ story: storyJson(await createStory(db, { section })) }, 201);
  });
