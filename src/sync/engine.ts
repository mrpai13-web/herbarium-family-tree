/**
 * Keeps a shared tree's local cache (IndexedDB) and its private GitHub repository in step.
 *
 * The repository holds:
 *   tree.json             every person, parent link, union, group and media caption
 *   media/<id>            a photo or recording;  media/<id>.thumb  a photo's card thumbnail
 * Every save is one commit, so the repository's history is a full record of changes.
 *
 * Local edits: the db middleware reports every touched row id; ids wait in an outbox
 * (kept in localStorage, so they survive a reload or going offline). A push takes the
 * latest tree.json from GitHub, overlays the current version of each outbox row (present ->
 * set, gone -> removed), and commits it with any new files. If someone else committed in
 * between, GitHub refuses the update and the push starts again from their version, so
 * edits to different people never overwrite each other (same row: last save wins).
 *
 * Remote edits: the branch head is checked every 20 s and when the tab comes back
 * (cheap: unchanged answers are 304s, which don't count against GitHub's rate limit).
 */
import { create } from 'zustand';
import type { MediaRecord } from '../core/types';
import { db, onLocalChange, writeRemote, SYNCED_TABLES, type SyncedTable } from '../data/db';
import { getToken, setRemoteMediaFetcher, setToken, sharedRepo, treeLink } from './config';

export type SyncStatus = 'local' | 'signin' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'missing' | 'error';

interface SyncState {
  status: SyncStatus;
  /** Signed-in GitHub username, if any. */
  login: string | null;
  canEdit: boolean;
  isOwner: boolean;
  pending: number;
  /** Human-readable problem, shown in the share panel. */
  problem: string | null;
  /** Set while the first download of a shared tree is running. */
  firstLoad: boolean;
}

export const useSync = create<SyncState>(() => ({
  status: sharedRepo ? 'connecting' : 'local',
  login: null,
  canEdit: !sharedRepo,
  isOwner: false,
  pending: 0,
  problem: null,
  firstLoad: Boolean(sharedRepo),
}));

/** True when edits are allowed here: the private tree, or a shared tree you may edit. */
export const canEditNow = () => useSync.getState().canEdit;

/* ------------------------------------------------------------ GitHub API */

// Dev-only override so automated checks can use a stand-in server.
const API = (import.meta.env.DEV && (import.meta.env.VITE_GITHUB_API as string | undefined)) || 'https://api.github.com';

class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function gh<T = unknown>(path: string, init: RequestInit & { raw?: boolean; token?: string } = {}): Promise<T> {
  const token = init.token ?? getToken();
  if (!token) throw new GitHubError('Not signed in to GitHub.', 401);
  const res = await fetch(API + path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: init.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { message?: string }).message ?? msg;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) msg = 'GitHub didn’t accept the saved token (expired or revoked). Sign in again from the Share button.';
    throw new GitHubError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  if (init.raw) return (await res.blob()) as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------ the shared file */

type Row = Record<string, unknown> & { id: string };
type Tables = Record<SyncedTable, Record<string, Row>>;

interface TreeFile {
  format: 'herbarium-shared-tree';
  version: 1;
  name: string;
  tables: Tables;
}

const emptyTables = (): Tables => Object.fromEntries(SYNCED_TABLES.map((t) => [t, {}])) as unknown as Tables;

/** What goes into tree.json for a row: media without its binaries. */
export function toData(table: SyncedTable, row: Row): Row {
  if (table !== 'media') return row;
  const { blob, thumb, remote, ...meta } = row as unknown as MediaRecord & { remote?: boolean; hasThumb?: boolean };
  void blob;
  void remote;
  const was = row as { hasThumb?: boolean; thumbMime?: string };
  return { ...meta, hasThumb: Boolean(thumb) || Boolean(was.hasThumb), thumbMime: thumb?.type || was.thumbMime } as unknown as Row;
}

/** Same content regardless of key order. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k]))
      .join(',')}}`;
  return JSON.stringify(v);
}

const mediaFile = (id: string, which: 'blob' | 'thumb') => (which === 'blob' ? `media/${id}` : `media/${id}.thumb`);

/* ------------------------------------------------------------ outbox */

