# CMS publish-to-deploy pipeline — design

Status: **design + locally-implementable code path**. No production Cloudflare resources are created
or configured by this document or its implementation. Items marked `PRODUCTION CONFIG` / `PRODUCTION
RESOURCE` / `SECRET` are deferred and clearly marked.

---

## 1. Current architecture

### 1.1 Repository / build model

- Astro 7, `output: 'static'`, `@astrojs/cloudflare` adapter v14.
- The **public site is fully prerendered** into `dist/client` during `astro build`. Static.
- The **admin/API layer** runs in the same Cloudflare Worker (adapter server entrypoint + `ASSETS`
  binding serving `dist/client`). Every `/admin` and `/api` route is `prerender = false`.
- `astro.config.mjs`: `imageService: 'compile'` (build-time sharp), `prerenderEnvironment: 'node'`.
- `wrangler.jsonc`: placeholder D1 (`DB`) and R2 (`MEDIA`) IDs — nothing real configured.
- GitHub repository: `suryalionael/chillin-with-pras`, branch `main`, no CI workflows.

### 1.2 Data model

- `stories` (migration `0001_cms_foundation.sql`): one row per story holding
  - `draft_doc` + `draft_rev` (working copy, autosaved, optimistic concurrency)
  - `pub_doc` + `published_at` + `pub_updated_at` + locked `slug`/`section` (published snapshot)
  - invariant: `status='published'` ⟺ `pub_doc` + `published_at` + `slug` all present
- `images`: CMS-uploaded image metadata; R2 object key (`r2_original`); public delivery via `/images/{id}/`.

### 1.3 Publish flow (today)

```
editor Publish button
  → PUT /api/admin/stories/:id/draft/        (flush autosave; gets fresh baseRev)
  → POST /api/admin/stories/:id/publish/
      → publishStory(db, id, {baseRev, ...})
          → validate (title, content, alt text, images exist, slug rules, date)
          → UPDATE stories SET status='published', pub_doc=draft_doc, ... WHERE draft_rev=?
  → 200 { story, build: { triggered: false } }
```

`build.triggered` is **hard-coded false**. Publishing touches D1 only. Nothing rebuilds or deploys.

### 1.4 Public build content (today)

- `src/lib/cms/build-content.ts` → `fetchPublishedCmsStories(dbPath)`
  - reads the **local D1 SQLite file** directly: `.wrangler/state/**/d1/*/*.sqlite` via `@libsql/client`
  - only `pub_doc` rows (`status='published'`)
  - loud failure on missing DB or malformed/missing `pub_doc`; `CMS_BUILD_SKIP=1` builds legacy-only deliberately
- `buildArticleList()` → `assembleArticles(legacy, publishedStories)` merges the 35 legacy articles with CMS stories.
- `[slug].astro` `getStaticPaths()` → `getArticlesInSection()`.

### 1.5 Deployment model (today)

- `astro build` + manual `wrangler deploy` on a developer laptop.
- The Worker deployment bundles `dist/client` (static assets) + `dist/server` (admin/API) together.
- No CI, no deploy hooks, no deployment metadata, no rollback records.

### 1.6 The production gap

1. **No build-time D1 access in a remote build.** Production/remote builds are not a developer laptop, so
   there is no `.wrangler/state/**/d1/*/*.sqlite` file. `fetchPublishedCmsStories()` therefore cannot run
   remotely. There is no authenticated way for a build to read production D1.
2. **No trigger.** Publish does not start a build or deployment.
3. **No deployment state.** Nothing records requested/building/deployed/failed, which revision, or when.
4. **No stale-build protection.** If two publishes happen and two builds run, nothing stops an older build
   from appearing current.
5. **No rollback metadata.** Previous deployments are not identifiable.

Everything else (D1 as truth, published-only builds, merged legacy/CMS content, static delivery, image
pipeline, admin auth) already exists and is correct.

---

## 2. Candidate pipelines

### A. Cloudflare-native — Workers Builds (deploy hook from publish)

- **Architecture**: Publish API POSTs to a Workers Builds deploy hook; Workers Builds watches the GitHub
  repo, runs the build command, deploys the Worker (assets included).
