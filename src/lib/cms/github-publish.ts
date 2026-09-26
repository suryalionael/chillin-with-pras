// Ships a published revision straight to the live site: writes
// `.cms/snapshot.json` + any newly-referenced images to `main` via GitHub's
// Contents API, which the `deploy-pages` GitHub Actions workflow already
// rebuilds and deploys on every push. No local step, no GitHub Actions
// secrets — the Worker itself pushes, using its own token.
//
// Uses the Contents API (one commit per changed file), not the lower-level
// Git Data API (blobs/trees/commits/refs) that would allow one atomic commit
// for everything: fine-grained personal access tokens are rejected by that
// API outright ("Resource not accessible by personal access token"), even
// with Contents: Read and write granted. Confirmed directly against GitHub's
// API before writing this — the Contents API works, the Git Data API 403s.
import type { D1Like } from './db.ts';
import { getImageExportMeta } from './db.ts';
import { extensionForMime } from './image-info.ts';
import type { PublishedSnapshot } from './deploy.ts';
import { referencedImageIds } from './schema.ts';

export interface GithubPublishEnv {
  GITHUB_TOKEN?: string;
  /** "owner/repo" */
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  MEDIA: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
}

export type GithubPublishResult =
  | { ok: true; commitSha: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; reason: string };

const REPO_RX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Chunked so it never spreads a huge array into String.fromCharCode at once. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Base64 for text, going through real UTF-8 bytes first — plain btoa() only
 * handles Latin1 and corrupts (or throws on) anything outside it, and story
 * titles/text routinely contain curly quotes and other non-ASCII characters. */
function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

async function gh(env: GithubPublishEnv, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'chillin-with-pras-cms',
      ...init?.headers,
    },
  });
}

/** A file's current sha (for updating it) and, if it's JSON, its parsed content. Null if it doesn't exist yet. */
async function getFile<T>(env: GithubPublishEnv, repo: string, path: string, branch: string): Promise<{ sha: string; json: T | null } | null> {
  const res = await gh(env, `/repos/${repo}/contents/${path}?ref=${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`could not read ${path} (${res.status})`);
  const data = (await res.json()) as { sha: string; content: string };
  let json: T | null = null;
  try {
    json = JSON.parse(atob(data.content.replace(/\n/g, ''))) as T;
  } catch {
    json = null;
  }
  return { sha: data.sha, json };
}

/** Creates or updates one file in a single commit. Returns that commit's sha. */
async function putFile(
  env: GithubPublishEnv,
  repo: string,
  path: string,
  branch: string,
  base64Content: string,
  message: string,
  sha: string | null,
): Promise<string> {
  const res = await gh(env, `/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: base64Content, branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`could not write ${path} (${res.status})`);
  return ((await res.json()) as { commit: { sha: string } }).commit.sha;
}

export async function publishSnapshotToGithub(env: GithubPublishEnv, db: D1Like, snapshot: PublishedSnapshot): Promise<GithubPublishResult> {
  const repo = (env.GITHUB_REPO ?? '').trim();
  const token = (env.GITHUB_TOKEN ?? '').trim();
  const branch = (env.GITHUB_BRANCH ?? '').trim() || 'main';
  if (!repo || !REPO_RX.test(repo) || !token) {
    return { ok: false, skipped: true, reason: 'GitHub publishing is not configured (GITHUB_TOKEN/GITHUB_REPO).' };
  }

  try {
    // Only new images need uploading — read what's already exported first.
    const manifestFile = await getFile<Record<string, string>>(env, repo, '.cms/media-manifest.json', branch);
    const manifest = manifestFile?.json ?? {};

    const referenced = new Set<string>();
    for (const story of snapshot.stories) for (const id of referencedImageIds(story.document)) referenced.add(id);
    const newIds = [...referenced].filter((id) => !manifest[id]);

    let lastCommitSha = '';

    for (const id of newIds) {
      const meta = await getImageExportMeta(db, id);
      if (!meta) continue;
      const object = await env.MEDIA.get(meta.r2Original);
      if (!object) continue;
      const bytes = new Uint8Array(await object.arrayBuffer());
      const filename = `${id}.${extensionForMime(meta.mime)}`;
      lastCommitSha = await putFile(env, repo, `.cms/media/${filename}`, branch, bytesToBase64(bytes), `cms: add image ${filename}`, null);
      manifest[id] = filename;
    }

    lastCommitSha = await putFile(
      env,
      repo,
      '.cms/media-manifest.json',
      branch,
      textToBase64(JSON.stringify(manifest, null, 2) + '\n'),
      `cms: update media manifest (revision ${snapshot.revision})`,
      manifestFile?.sha ?? null,
    );

    const snapshotFile = await getFile<never>(env, repo, '.cms/snapshot.json', branch);
    lastCommitSha = await putFile(
      env,
      repo,
      '.cms/snapshot.json',
      branch,
      textToBase64(JSON.stringify(snapshot, null, 2) + '\n'),
      `cms: publish revision ${snapshot.revision}`,
      snapshotFile?.sha ?? null,
    );

    return { ok: true, commitSha: lastCommitSha };
  } catch (e) {
    return { ok: false, skipped: false, reason: e instanceof Error ? e.message : 'GitHub publish failed' };
  }
}