const OUTBOX_KEY = sharedRepo ? `herbarium-outbox-${sharedRepo}` : '';
const UPLOADED_KEY = sharedRepo ? `herbarium-uploaded-${sharedRepo}` : '';
const outbox = new Set<string>(readList(OUTBOX_KEY));
const uploaded = new Set<string>(readList(UPLOADED_KEY));
const key = (t: SyncedTable, id: string) => `${t}\u0001${id}`;

function readList(k: string): string[] {
  if (!k) return [];
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function saveList(k: string, s: Set<string>) {
  try {
    localStorage.setItem(k, JSON.stringify([...s]));
  } catch {
    /* storage blocked: still works for this session */
  }
}

/* ------------------------------------------------------------ start */

let started = false;
let reload: () => Promise<void> = async () => {};
let branch = 'main';
let head: string | null = null;
let headEtag: string | null = null;
let treeName = '';

/** The shared tree's display name (from tree.json). */
export const sharedTreeName = () => treeName;

/**
 * Connects a shared tree. `onRemote` re-reads the local cache into the app after
 * other people's edits were written to it. Does nothing for the private tree.
 */
export async function startSync(onRemote: () => Promise<void>): Promise<void> {
  if (!sharedRepo || started) return;
  started = true;
  reload = onRemote;
  setRemoteMediaFetcher(downloadMedia);

  onLocalChange((table, ids) => {
    for (const id of ids) outbox.add(key(table, id));
    saveList(OUTBOX_KEY, outbox);
    useSync.setState({ pending: outbox.size });
    schedulePush();
  });
  useSync.setState({ pending: outbox.size });

  setInterval(() => void pull(), 20_000);
  window.addEventListener('focus', () => void pull());
  window.addEventListener('online', () => {
    void pull();
    schedulePush(0);
  });
  await connect();
}

/** (Re)checks the token and access to the repository, then downloads the tree. */
async function connect(): Promise<void> {
  if (!getToken()) {
    useSync.setState({ status: 'signin', login: null, canEdit: false, firstLoad: false, problem: null });
    return;
  }
  try {
    const user = await gh<{ login: string }>('/user');
    const repo = await gh<{ default_branch: string; permissions?: { admin: boolean; push: boolean } }>(`/repos/${sharedRepo}`);
    branch = repo.default_branch || 'main';
    useSync.setState({ login: user.login, canEdit: Boolean(repo.permissions?.push), isOwner: Boolean(repo.permissions?.admin), problem: null });
  } catch (e) {
    const err = e as GitHubError;
    if (err.status === 404)
      useSync.setState({
        status: 'missing',
        canEdit: false,
        firstLoad: false,
        problem: 'Your GitHub account can’t open this tree. Ask whoever shared it to add your GitHub username, then accept the invitation GitHub emails you.',
      });
    else if (err.status === 401) useSync.setState({ status: 'signin', canEdit: false, firstLoad: false, problem: err.message });
    else useSync.setState({ status: navigator.onLine ? 'error' : 'offline', firstLoad: false, problem: err.message });
    return;
  }
  head = null;
  headEtag = null;
  await pull();
  useSync.setState({ firstLoad: false });
  if (outbox.size) schedulePush(0);
}

/* ------------------------------------------------------------ pull */

let pulling: Promise<void> | null = null;

export function pull(): Promise<void> {
  const s = useSync.getState().status;
  if (!sharedRepo || s === 'signin' || s === 'missing' || !useSync.getState().login) return Promise.resolve();
  pulling ??= doPull()
    .catch((e: Error) => useSync.setState({ status: navigator.onLine ? 'error' : 'offline', problem: e.message }))
    .finally(() => (pulling = null));
  return pulling;
}

/** Current branch head, or null when nothing changed since the last check. */
async function headIfChanged(): Promise<string | null> {
  const res = await fetch(`${API}/repos/${sharedRepo}/git/ref/heads/${branch}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${getToken()}`,
      ...(headEtag ? { 'If-None-Match': headEtag } : {}),
    },
  });
  if (res.status === 304) return null;
  if (!res.ok) throw new GitHubError(`Checking for changes failed (${res.status}).`, res.status);
  headEtag = res.headers.get('ETag');
  const sha = ((await res.json()) as { object: { sha: string } }).object.sha;
  return sha === head ? null : sha;
}

