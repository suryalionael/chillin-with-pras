import type { APIRoute } from 'astro';
import { adminEndpoint, json } from '../../../../lib/cms/api.ts';
import { insertImage, type ImageRecord } from '../../../../lib/cms/db.ts';
import type { D1Like } from '../../../../lib/cms/db.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';

export const prerender = false;

const MAX_UPLOAD_BYTES = 20_000_000; // 20MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getExtension(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/**
 * GET /api/admin/images/
 * Returns { images: ImageRecord[] }
 */
export const GET: APIRoute = (context) =>
  adminEndpoint(context, async (call: { db: D1Like }) => {
    const { results } = await call.db
      .prepare('SELECT id, r2_original, variants, width, height, bytes, mime, sha256, filename, created_at FROM images ORDER BY created_at DESC')
      .all<{ id: string; r2_original: string; variants: string; width: number; height: number; bytes: number; mime: string; sha256: string; filename: string; created_at: string }>();
    return json({ images: results });
  });

/**
 * POST /api/admin/images/
 * multipart/form-data with field "file"
 * Returns { image: ImageRecord }
 */
export const POST: APIRoute = (context) =>
  adminEndpoint(context, async (call: { db: D1Like; env: Cloudflare.Env; request: Request }) => {
    const contentType = call.request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      return jsonError(415, 'unsupported_media_type', 'Send multipart/form-data with a "file" field.');
    }

    const formData = await call.request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return jsonError(400, 'bad_request', 'Missing "file" field.');
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(413, 'too_large', `File exceeds ${MAX_UPLOAD_BYTES} bytes.`);
    }

    const mime = file.type;
    if (!ALLOWED_MIMES.includes(mime as 'image/jpeg' | 'image/png' | 'image/webp')) {
      return jsonError(415, 'unsupported_media_type', 'Supported types: JPEG, PNG, WebP.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const hash = await sha256Hex(arrayBuffer);

    // Check for existing image by hash (deduplication)
    const existing = await call.db.prepare('SELECT id FROM images WHERE sha256 = ?').bind(hash).first<{ id: string }>();
    if (existing) {
      return json({ image: { id: existing.id, duplicate: true } });
    }

    const id = crypto.randomUUID();
    const ext = getExtension(mime);
    const r2Key = `images/${id}.${ext}`;

    // Upload to R2
    try {
      await call.env.MEDIA.put(r2Key, arrayBuffer, {
        httpMetadata: { contentType: mime },
        customMetadata: { sha256: hash, originalFilename: file.name },
      });
    } catch (e) {
      console.error('R2 upload failed', e);
      return jsonError(500, 'storage_error', 'Failed to store image.');
    }

    // Get image dimensions (we'll store basic info; actual dimensions could be read from file)
    // For now, use placeholder - in production you'd read actual dimensions
    const width = 0;
    const height = 0;

    const imageRecord: Omit<ImageRecord, 'id'> = {
      r2Original: r2Key,
      variants: [],
      width,
      height,
      bytes: file.size,
      mime: mime as 'image/jpeg' | 'image/png' | 'image/webp',
      sha256: hash,
      filename: file.name,
    };

    await insertImage(call.db, { ...imageRecord, id });

    return json({ image: imageRecord });
  });