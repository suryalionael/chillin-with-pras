# CMS foundation

The public site is **static** (39 prerendered pages, unchanged). Only the admin and its
API run on demand, in a Cloudflare Worker. The CMS is for **new** stories; the 35 existing
articles (`src/data/site.json`) and 218 photographs are not touched.

```
PUBLIC   Astro static site ─────────────► existing templates
ADMIN    /admin/**  (SSR)  ─┐
ADMIN    /api/admin/** (SSR)├─ middleware: verify Cloudflare Access JWT, email === ADMIN_EMAIL
                            └─ D1 (stories, images)   R2 (photographs, later)
PUBLISH  D1 published snapshot ─► build ─► static site      (a later phase)
```

## Status

| Piece | State |
|---|---|
| Cloudflare adapter, `wrangler.jsonc`, static output | done |
| Server-side auth (JWT verify, email check, fail-closed) | done, unit-tested |
| **Cloudflare Access application** protecting `/admin*` and `/api/admin*` | **pending configuration** |
| D1 schema + data layer, story document schema, autosave/publish API | done, tested against real D1 |
| Real D1 database / R2 bucket | **pending**: `wrangler.jsonc` holds placeholders |
| Admin pages | shells (dashboard, new, edit, preview) |
| Editor (Tiptap), image upload, publish → rebuild, public rendering of CMS stories | later phases |

Until Access is configured, **every admin request is denied (503)** in production.

## Local development

```sh
cp .dev.vars.example .dev.vars      # opt in to the local-only auth bypass (git-ignored)
npm run db:migrate:local            # create the local D1 tables
astro dev --background              # http://localhost:4321/admin/
npm test                            # unit tests (node:test)
npm run typecheck                   # wrangler types + astro check
```

The bypass treats **loopback** requests as the admin, only under `astro dev`, only when
`DEV_ADMIN_BYPASS=true`. It is removed from production bundles.

## Going live (checklist)

1. `wrangler d1 create chillin-with-pras-cms` and `wrangler r2 bucket create chillin-with-pras-media`; put the real
   `database_id` / `bucket_name` in `wrangler.jsonc`. Then `wrangler d1 migrations apply DB --remote`.
2. Cloudflare Zero Trust → Access application covering `/admin*` and `/api/admin*` on the production hostname.
   Policy: Allow, emails = `suryalionael@gmail.com`. Set `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`)
   and `ACCESS_AUD` (the application's Audience tag) in `wrangler.jsonc` vars.
3. Keep `workers_dev` / `preview_urls` disabled so the Worker is reachable only through Access.
4. Serve `404.html` for unknown paths (assets `not_found_handling: "404-page"`).

## Authorization model

`src/middleware.ts` → `src/lib/cms/auth.ts`: for `/admin/**` and `/api/admin/**` the
`Cf-Access-Jwt-Assertion` JWT is verified (RS256, team JWKS, issuer, audience, expiry) and its
`email` must equal `ADMIN_EMAIL`; then `locals.admin` is set. Every API handler independently calls
`authorizeAdminRequest()` (re-checks the email, and requires same-origin for writes). Public routes are
never touched by the middleware.

## Data model (`migrations/0001_cms_foundation.sql`)

One `stories` row holds the autosaved **draft** (`draft_doc`, `draft_rev`) and the immutable **published
snapshot** (`pub_doc`, `published_at`). Editing a published story never changes what the public build reads until
it is republished. `images` stores R2 keys and metadata. Slug and section lock at first publish.

## Story document (`src/lib/cms/schema.ts`)

`{ version: 1, title, subtitle, dateline, featuredImageId, body }` where `body` is Tiptap/ProseMirror JSON limited to:
paragraph, heading (level 2 = heading, 3 = subheading), bold, italic, link, bullet/ordered list, blockquote,
horizontalRule (divider), image (`imageId`, alt, caption, decorative, size), embed (https URL).
The server parses every document: unknown nodes are rejected, unknown attributes dropped, links limited to
http(s)/mailto/site paths. Publishing additionally requires a title, real content, and alt text (or `decorative`) on images.

## API contract (`/api/admin/stories/…`, JSON, **trailing slashes required**)

| Request | Result |
|---|---|
| `GET /` `?status=draft\|published` | `{ stories: [...] }` |
| `POST /` `{ section? }` | `201 { story }` an empty draft, `draftRev: 1` |
| `GET /:id/` | `{ story }` (includes `draft`, `draftRev`, `hasUnpublishedChanges`) |
| `PUT /:id/draft/` `{ baseRev, document, section?, slug? }` | `200 { draftRev, draftUpdatedAt }` |
| `POST /:id/publish/` `{ baseRev, publishedAt?, slug? }` | `200 { story, build: { triggered: false } }` |
| `GET /:id/published/` | `{ published }` the snapshot; 404 if never published |
| `DELETE /:id/` | `204` for never-published drafts; `409` if published |

**Autosave / revisions.** `baseRev` is the `draftRev` the editor last received. A save applies only if it is still
current (the check is inside the `UPDATE ... WHERE draft_rev = ?`, so it is atomic). Otherwise: `409
{ error: { code: "conflict", currentRev } }` and nothing is written. Use the returned `draftRev` as the next `baseRev`.

Errors are `{ error: { code, message, ...details } }`: `validation` (422, with `issues`), `conflict` / `slug_taken` /
`locked` / `published` (409), `unauthenticated` (401), `forbidden` (403), `not_found` (404), `too_large` (413),
`unsupported_media_type` (415), `not_configured` (503).

## Public-content boundary (`src/lib/content/article.ts`)

`legacyArticles(site.json)` and `assembleArticles(legacy, publishedStories)` both produce the same `Article` model,
so one public renderer can serve either source. CMS stories continue each section's entry numbering after the
legacy ones. It is **not yet wired to any page**; the public renderer (`render.mjs`, `Photo.astro`) still needs to learn
the new block types and CMS-hosted images first.
