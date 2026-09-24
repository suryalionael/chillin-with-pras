-- Allow GIF uploads: widen the images.mime CHECK to include image/gif.
-- SQLite cannot alter a CHECK constraint, so recreate the table.
-- (D1 rejects explicit BEGIN/COMMIT; the migration framework applies it atomically.)

ALTER TABLE images RENAME TO images_old;

CREATE TABLE images (
  id          TEXT PRIMARY KEY NOT NULL,
  r2_original TEXT NOT NULL,
  variants    TEXT NOT NULL DEFAULT '[]',
  width       INTEGER NOT NULL CHECK (width > 0),
  height      INTEGER NOT NULL CHECK (height > 0),
  bytes       INTEGER NOT NULL CHECK (bytes > 0),
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  sha256      TEXT NOT NULL,
  filename    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

INSERT INTO images (id, r2_original, variants, width, height, bytes, mime, sha256, filename, created_at)
  SELECT id, r2_original, variants, width, height, bytes, mime, sha256, filename, created_at FROM images_old;
DROP TABLE images_old;

CREATE INDEX idx_images_sha256 ON images (sha256);