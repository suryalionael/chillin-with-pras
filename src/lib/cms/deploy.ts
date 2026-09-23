// Deployment state for the CMS publish-to-deploy pipeline.
//
// D1 owns all deployment state. A `deploy_meta` row holds a monotonic content
// revision counter; each publish inserts a `deployments` row tagged with the
// next revision, then the CI workflow drives it through
//   deploy_requested → building → deployed | failed
//
// Currentness is DERIVED, never a single mutable flag: the current deployment
// is the highest revision that reached 'deployed'. An older build finishing
// late is recorded (deployed, superseded=1) but never reported current, so a
// stale build can never overwrite a newer deployment.
import { listPublishedStories, type PublishedStory, type D1Like } from './db.ts';
export type { D1Like } from './db.ts';

export interface DeployDeps {
  now: () => Date;
  newId: () => string;
}
const defaultDeps: DeployDeps = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};
const iso = (d: Date) => d.toISOString();
const withDeps = (d?: Partial<DeployDeps>): DeployDeps => ({ ...defaultDeps, ...d });

// ---------- shapes ----------

/** Lifecycle states a single `deployments` row can be in. */
export type DeploymentStatus = 'deploy_requested' | 'building' | 'deployed' | 'failed';

export interface Deployment {
  id: string;
  revision: number;
  status: DeploymentStatus;
  superseded: 0 | 1;
  storyId: string;
  publishedAt: string;
  requestedAt: string;
  startedAt: string | null;
  deployedAt: string | null;
  failedAt: string | null;
  buildId: string | null;
  error: string | null;
  payload: { slug: string | null; title: string } | null;
}

interface DeploymentRow {
  id: string;
  revision: number;
  status: string;
  superseded: number;
  story_id: string;
  published_at: string;
  requested_at: string;
  started_at: string | null;
  deployed_at: string | null;
  failed_at: string | null;
  build_id: string | null;
  error: string | null;
  payload: string | null;
}

function toDeployment(r: DeploymentRow): Deployment {
  let payload: Deployment['payload'] = null;
  try {
    payload = r.payload ? (JSON.parse(r.payload) as Deployment['payload']) : null;
  } catch {
    payload = null;
  }
  return {
    id: r.id,
    revision: r.revision,
    status: r.status as DeploymentStatus,
    superseded: r.superseded === 1 ? 1 : 0,
    storyId: r.story_id,
    publishedAt: r.published_at,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    deployedAt: r.deployed_at,
    failedAt: r.failed_at,
    buildId: r.build_id,
    error: r.error,
    payload,
  };
}

// ---------- revision counter ----------

/**
 * Allocates the next monotonic content revision. Atomic in D1: the UPDATE …
 * RETURNING both reads and increments in one statement, so two concurrent
 * publishes can never receive the same revision.
 */
export async function nextRevision(db: D1Like): Promise<number> {
  const row = await db.prepare(`UPDATE deploy_meta SET v = v + 1 WHERE k = 'revision' RETURNING v`).first<{ v: number }>();
  if (!row || typeof row.v !== 'number') throw new Error('Deployment revision counter is not initialized.');
  return row.v;
}

/** The current counter value, without incrementing. 0 when no publish yet. */
export async function currentRevision(db: D1Like): Promise<number> {
  const row = await db.prepare(`SELECT v FROM deploy_meta WHERE k = 'revision'`).first<{ v: number }>();
  return row?.v ?? 0;
}

// ---------- deployment lifecycle ----------

export interface RequestDeploymentInput {
  revision: number;
  storyId: string;
  publishedAt: string;
  payload: { slug: string | null; title: string };
}

