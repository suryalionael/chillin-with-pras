import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/cms/runtime.ts';
import { type D1Like } from '../../lib/cms/db.ts';
import { isUuid } from '../../lib/cms/api.ts';

export const prerender = false;

/**
 * GET /images/:id
 * Public image delivery for CMS images.
 * Returns the image from R2 with cache headers.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!isUuid(id)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const env = await getEnv();
    const db = env.DB as unknown as D1Like;

    const row = await db
      .prepare('SELECT r2_original, mime, width, height, filename FROM images WHERE id = ?')
      .bind(id)
      .first<{ r2_original: string; mime: string; width: number; height: number; filename: string }>();

    if (!row) {
      return new Response('Not found', { status: 404 });
    }

    const object = await env.MEDIA.get(row.r2_original);
    if (!object) {
      console.error(`R2 object missing for image ${id}: ${row.r2_original}`);
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', row.mime);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year, immutable
    headers.set('Content-Length', String(object.size));

    return new Response(object.body, { headers });
  } catch (e) {
    console.error('Image retrieval error', e);
    return new Response('Internal error', { status: 500 });
  }
};