async function readTree(at: string): Promise<TreeFile> {
  try {
    const blob = await gh<Blob>(`/repos/${sharedRepo}/contents/tree.json?ref=${at}`, { raw: true });
    const f = JSON.parse(await blob.text()) as TreeFile;
    if (f.format !== 'herbarium-shared-tree') throw new Error('This repository doesn’t hold a Herbarium family tree.');
    return { ...f, tables: { ...emptyTables(), ...f.tables } };
  } catch (e) {
    if ((e as GitHubError).status === 404) return { format: 'herbarium-shared-tree', version: 1, name: '', tables: emptyTables() };
    throw e;
  }
}

async function doPull() {
  const sha = await headIfChanged();
  if (!sha) {
    if (!outbox.size) useSync.setState({ status: 'synced', problem: null });
    return;
  }
  const file = await readTree(sha);
  treeName = file.name;
  // Rows with unsent local edits keep the local version; those go up with the next push.
  const changed = await writeRemote(async () => {
    let n = 0;
    for (const t of SYNCED_TABLES) {
      const table = db.table(t);
      const remote = file.tables[t];
      const local = (await table.toArray()) as Row[];
      const localById = new Map(local.map((r) => [r.id, r]));
      for (const r of local) {
        if (!remote[r.id] && !outbox.has(key(t, r.id))) (await table.delete(r.id), n++);
      }
      for (const [id, row] of Object.entries(remote)) {
        if (outbox.has(key(t, id))) continue;
        const mine = localById.get(id);
        if (mine && canon(toData(t, mine)) === canon(row)) continue;
        // Keep files already downloaded (or uploaded from here) when only the caption changed.
        const keep = t === 'media' && mine ? { blob: (mine as { blob?: Blob }).blob, thumb: (mine as { thumb?: Blob }).thumb } : {};
        await table.put({ ...row, ...keep });
        n++;
      }
    }
    return n;
  });
  head = sha;
  if (changed) await reload();
  if (!outbox.size) useSync.setState({ status: 'synced', problem: null });
}

/* ------------------------------------------------------------ media download */

const downloads = new Map<string, Promise<Blob | undefined>>();

/** Fetches a photo or recording from the repository and keeps it in the local cache. */
function downloadMedia(id: string, which: 'blob' | 'thumb'): Promise<Blob | undefined> {
  const k = id + which;
  let p = downloads.get(k);
  if (!p) {
    p = (async () => {
      const rec = (await db.media.get(id)) as (MediaRecord & { hasThumb?: boolean }) | undefined;
      if (!rec) return undefined;
      const want = which === 'thumb' && rec.hasThumb ? 'thumb' : 'blob';
      const raw = await gh<Blob>(`/repos/${sharedRepo}/contents/${mediaFile(id, want)}?ref=${head ?? branch}`, { raw: true });
      const thumbType = (rec as { thumbMime?: string }).thumbMime || rec.mime;
      const blob = new Blob([raw], { type: want === 'blob' ? rec.mime : thumbType });
      await writeRemote(async () => {
        const cur = await db.media.get(id);
        if (cur) await db.media.put({ ...cur, ...(want === 'blob' ? { blob } : { thumb: blob }) });
      });
      return blob;
    })().finally(() => setTimeout(() => downloads.delete(k), 0));
    downloads.set(k, p);
  }
  return p;
}

/* ------------------------------------------------------------ push */

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;

function schedulePush(delay = 1200) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function push() {
  const s = useSync.getState();
  if (pushing || !outbox.size || !s.canEdit || !s.login) return;
  pushing = true;
  useSync.setState({ status: 'syncing' });
  try {
    for (let attempt = 0; ; attempt++) {
      const batch = [...outbox];
      let behind = false;
      try {
        behind = await commitBatch(batch, `Update by ${s.login}`);
      } catch (e) {
        // Someone else saved first: start again from their version.
        if ((e as GitHubError).status === 422 && attempt < 4) {
          head = null;
          headEtag = null;
          await doPull();
          continue;
        }
        throw e;
      }
      for (const k of batch) outbox.delete(k);
      saveList(OUTBOX_KEY, outbox);
      // Our commit sat on top of edits we hadn't seen yet: bring them in.
      if (behind) await doPull();
      break;
    }
    useSync.setState({ pending: outbox.size, status: outbox.size ? 'syncing' : 'synced', problem: null });
    if (outbox.size) schedulePush(0);
  } catch (e) {
    useSync.setState({ status: navigator.onLine ? 'error' : 'offline', problem: (e as Error).message });
    schedulePush(20_000);
  } finally {
    pushing = false;
  }
}