- **Required components**: Workers Builds enabled on the account; a deploy hook URL; a secret in the Worker
  holding the hook URL; production D1/R2 IDs in `wrangler.jsonc`.
- **Auth/secrets**: Hook URL is unauthenticated-by-design (bear URL) → must be treated as a secret.
- **How production D1 reaches the build**: this is the same gap. Workers Builds runs the build sandbox; it
  would still need an authenticated snapshot endpoint (or `wrangler d1 execute --remote`) inside the build
  command. A deploy hook alone does not solve build-time D1.
- **Build trigger**: hook URL → Workers Builds.
- **Deployment mechanism**: Workers Builds deploys the Worker.
- **Failure behavior**: hook fires “asynchronously”; publish has no direct visibility into build outcome.
  Requires a status callback or polling to close the loop.
- **Rollback**: Cloudflare keeps prior Worker versions (`wrangler rollback`), but no linked metadata.
- **Operational complexity**: low once configured; hook auth is weak (bearer URL).
- **Maintenance burden**: low; Cloudflare-managed.
- **Cost/free-tier**: Workers Builds quota; fits free tier for this site.
- **Cloudflare coupling**: full.
- **GitHub coupling**: none (build reads the repo).
- **Security**: hook URL secrecy; build-time token still needed for the snapshot.
- **Effect on static architecture**: none (still a static build + Worker).

### B. GitHub Actions

- **Architecture**: publish API → `repository_dispatch` on the GitHub repo → workflow `npm ci` →
  fetch published snapshot → `astro build` → `wrangler deploy` → status callback to the Worker.
- **Required components**: a GitHub Actions workflow; Worker snapshot + status endpoints; a GitHub PAT with
  `repo` (or fine-grained) scope as a Worker secret; Cloudflare API token + account ID as Actions secrets;
  a shared pipeline token for the two Worker endpoints.
- **Auth/secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CMS_PIPELINE_TOKEN`,
  `CMS_DEPLOY_TRIGGER_TOKEN`.
- **How production D1 reaches build**: Worker snapshot endpoint (Bearer `CMS_PIPELINE_TOKEN`) returns
  `{ revision, generatedAt, stories }`; workflow writes it to a file; `build-content.ts` reads it
  (`CMS_SNAPSHOT_FILE`).
- **Build trigger**: `repository_dispatch` → `on: repository_dispatch`.
- **Deployment mechanism**: `wrangler deploy --config dist/server/wrangler.json` (deploys Worker incl. assets).
- **Failure behavior**: workflow `steps` fail loudly; `if: failure()` reports failed status; a failed build
  never reaches the deploy step, so the currently deployed site is untouched.
- **Rollback**: `wrangler rollback` to a prior Worker version; deployment history recorded in D1.
- **Operational complexity**: moderate; standard, well-documented CI.
- **Maintenance burden**: low; Actions is ubiquitous.
- **Cost/free-tier**: public repo → Actions free on GitHub for this workload.
- **Cloudflare coupling**: API token + wrangler deploy.
- **GitHub coupling**: requires the repo + a dispatch token.
- **Security**: least-privilege tokens (repo-scoped dispatch; Workers edit + D1 read for deploy).
- **Effect on static architecture**: none — build stays static; D1 read happens through the snapshot.

### C. Generated content committed to git

- **Architecture**: on publish, a bot writes `src/data/cms-published.json` + commits + pushes; a
  push-triggered workflow builds and deploys.
- **Required components**: bot identity (GitHub token, machine user), a generated snapshot file in the repo.
- **Auth/secrets**: GitHub token with `contents: write`.
- **How production D1 reaches build**: content is mirrored into git; the build reads the committed file.
- **Build trigger**: git push.
- **Deployment mechanism**: `wrangler deploy`.
- **Failure behavior**: same as B.
- **Rollback**: git history provides previous snapshots.
- **Operational complexity**: high — dual source of truth (D1 + committed mirror), commit churn, bot
  account, merge/rebase hazards.
- **Maintenance burden**: high (bot + mirror hygiene).
- **Cost/free-tier**: free.
- **Cloudflare coupling**: deploy token only.
- **GitHub coupling**: heavy.
- **Security**: mirror can drift from D1; a stale committed snapshot can be built silently.
- **Effect on static architecture**: none, but weakens “D1 is the source of truth”.

### D. SSR with direct D1 reads

- Published content is rendered server-side from production D1 on every request.
- **Effect on static architecture**: violates the static-public-site requirement and the project intent.
- Rejected outright as a mechanism; noted only for completeness.

### E. Hybrid (chosen) — GitHub Actions + Worker snapshot/status endpoints

E is a refinement of B with all pipeline logic owned by the existing Worker and D1:
- D1 remains the only source of truth.
- The Worker (already D1-bound) generates signed snapshots and records deployment status.
- GitHub Actions is only the build/deploy runner, triggered by `repository_dispatch`.
- The build reads a **revisioned snapshot**, so stale-build protection is enforceable by comparing revisions.

Requirements that drove E:
- static public delivery preserved (D)
- D1 stays the only CMS source of truth (not C)
- build-time content access must be authenticated and revisioned (A/B both need it; E owns it in tested code)
- publish and deploy are separate events with durable state
- one pytestable Worker surface (snapshot + status) rather than invoking `wrangler d1 execute` from CI
- standard, locally-verifiable CI (vs Workers Builds behavior which is less reproducible locally)

Tradeoffs of E vs A: A is fewer moving parts at deploy time, but (1) deploy-hook auth is a bearer URL,
(2) build-time D1 still requires a snapshot mechanism, and (3) Workers Builds sandbox behavior is harder to
reproduce locally than a GitHub runner. E exposes the same snapshot mechanism but through the Worker's own,
unit-tested data layer, and CI failure behavior is explicit.

---

## 3. Recommended architecture (chosen)

```
Admin Publish
   │  POST /api/admin/stories/:id/publish/
   ▼
