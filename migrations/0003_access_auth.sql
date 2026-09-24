-- Invite-code auth for the CMS on *.workers.dev (Cloudflare Access only works on
-- custom domains, so the shared invite code + signed session cookie gate /admin
-- and /api/admin until a domain is added later). Never stores the code itself.
CREATE TABLE access_attempts (
  email        TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  succeeded    INTEGER NOT NULL DEFAULT 0 CHECK (succeeded IN (0, 1)),
  ip           TEXT
);
CREATE INDEX idx_access_attempts ON access_attempts (email, attempted_at);