/**
 * One commit: tree.json with the batch's rows applied, plus new and removed files.
 * Returns true when GitHub had commits we hadn't pulled yet (they're kept, not overwritten).
 */
async function commitBatch(batch: string[], message: string): Promise<boolean> {
  const ref = await gh<{ object: { sha: string } }>(`/repos/${sharedRepo}/git/ref/heads/${branch}`);
  const base = ref.object.sha;
  const file = await readTree(base);
  const entries: GitTreeEntry[] = [];
  for (const k of batch) {
    const [t, id] = k.split('\u0001') as [SyncedTable, string];
    const row = (await db.table(t).get(id)) as Row | undefined;
    if (row) file.tables[t][id] = toData(t, row);
    else delete file.tables[t][id];
    if (t === 'media') {
      if (row) entries.push(...(await mediaEntries(row as unknown as MediaRecord)));
      else entries.push({ path: mediaFile(id, 'blob'), mode: '100644', type: 'blob', sha: null }, { path: mediaFile(id, 'thumb'), mode: '100644', type: 'blob', sha: null });
    }
  }
  if (!file.name) file.name = treeName || 'Family tree';
  const newHead = await commit(base, file, entries, message);
  for (const k of batch) {
    const [t, id] = k.split('\u0001');
    if (t === 'media') uploaded.add(id);
  }
  saveList(UPLOADED_KEY, uploaded);
  const behind = base !== head;
  head = behind ? null : newHead;
  headEtag = null;
  return behind;
}

interface GitTreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha?: string | null;
  content?: string;
}

async function mediaEntries(rec: MediaRecord): Promise<GitTreeEntry[]> {
  if (!rec.blob || uploaded.has(rec.id)) return [];
  const out: GitTreeEntry[] = [{ path: mediaFile(rec.id, 'blob'), mode: '100644', type: 'blob', sha: await gitBlob(rec.blob) }];
  if (rec.thumb) out.push({ path: mediaFile(rec.id, 'thumb'), mode: '100644', type: 'blob', sha: await gitBlob(rec.thumb) });
  return out;
}

async function gitBlob(b: Blob, repo = sharedRepo!, token?: string): Promise<string> {
  const res = await gh<{ sha: string }>(`/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: await toBase64(b), encoding: 'base64' }), token });
  return res.sha;
}

async function commit(base: string, file: TreeFile, entries: GitTreeEntry[], message: string, repo = sharedRepo!, token?: string): Promise<string> {
  const baseCommit = await gh<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${base}`, { token });
  const tree = await gh<{ sha: string }>(`/repos/${repo}/git/trees`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: [{ path: 'tree.json', mode: '100644', type: 'blob', content: JSON.stringify(file, null, 1) }, ...entries],
    }),
  });
  const c = await gh<{ sha: string }>(`/repos/${repo}/git/commits`, { method: 'POST', token, body: JSON.stringify({ message, tree: tree.sha, parents: [base] }) });
  // Not forced: if someone else committed meanwhile this fails (422) and the caller retries.
  await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', token, body: JSON.stringify({ sha: c.sha, force: false }) });
  return c.sha;
}

function toBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/* ------------------------------------------------------------ sign-in */