Worker (D1 binding)
   │  publishStory()  (pub_doc written, revision counter++ , deployment row inserted)
   │  triggerDeploy() → GitHub repository_dispatch (best-effort)
   ▼
GitHub Actions workflow
   │  npm ci
   │  GET /api/deploy/snapshot/  (Bearer CMS_PIPELINE_TOKEN) → .cms/snapshot.json
   │  CMS_SNAPSHOT_FILE=.cms/snapshot.json npm run build
   │  npx wrangler deploy --config dist/server/wrangler.json
   ▼
POST /api/deploy/status/ (Bearer CMS_PIPELINE_TOKEN)  → deployment marked deployed/failed
   │
   ▼
D1  ← deployments table (requested → building → deployed | failed)
```

Why this fits:

1. **Correctness**: published content flows through the same `listPublishedStories()` data layer that tests
   already cover, signed with a monotonic revision.
2. **Fewest moving parts**: GitHub Actions is the only new runner; the Worker already owns D1 and admin auth.
   No new runtime, no queue, no event bus.
3. **Static delivery preserved**: the build is unchanged (`astro build`), it just reads a snapshot file instead
   of a local SQLite file.
4. **D1 is source of truth**: nothing is mirrored into git; the snapshot is generated on demand from D1.
5. **Secure build-time access**: Bearer token (`CMS_PIPELINE_TOKEN`) scoped to the two deploy endpoints.
6. **Clear deployment state**: a small durable `deployments` table.
7. **Safe rollback**: `wrangler rollback` to a prior Worker version, identified by deployment history.
8. **Minimal maintenance**: Activite Actions on a public repo is free; the workflow is ~30 lines; the
   Worker additions are ~200 lines of tested code.

---

## 4. Published-content snapshot strategy

### 4.1 Format

`GET /api/deploy/snapshot/` returns a JSON document:

```json
{
  "revision": 42,
  "generatedAt": "2026-09-23T12:00:00.000Z",
  "stories": [ { "id", "section", "slug", "publishedAt", "pubUpdatedAt", "document" } ]
}
```

- `revision`: the current monotonic content counter (from `deploy_meta`), the value the build must carry
  into its status callback.
- `stories`: every published story, oldest first, exactly what `listPublishedStories()` returns.
  Legacy `site.json` content is never included (it already lives in the repo).

### 4.2 When snapshot is generated

On-demand, at the start of each workflow run. The build pins whatever revision the snapshot reports.

### 4.3 Authentication

HTTP `Authorization: Bearer <CMS_PIPELINE_TOKEN>`. Same token is accepted by the status endpoint. Token is a
Worker secret (never a `var`), `SECRET`.

### 4.4 Content included

Published snapshots only (`status='published'`, `pub_doc`). `draft_doc` is never emitted.

### 4.5 Images

Stories reference images by `imageId`; no bytes are in the snapshot. `/images/{id}/` (Worker route) serves the
R2 object at request time — unchanged. The build does not need R2.

### 4.6 Legacy content preserved

`build-content.ts` already merges `legacyArticles(site.json)` with the snapshot stories. Snapshot only adds the
CMS side.

### 4.7 Malformed/missing content

`build-content.ts` validates every `document` (title + body) and rejects malformed entries with a loud error →
build fails → no deployment. Legacy-only builds via `CMS_BUILD_SKIP=1` remain available.

### 4.8 Secrets

The snapshot/pipeline token is only compared server-side. It is never serialized into HTML, `dist`, or logs of
stories. The workflow passes it as an `Authorization` header.

### 4.9 Temporary vs persisted

The snapshot file is a **build-time working file** (`.cms/snapshot.json`, git-ignored). It is not committed and
not part of the repo.

### 4.10 Can it become stale?

Yes — and that is the point. The build pins a `revision`; if another publish happens mid-build, the deployment
still reflects the old revision and the pipeline marks the public state “pending new revision” rather than
claiming the new content is live.

### 4.11 Consistency

Snapshot generation is a single `SELECT` over published stories at one instant. Because revision is a
monotonically increasing counter and each deployment row records the revision it actually built, an older
build can never be reported as the current deployment.

---

## 5. Deployment state machine

### 5.1 States

| State | Meaning |
|---|---|
| `deploy_requested` | Publish committed `pub_doc`; deployment row created; trigger attempt made |
| `building` | (optional) A build reported start (`status=building` from workflow) |
| `deployed` | Build+deploy succeeded; status callback accepted |
| `failed` | Build or deploy failed; `error` recorded |
| `supered` — one row may be `superseded=1` | Its revision is older than the newest deployment that reached `deployed`; it is historical, not current |

Explicit “not_deployed” is represented by the state of the deployments table before any row exists for that
revision (no deploy record). No extra state value is needed.

### 5.2 Table (`migration 0002_deployments.sql`)

```sql
CREATE TABLE deploy_meta (
  k TEXT PRIMARY KEY NOT NULL,
  v INTEGER NOT NULL
);                                   -- k='revision' → monotonic counter

