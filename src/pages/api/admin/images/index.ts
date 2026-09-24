import type { APIRoute } from 'astro';
import { adminEndpoint, json } from '../../../../lib/cms/api.ts';
import { insertImage, type ImageRecord } from '../../../../lib/cms/db.ts';
import type { D1Like } from '../../../../lib/cms/db.ts';
import { jsonError } from '../../../../lib/cms/guard.ts';
import { readImageInfo } from '../../../../lib/cms/image-info.ts';

export const prerender = false;

const MAX_UPLOAD_BYTES = 20_000_000; // 20MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

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
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

/**
 * The minimal R2 surface the upload handler needs (put + delete for cleanup),
 * so the endpoint is exercised against a fake media in tests.
 */
export interface MediaLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/**
 * POST /api/admin/images/ — the real upload handling, factored so tests hit the
 * same code the route runs (same validation, real D1 schema, real sharp checks).
 */
export async function handleImageUpload(call: { db: D1Like; media: MediaLike; request: Request }): Promise<Response> {
  const { db, media, request } = call;
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return jsonError(415, 'unsupported_media_type', 'Send multipart/form-data with a "file" field.');
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return jsonError(400, 'bad_request', 'Missing "file" field.');
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, 'too_large', `File exceeds ${MAX_UPLOAD_BYTES} bytes.`);
  }

  const declaredMime = file.type;
  if (!ALLOWED_MIMES.includes(declaredMime as (typeof ALLOWED_MIMES)[number])) {
    return jsonError(415, 'unsupported_media_type', 'Supported types: JPEG, PNG, WebP, GIF.');
  }

  const bytes = await file.arrayBuffer();
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // Read the real image header: a renamed text file, malformed binary, or a
  // format/MIME mismatch must be rejected regardless of what the browser
  // claimed. `readImageInfo` derives width/height and the detected MIME from
  // the file's actual JPEG/PNG/WebP structure — it runs in the Worker runtime
  // (workerd), where the native `sharp` binary is unavailable.

  let info;
  try {
    info = readImageInfo(buffer);
  } catch (e) {
    console.error('image header read failed', e instanceof Error ? e.message : e);
    return jsonError(422, 'not_an_image', 'The file is not a valid JPEG, PNG, or WebP image.');
  }
  if (info.mime !== declaredMime) {
    return jsonError(422, 'mime_mismatch', 'The file contents do not match the declared image type.');
  }
  const { width, height } = info;
  const format = info.mime;

  const hash = await sha256Hex(bytes);

  // Check for existing image by hash (deduplication)
  const existing = await db.prepare('SELECT id FROM images WHERE sha256 = ?').bind(hash).first<{ id: string }>();
  if (existing) {
    return json({ image: { id: existing.id, duplicate: true } });
  }

  const id = crypto.randomUUID();
  const ext = getExtension(format);
  const r2Key = `images/${id}.${ext}`;

  // Upload to R2
  try {
    await media.put(r2Key, bytes, {
      httpMetadata: { contentType: format },
      customMetadata: { sha256: hash, originalFilename: file.name },
    });
  } catch (e) {
    console.error('R2 upload failed', e);
    return jsonError(500, 'storage_error', 'Failed to store image.');
  }

  const imageRecord: Omit<ImageRecord, 'id'> = {
    r2Original: r2Key,
    variants: [],
    width,
    height,
    bytes: file.size,
    mime: format,
    sha256: hash,
    filename: file.name,
  };

  // D1 insert after R2: if it fails, clean the R2 object up so no orphan is left.
  try {
    await insertImage(db, { ...imageRecord, id });
  } catch (e) {
    console.error('image record insert failed', e instanceof Error ? e.message : e);
    try {
      await media.delete(r2Key);
    } catch (cleanupError) {
      console.error('orphan cleanup failed; R2 object left at', r2Key, cleanupError instanceof Error ? cleanupError.message : cleanupError);
    }
    return jsonError(500, 'storage_error', 'Failed to record the image.');
  }

  return json({ image: { ...imageRecord, id } });
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
  adminEndpoint(context, (call: { db: D1Like; env: Cloudflare.Env; request: Request }) =>
    handleImageUpload({ db: call.db, media: call.env.MEDIA as unknown as MediaLike, request: call.request }),
  );