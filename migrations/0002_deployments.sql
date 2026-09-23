-- CMS publish-to-deploy pipeline: durable deployment state.
--
--   deploy_meta    monotonic content revision counter (one row, k='revision')
--   deployments    one row per publish; the static build + deploy lifecycle
--                  moves a row through deploy_requested → building → deployed|failed
--
-- Apply locally:   npm run db:migrate:local
-- Apply remotely:  npx wrangler d1 migrations apply DB --remote

CREATE TABLE deploy_meta (
  k TEXT PRIMARY KEY NOT NULL,
  v INTEGER NOT NULL
);

INSERT INTO deploy_meta (k, v) VALUES ('revision', 0);

CREATE TABLE deployments (
  id            TEXT PRIMARY KEY NOT NULL,              -- uuid
  revision      INTEGER NOT NULL UNIQUE,                -- monotonic content revision this deployment builds
  status        TEXT NOT NULL DEFAULT 'deploy_requested'
                CHECK (status IN ('deploy_requested', 'building', 'deployed', 'failed')),
  superseded    INTEGER NOT NULL DEFAULT 0              -- historical row, no longer the current deployment
                CHECK (superseded IN (0, 1)),
  story_id      TEXT NOT NULL,
  published_at  TEXT NOT NULL,                          -- the published snapshot's pub_updated_at
  requested_at  TEXT NOT NULL,                          -- ISO-8601 UTC
  started_at    TEXT,                                   -- build reported start
  deployed_at   TEXT,                                   -- deploy completed
  failed_at     TEXT,
  build_id      TEXT,                                   -- CI run id
  error         TEXT,                                   -- failure detail
  payload       TEXT                                    -- small JSON: {slug, title}
);

CREATE INDEX idx_deployments_status ON deployments (status, revision DESC);
CREATE INDEX idx_deployments_revision ON deployments (revision);