CREATE TABLE deployments (
  id TEXT PRIMARY KEY NOT NULL,               -- uuid
  revision INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('deploy_requested','building','deployed','failed')),
  superseded INTEGER NOT NULL DEFAULT 0,
  story_id TEXT NOT NULL,
  published_at TEXT NOT NULL,                 -- pub_updated_at of that publish
  requested_at TEXT NOT NULL,
  started_at TEXT,
  deployed_at TEXT,
  failed_at TEXT,
  build_id TEXT,                              -- GitHub run id
  error TEXT,
  payload TEXT                                -- small JSON: {slug,title}
);
CREATE INDEX idx_deployments_status ON deployments (status, revision DESC);
```

### 5.3 Who creates / transitions

| Row/field | Creates | Transitions |
|---|---|---|
| `deploy_meta.revision` | publish API (`UPDATE … RETURNING`) | every publish |
| `deployments` row (`deploy_requested`) | publish API, atomically with `pub_doc` write | — |
| `building` | status endpoint (`status=building`) | → |
| `deployed` | status endpoint (`status=deployed`, `buildId`) | deploy completes |
| `failed` | status endpoint (`status=failed`, `error`) | deploy fails |
| `superseded=1` | derived at query time: if any newer row is `deployed` | compute |

### 5.4 Metadata per deployment

- `revision` (content revision), `story_id`, `published_at`
- `requested_at` / `started_at` / `deployed_at` / `failed_at` timestamps (ISO UTC)
- `build_id` (GitHub run id), `error` text
- `payload` (slug/title for display)

### 5.5 Stale detection

The “current public deployment” is derived: the highest `revision` with `status='deployed'` and `superseded=0`.
If the highest *requested* revision > highest deployed revision → public site is behind → reported as
`outdated`. Any old build that calls back with a lower revision is still recorded (`superseded=1`) but is never
treated as current.

### 5.6 Concurrent publishes

Revision is allocated atomically (`UPDATE deploy_meta SET v=v+1 RETURNING v`). Publish A → revision R,
publish B → revision R+1. Builds carry their own revision; only the newest deployed revision is current.

---

## 6. Publish semantics

```
editor Publish
  → flush autosave (POST draft)          [existing]
  → POST /api/admin/stories/:id/publish/
     1. publishStory()                    [existing atomic UPDATE; unchanged]
        — pub_doc committed first. This is the only source-of-truth write.
     2. revision = deploy_meta.next       [single atomic UPDATE … RETURNING v]
     3. INSERT deployments (deploy_requested, revision, story_id, …)
        — if this insert fails, publish has already succeeded; response reports
          deploy: { requested:false, error } rather than claiming a deployment.
     4. triggerDeploy(revision)           [best-effort; failure recorded, publish still succeeds]
  → 200 { story, build: { triggered, revision, status, error? } }
