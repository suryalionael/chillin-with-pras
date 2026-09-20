// Shared plumbing for /api/admin endpoints: authorization, JSON parsing with a
// size cap, and consistent error bodies:
//   { "error": { "code": "...", "message": "...", ...details } }
import { authorizeAdminRequest, jsonError } from './guard.ts';
import { getEnv } from './runtime.ts';
import type { D1Like, PublishResult, SaveResult, Story } from './db.ts';

export const MAX_BODY_BYTES = 1_000_000;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RX.test(v);

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const notFound = () => jsonError(404, 'not_found', 'Story not found.');

/** Reads a JSON request body, refusing wrong content types and oversized bodies. */
export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    return { ok: false, response: jsonError(415, 'unsupported_media_type', 'Send application/json.') };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { ok: false, response: jsonError(413, 'too_large', 'Request body is too large.') };

  // Enforce the cap while streaming (content-length can be absent or wrong).
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, response: jsonError(413, 'too_large', 'Request body is too large.') };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: jsonError(400, 'bad_json', 'Body is not valid JSON.') };
  }
}

export interface AdminCall {
  db: D1Like;
  env: Cloudflare.Env;
  request: Request;
}

/**
 * Wraps an endpoint: independent authorization first (in addition to the
 * middleware), then the handler; unexpected errors become a generic 500 with
 * no internals leaked.
 */
export async function adminEndpoint(
  context: { locals: Pick<App.Locals, 'admin'>; request: Request },
  handler: (call: AdminCall) => Promise<Response>,
): Promise<Response> {
  const env = await getEnv();
  const auth = authorizeAdminRequest(context, env.ADMIN_EMAIL);
  if (!auth.ok) return auth.response;
  try {
    return await handler({ db: env.DB as unknown as D1Like, env, request: context.request });
  } catch (error) {
    console.error('admin api error', error instanceof Error ? error.message : error);
    return jsonError(500, 'internal', 'Something went wrong.');
  }
}

/** The JSON representation of a story sent to the editor. */
export function storyJson(s: Story) {
  return {
    id: s.id,
    section: s.section,
    slug: s.slug,
    status: s.status,
    draftRev: s.draftRev,
    draftUpdatedAt: s.draftUpdatedAt,
    createdAt: s.createdAt,
    publishedAt: s.publishedAt,
    pubUpdatedAt: s.pubUpdatedAt,
    hasUnpublishedChanges: s.hasUnpublishedChanges,
    draft: s.draft,
  };
}

type Failure = Exclude<SaveResult | PublishResult, { ok: true }>;

/** Maps a data-layer failure to its HTTP response (409 conflict, 422 validation, 404, …). */
export function failureResponse(r: Failure): Response {
  switch (r.reason) {
    case 'not_found':
      return notFound();
    case 'conflict':
      return jsonError(409, 'conflict', 'This story was saved from somewhere else. Reload to get the latest revision.', { currentRev: r.currentRev });
    case 'invalid':
      return jsonError(422, 'validation', 'The story could not be saved.', { issues: r.issues });
    case 'slug_taken':
      return jsonError(409, 'slug_taken', 'That web address is already used by another story.');
    case 'locked':
      return jsonError(409, 'locked', `The ${r.field} cannot be changed after publishing.`, { field: r.field });
  }
}