/** Checks a pasted token and saves it in this browser. Returns the GitHub username. */
export async function signIn(token: string): Promise<string> {
  const t = token.trim();
  if (!t) throw new Error('Paste the token first.');
  const res = await fetch(`${API}/user`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' } });
  if (res.status === 401) throw new Error('GitHub didn’t accept that token. Check you copied all of it.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Try again in a moment.`);
  const scopes = res.headers.get('X-OAuth-Scopes');
  if (scopes !== null && !scopes.split(',').map((s) => s.trim()).includes('repo'))
    throw new Error('That token is missing the “repo” box. Make a new one with the link above (it ticks “repo” for you).');
  const { login } = (await res.json()) as { login: string };
  setToken(t);
  useSync.setState({ login });
  if (sharedRepo) {
    useSync.setState({ status: 'connecting', firstLoad: true });
    await connect();
  }
  return login;
}

export function signOut() {
  setToken(null);
  useSync.setState({ login: null, canEdit: !sharedRepo, isOwner: false, status: sharedRepo ? 'signin' : 'local' });
}

/** In the private tree, the sign-in is only needed for sharing. */
export async function loadSession(): Promise<void> {
  if (!getToken()) return;
  try {
    const user = await gh<{ login: string }>('/user');
    useSync.setState({ login: user.login });
  } catch {
    /* expired: the share panel asks again */
  }
}

/* ------------------------------------------------------------ sharing */

/**
 * Uploads the private tree in this browser to a new private repository and returns the
 * link to it. `progress` gets (done, total) as files go up.
 */
export async function shareLocalTree(name: string, progress: (done: number, total: number) => void): Promise<string> {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'family';
  let repo: { full_name: string; default_branch: string } | null = null;
  for (let i = 1; !repo && i < 20; i++) {
    try {
      repo = await gh('/user/repos', {
        method: 'POST',
        body: JSON.stringify({
          name: `${slug}-tree${i > 1 ? `-${i}` : ''}`,
          private: true,
          auto_init: true,
          description: `${name}: shared family tree (Herbarium). Private: only people added here can see it.`,
          has_issues: false,
          has_wiki: false,
          has_projects: false,
        }),
      });
    } catch (e) {
      if ((e as GitHubError).status !== 422) throw e;
    }
  }
  if (!repo) throw new Error('Couldn’t create a repository name. Try a different name.');
  branch = repo.default_branch || 'main';
  const full = repo.full_name;

  const tables = emptyTables();
  const media = (await db.media.toArray()) as MediaRecord[];
  for (const t of SYNCED_TABLES) for (const r of (await db.table(t).toArray()) as Row[]) tables[t][r.id] = toData(t, r);
  const total = media.length + 1;
  progress(0, total);
  const entries: GitTreeEntry[] = [];
  let done = 0;
  for (const rec of media) {
    if (rec.blob) entries.push({ path: mediaFile(rec.id, 'blob'), mode: '100644', type: 'blob', sha: await gitBlob(rec.blob, full) });
    if (rec.thumb) entries.push({ path: mediaFile(rec.id, 'thumb'), mode: '100644', type: 'blob', sha: await gitBlob(rec.thumb, full) });
    progress(++done, total);
  }
  // A fresh repository can take a moment before its first commit is readable.
  let base: string | null = null;
  for (let i = 0; i < 10 && !base; i++) {
    try {
      base = (await gh<{ object: { sha: string } }>(`/repos/${full}/git/ref/heads/${branch}`)).object.sha;
    } catch {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!base) throw new Error('GitHub created the repository but it isn’t ready yet. Try again in a minute.');
  await commit(base, { format: 'herbarium-shared-tree', version: 1, name: name.trim() || 'Family tree', tables }, entries, `Share ${name}`, full);
  progress(total, total);
  return treeLink(full);
}

/* ------------------------------------------------------------ people who can edit */

export interface Member {
  login: string;
  pending: boolean;
  /** Invitation id, to cancel a pending one. */
  invitationId?: number;
}

export async function listMembers(): Promise<Member[]> {
  const [collabs, invites] = await Promise.all([
    gh<{ login: string }[]>(`/repos/${sharedRepo}/collaborators?affiliation=direct&per_page=100`),
    gh<{ id: number; invitee: { login: string } | null }[]>(`/repos/${sharedRepo}/invitations?per_page=100`),
  ]);
  const me = useSync.getState().login;
  return [
    ...collabs.filter((c) => c.login !== me).map((c) => ({ login: c.login, pending: false })),
    ...invites.filter((i) => i.invitee).map((i) => ({ login: i.invitee!.login, pending: true, invitationId: i.id })),
  ];
}

export async function addMember(username: string): Promise<void> {
  const u = username.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(u)) throw new Error('That doesn’t look like a GitHub username (letters, numbers and dashes).');
  try {
    await gh(`/repos/${sharedRepo}/collaborators/${u}`, { method: 'PUT', body: JSON.stringify({ permission: 'push' }) });
  } catch (e) {
    if ((e as GitHubError).status === 404) throw new Error(`There’s no GitHub user called “${u}”.`);
    throw e;
  }
}

export async function removeMember(m: Member): Promise<void> {
  if (m.pending && m.invitationId) await gh(`/repos/${sharedRepo}/invitations/${m.invitationId}`, { method: 'DELETE' });
  else await gh(`/repos/${sharedRepo}/collaborators/${m.login}`, { method: 'DELETE' });
}