```

- The published snapshot (`pub_doc`) commits **before** any deployment bookkeeping. A failure at step 2/3/4
  never undoes or corrupts the published CMS snapshot — it only means the deployment was not requested/fired.
- Trigger failure does **not** undo the publish snapshot. The CMS publishes; deployment state stays
  `deploy_requested` and the UI shows “deployment not started”.
- The static site is rebuilt from the snapshot **only after** publish succeeded; a failed build leaves the
  current deployment intact.
- Atomicity between the publish and the deployment request is deliberately *sequential*, not a D1 batch:
  content publication must never be rolled back because a deployment bookkeeping step failed. This keeps
  “D1 is the source of truth” inviolable and avoids extending the D1 statement surface.

---

## 7. Concurrent publish behavior

| Event | Result |
|---|---|
| Publish A (rev 10) → build A starts | deployment row 10 `deploy_requested` |
| Publish B (rev 11) → build B starts | deployment row 11 `deploy_requested`; current = 10 deployed (if any) |
| build A finishes → status(deployed, rev 10) | row 10 `deployed`; if rev 11 exists and deployed, row 10 superseded |
| build B finishes → status(deployed, rev 11) | row 11 `deployed`; current = 11 |
| build A (slow) finishes after rev 11 deployed | status(rev 10) recorded, `superseded=1`; never reported current |

Guarantee: an older build can never become the current deployment because currentness is decided by the
highest deployed revision, not by completion order.

---

## 8. Rollback

- **Previous deployment availability**: yes — Cloudflare retains prior Worker versions; `wrangler rollback`
  restores the last good Worker (which includes its bundled static assets). Deployment history in D1
  identifies the prior revision, timestamp, and build id.
- **Identification**: `SELECT … FROM deployments WHERE status='deployed' ORDER BY revision DESC LIMIT 2` →
  the previous deployed revision.
- **D1 during rollback**: untouched. D1 stays the CMS source of truth; rolled-back content is not re-published
  into D1. Public site and CMS are intentionally decoupled.
- **Does rollback revert content or deployment?**: deployment only. If the author wants the older content to be
  the published snapshot again, they re-edit and re-publish (or a future unpublish feature). No destructive
  CMS operation is performed by rollback.
- **Accidental data loss**: none — rollback operates on Worker versions and deployment rows, never on
  `stories`/`pub_doc`.
- **Retry after failure**: re-run the workflow (`workflow_dispatch` or re-trigger with the same revision), or
  let the author publish again (new revision).
- **Summary**: rollback reverts the *public deployment*; CMS content is never modified during rollback.

---

## 9. Security

| Concern | Design |
|---|---|
| Who can trigger a deployment | Only the single admin (`ADMIN_EMAIL`, Access JWT verified server-side) |
| Trigger auth | publish endpoint behind existing admin middleware + per-handler re-auth |
| Build-time CMS access | `GET /api/deploy/snapshot/` Bearer `CMS_PIPELINE_TOKEN` (Worker secret) |
| Status callback auth | `POST /api/deploy/status/` Bearer `CMS_PIPELINE_TOKEN` |
| What secrets exist | `CMS_PIPELINE_TOKEN`, `CMS_DEPLOY_TRIGGER_TOKEN` (Worker secrets); `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CMS_PIPELINE_TOKEN` (GitHub secrets) |
| Where they live | Worker secrets (`wrangler secret put`) + GitHub Actions secrets; never in repo/config |
| Minimum permissions | deploy token: Workers Scripts edit on this Worker; dispatch token: `repo`/fine-grained scoped to this repo; pipeline token: only the two deploy endpoints |
| Secrets exposed to browser | no — all server-side, never serialized to `dist` |
| Public site vs unpublished content | snapshot returns published `pub_doc` only; `draft_doc` never leaves the Worker |
| Draft leakage into static output | build reads snapshot (`pub_doc`) only; `CMS_BUILD_SKIP` never publishes drafts |

---

## 10. Local development

- Local CMS: unchanged (`DEV_ADMIN_BYPASS`, local D1 via `npm run db:migrate:local`).
- Local D1/R2: unchanged (wrangler dev state).
- Local publish: unchanged (existing publish endpoint), plus a `deploy_requested` row is now created locally.
- Local static build: unchanged default (reads local D1 SQLite) **or** snapshot-file mode
  (`CMS_SNAPSHOT_FILE=.cms/snapshot.json`), which mirrors CI exactly.
- Simulating a full deploy locally:
  1. `curl -H "Authorization: Bearer dev-token" :4310/api/deploy/snapshot/ > .cms/snapshot.json` (dev token via `.dev.vars`)
  2. `CMS_SNAPSHOT_FILE=.cms/snapshot.json npm run build`
  3. `npm run preview` → verify pages
  4. `curl -X POST :4310/api/deploy/status/ -H "Authorization: Bearer dev-token" -d '{"revision":N,"status":"deployed","buildId":"local"}'`
- Testing deployment transitions: call the status endpoint with `deploy_requested`/`deployed`/`failed` values and
  assert the derived current state. No Cloudflare production access needed.
- Trigger adapter is injectable (`triggerDeploy` dep) so tests can stub the GitHub dispatch.

---

## 11. Failure matrix

| Scenario | State | Public site | CMS | Recovery |
|---|---|---|---|---|
| D1 unavailable at publish | publish error (`500 internal`) | unchanged | no write | retry publish |
| Malformed `pub_doc` | row `failed`/build error | unchanged (no deploy) | published snapshot exists | fix content, republish |
| Snapshot generation fails | deploy stays `requested` | unchanged | content published | retry workflow |
| Deployment trigger fails | `deploy_requested`, `trigger.ok=false` surfaced | unchanged | content published, UI shows “not started” | re-trigger / re-publish |
| Build fails | `failed` + error | unchanged | content published | fix, rerun workflow |
| Deploy fails | `failed` + error | prior deployment intact | content published | `wrangler rollback` or redeploy |
| Two publishes quickly | rows rev R, R+1; current = highest deployed | newest built behavior | both published | build B then supersedes A |
| Published image missing | build fails loudly (image not required for build today) | unchanged | content published | upload image, republish |
| Deploy succeeds but callback fails | `deployed` never recorded in D1; workflow retries/reports | site is actually live | content published | rerun status or manual mark |
| Status callback late/out of order | older revision marked `superseded` | actual deployment may be newer | content published | none needed |
| Stale build tries to deploy | its revision < current; recorded superseded | only newest deploy promoted | — | none |
| Retry after failure | prior failed row kept; new attempt new id | unchanged until success | — | rebuild |

---

## 12. Production setup checklist

| Item | Kind | Notes |
|---|---|---|
| `deployments` + `deploy_meta` migration | `CODE` (this task) | `migrations/0002_deployments.sql` |
| D1 `database_id` real value | `PRODUCTION CONFIG` | replace placeholder in `wrangler.jsonc` |
| R2 `bucket_name` real value | `PRODUCTION CONFIG` | replace placeholder in `wrangler.jsonc` |
| D1 migration applied remotely | `PRODUCTION CONFIG` | `wrangler d1 migrations apply DB --remote` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `PRODUCTION CONFIG` | Access app values |
| Access application on `/admin*` + `/api/admin*` | `PRODUCTION RESOURCE` | allow `suryalionael@gmail.com` |
| `CMS_PIPELINE_TOKEN` Worker secret | `SECRET` | `wrangler secret put` |
| `CMS_DEPLOY_TRIGGER_TOKEN` Worker secret | `SECRET` | GitHub PAT (repo scope) |
| `GITHUB_REPO` Worker var | `PRODUCTION CONFIG` | `suryalionael/chillin-with-pras` |
| `CLOUDFLARE_API_TOKEN` GitHub secret | `SECRET` | Workers script edit on this Worker |
| `CLOUDFLARE_ACCOUNT_ID` GitHub secret | `SECRET` | account id |
| `CMS_PIPELINE_TOKEN` GitHub secret | `SECRET` | same value as Worker secret |
| `.github/workflows/publish-deploy.yml` | `CODE` (this task) | repository_dispatch workflow |
| deploy command confirmation | `PRODUCTION CONFIG` | verify `wrangler deploy --config dist/server/wrangler.json` path on rollout |
| Production Worker deployment | `PRODUCTION CONFIG` | first deploy is manual, afterwards by CI |

---

## 13. Decision

### Chosen architecture

**GitHub Actions builder + Worker-owned snapshot & status endpoints + durable D1 deployment table.**

Selected because:
- it keeps the public site static and the build unchanged in spirit,
- D1 remains the single CMS source of truth,
- the snapshot rides the already-tested data layer (`listPublishedStories`) with monotonic revisions,
- explicit, durable deployment states and stale-build protection are enforced by the database,
- GitHub Actions on a public repo is free, reproducible, and trivially auditable,
- every moving part is locally testable without touching Cloudflare production.

### Known tradeoffs

- Requires two Worker secrets and two GitHub secrets before go-live (no infrastructure change, but config).
- GitHub Actions adds a small coupling to GitHub for deploys (the repo is already GitHub).
- An older build finishing late still deploys a valid older Worker; currentness is enforced at the reporting
  layer rather than halting the deploy. Acceptable: Cloudflare serves only the last successful `wrangler deploy`,
  and D1 marks superseded revisions correctly.
- First production deploy must be manual to confirm the wrangler config path.

### Exact implementation plan (this task, code-only)

1. Migration `0002_deployments.sql`.
2. `src/lib/cms/deploy.ts` — revision counter, deployment insert/status transitions, derived current state,
   snapshot assembly, trigger + status auth helpers.
3. `build-content.ts` — snapshot-file mode via `CMS_SNAPSHOT_FILE`.
4. `GET /api/deploy/snapshot/` + `POST /api/deploy/status/` (Bearer token; `prerender=false`).
5. Publish endpoint wires `deploy_requested` + best-effort trigger; returns real build state.
6. Editor + dashboard show deployment state.
7. `.github/workflows/publish-deploy.yml`.
8. `docs/cms-publish-pipeline-design.md` (this doc) + `docs/cms-production.md` update.
9. Tests for all of the above.

### Exact production steps (must happen later, NOT now)

1. Create D1 + R2, wire real IDs, apply `0002` remotely.
2. Configure Cloudflare Access.
3. `wrangler secret put CMS_PIPELINE_TOKEN`; `wrangler secret put CMS_DEPLOY_TRIGGER_TOKEN`; set
   `GITHUB_REPO` var.
4. Add GitHub Actions secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CMS_PIPELINE_TOKEN`).
5. Confirm deploy command path; first manual deploy.

---

### Blockers encountered

None that stop the code-side implementation. All authorization needed for the local/CI code path is injectable
(trigger adapter + token comparison) so tests run without any production credential.