export async function requestDeployment(db: D1Like, input: RequestDeploymentInput, deps?: Partial<DeployDeps>): Promise<Deployment> {
  const d = withDeps(deps);
  const id = d.newId();
  const now = iso(d.now());
  await db
    .prepare(
      `INSERT INTO deployments (id, revision, status, superseded, story_id, published_at, requested_at, payload)
       VALUES (?, ?, 'deploy_requested', 0, ?, ?, ?, ?)`,
    )
    .bind(id, input.revision, input.storyId, input.publishedAt, now, JSON.stringify(input.payload))
    .run();
  return { id, revision: input.revision, status: 'deploy_requested', superseded: 0, storyId: input.storyId, publishedAt: input.publishedAt, requestedAt: now, startedAt: null, deployedAt: null, failedAt: null, buildId: null, error: null, payload: input.payload };
}

export interface MarkDeploymentInput {
  revision: number;
  status: DeploymentStatus;
  buildId?: string;
  error?: string;
}

export type MarkResult =
  | { ok: true; deployment: Deployment }
  | { ok: false; reason: 'not_found' | 'invalid' };

/**
 * Records a build/status transition for one deployment.
 * - `deployed` also supersedes every older deployed row (the newest one is current).
 * - An older revision arriving late is still recorded (so history is complete)
 *   but marked superseded and is never reported as current.
 */
export async function markDeploymentStatus(db: D1Like, input: MarkDeploymentInput, deps?: Partial<DeployDeps>): Promise<MarkResult> {
  const d = withDeps(deps);
  const now = iso(d.now());

  const row = await db.prepare('SELECT * FROM deployments WHERE revision = ?').bind(input.revision).first<DeploymentRow>();
  if (!row) return { ok: false, reason: 'not_found' };

  const col = input.status === 'building' ? 'started_at' : input.status === 'deployed' ? 'deployed_at' : 'failed_at';
  const ok = await db
    .prepare(`UPDATE deployments SET status = ?, ${col} = ?, build_id = COALESCE(?, build_id), error = ? WHERE revision = ?`)
    .bind(input.status, now, input.buildId ?? null, input.error ?? null, input.revision)
    .run();
  if ((ok.meta.changes ?? 0) !== 1) return { ok: false, reason: 'not_found' };

  // the newest deployed row becomes the sole current one: mark every other
  // deployed row superseded. Handles both a normal publish (older superseded)
  // and a stale build finishing late (its own row superseded because a newer
  // one is already deployed).
  if (input.status === 'deployed') {
    const max = await db.prepare(`SELECT MAX(revision) AS r FROM deployments WHERE status = 'deployed'`).first<{ r: number | null }>();
    const newestDeployed = max?.r ?? input.revision;
    await db.prepare(`UPDATE deployments SET superseded = 1 WHERE status = 'deployed' AND revision <> ?`).bind(newestDeployed).run();
  }

  const fresh = await db.prepare('SELECT * FROM deployments WHERE revision = ?').bind(input.revision).first<DeploymentRow>();
  return fresh ? { ok: true, deployment: toDeployment(fresh) } : { ok: false, reason: 'not_found' };
}

// ---------- reads ----------

export async function listDeployments(db: D1Like, limit = 20): Promise<Deployment[]> {
  const { results } = await db
    .prepare(`SELECT * FROM deployments ORDER BY revision DESC LIMIT ?`)
    .bind(limit)
    .all<DeploymentRow>();
  return results.map(toDeployment);
}

/** The newest deployment that actually reached 'deployed' (never superseded). */
export async function currentDeployment(db: D1Like): Promise<Deployment | null> {
  const row = await db
    .prepare(`SELECT * FROM deployments WHERE status = 'deployed' AND superseded = 0 ORDER BY revision DESC LIMIT 1`)
    .first<DeploymentRow>();
  return row ? toDeployment(row) : null;
}

/** Highest requested revision regardless of deploy state (the newest publish). */
export async function latestRequestedRevision(db: D1Like): Promise<number | null> {
  const row = await db.prepare(`SELECT MAX(revision) AS r FROM deployments`).first<{ r: number | null }>();
  return row?.r ?? null;
}

