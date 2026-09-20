-- CMS foundation: one `stories` table holding a working draft AND the published
-- snapshot, plus an `images` table. Existing content (src/data/site.json and the
-- 218 photographs) is NOT stored here; the CMS is for new stories only.
--
-- Apply locally:   npm run db:migrate:local
-- Apply remotely:  npx wrangler d1 migrations apply DB --remote   (after the real D1 database exists)

CREATE TABLE stories (
  id               TEXT PRIMARY KEY NOT NULL,                 -- random UUID, never derived from content
  section          TEXT NOT NULL CHECK (section IN ('observe', 'show')),
  slug             TEXT UNIQUE                                -- NULL until chosen; locked once published
                   CHECK (slug IS NULL OR (length(slug) BETWEEN 3 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT LIKE '-%' AND slug NOT LIKE '%-' AND slug NOT LIKE '%--%')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),

  -- working copy, autosaved. JSON text validated by src/lib/cms/schema.ts before every write.
  draft_doc        TEXT NOT NULL,
  draft_rev        INTEGER NOT NULL DEFAULT 1 CHECK (draft_rev >= 1),   -- +1 per save; optimistic concurrency
  draft_updated_at TEXT NOT NULL,                              -- ISO-8601 UTC

  -- immutable snapshot taken at Publish; the public build reads only this.
  pub_doc          TEXT,
  published_at     TEXT CHECK (published_at IS NULL OR published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- date shown / used for ordering
  pub_updated_at   TEXT,

  created_at       TEXT NOT NULL,

  -- a story is published exactly when it has a snapshot, a date and a slug
  CHECK ((status = 'published') = (pub_doc IS NOT NULL AND published_at IS NOT NULL AND slug IS NOT NULL))
);

CREATE INDEX idx_stories_status_updated ON stories (status, draft_updated_at DESC);
CREATE INDEX idx_stories_published      ON stories (published_at DESC) WHERE status = 'published';

CREATE TABLE images (
  id          TEXT PRIMARY KEY NOT NULL,                       -- random UUID
  r2_original TEXT NOT NULL,                                   -- private R2 key of the untouched original
  variants    TEXT NOT NULL DEFAULT '[]',                      -- JSON: [{w,h,key,type,bytes}] public delivery files
  width       INTEGER NOT NULL CHECK (width > 0),
  height      INTEGER NOT NULL CHECK (height > 0),
  bytes       INTEGER NOT NULL CHECK (bytes > 0),
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  sha256      TEXT NOT NULL,
  filename    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_images_sha256 ON images (sha256);