/**
 * A compact, one-call view of public deployment state (for the admin UI).
 * `behind` is true when a newer publish exists than the newest deployed build.
 */
export async function deploymentSummary(db: D1Like): Promise<{
  current: Deployment | null;
  requestChainProgress: 'none' | 'deploy_requested' | 'building' | 'deployed' | 'failed';
  newestRequestedRevision: number | null;
  behind: boolean;
  latest: Deployment[];
}> {
  const current = await currentDeployment(db);
  const newestRequestedRevision = await latestRequestedRevision(db);
  const behind = current !== null && newestRequestedRevision !== null && current.revision < newestRequestedRevision;

  const newest = await db.prepare(`SELECT * FROM deployments ORDER BY revision DESC LIMIT 1`).first<DeploymentRow>();
  const all = await listDeployments(db, 10);
  const latest = all.length > 0 ? all : (newest ? [toDeployment(newest)] : []);

  return {
    current,
    requestChainProgress: newest ? newest.status as Deployment['status'] : 'none',
    newestRequestedRevision,
    behind,
    latest,
  };
}

// ---------- snapshot for the static build ----------

export interface PublishedSnapshot {
  /** the content revision this snapshot represents */
  revision: number;
  generatedAt: string;
  stories: PublishedStory[];
}

/** Assembles the exact published-content snapshot the static build consumes. */
export async function buildPublishedSnapshot(db: D1Like, deps?: Partial<DeployDeps>): Promise<PublishedSnapshot> {
  const [revision, stories] = await Promise.all([currentRevision(db), listPublishedStories(db)]);
  return { revision, generatedAt: iso(withDeps(deps).now()), stories };
}

// ---------- auth for the build-facing endpoints ----------

export interface DeployEnv {
  CMS_PIPELINE_TOKEN?: string;
}

/**
 * Constant-time comparison so request timing cannot leak the token length/content.
 */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i]! ^ eb[i]!;
  return diff === 0;
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

/** Bearer-token check for /api/deploy/*. Fails closed when not configured. */
export function authorizeDeployToken(env: DeployEnv, request: Request): AuthResult {
  const token = (env.CMS_PIPELINE_TOKEN ?? '').trim();
  if (!token) return { ok: false, status: 503, message: 'Deployment pipeline is not configured.' };
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!bearer || !safeEqual(bearer, token)) return { ok: false, status: 401, message: 'Unauthorized.' };
  return { ok: true };
}

// ---------- deploy trigger (CI) ----------

export interface DeployTriggerEnv {
  GITHUB_REPO?: string;
  CMS_DEPLOY_TRIGGER_TOKEN?: string;
}

export type TriggerResult = { ok: true } | { ok: false; skipped: true; reason: string } | { ok: false; skipped: false; reason: string };

/**
 * Fires a GitHub repository_dispatch event that starts the publish-deploy
 * workflow. Injectable so tests can stub it; defaults to a real dispatch call.
 */
export type DeployTrigger = (env: DeployTriggerEnv, deployment: Deployment) => Promise<TriggerResult>;

const REPO_RX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const githubDispatchTrigger: DeployTrigger = async (env, deployment) => {
  const repo = (env.GITHUB_REPO ?? '').trim();
  const token = (env.CMS_DEPLOY_TRIGGER_TOKEN ?? '').trim();
  if (!repo || !REPO_RX.test(repo) || !token) {
    return { ok: false, skipped: true, reason: 'Deploy trigger is not configured.' };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'chillin-with-pras-cms' },
      body: JSON.stringify({
        event_type: 'cms-publish',
        client_payload: { revision: deployment.revision, storyId: deployment.storyId },
      }),
    });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, skipped: false, reason: `GitHub dispatch failed (${res.status}).` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, skipped: false, reason: `Deploy trigger failed: ${e instanceof Error ? e.message : 'network error'}` };
  }
};