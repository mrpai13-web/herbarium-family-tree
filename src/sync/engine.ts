/**
 * Keeps a shared tree's local cache (IndexedDB) and Supabase in step.
 *
 * Access is members only (see supabase/schema.sql): people sign in with an emailed code,
 * and the database lets them read the tree only if the owner invited that email, and
 * write only as an editor.
 *
 * Local edits: the db middleware reports every touched row id; ids wait in an outbox
 * (kept in localStorage, so they survive a reload or going offline) and are pushed a
 * moment later by reading the row's current value: present -> upsert, gone -> cleared.
 * Photos and audio are uploaded to private storage before their row, so readers never
 * see a row whose file isn't there yet.
 *
 * Remote edits: rows are pulled by sequence number on start, every 20 s, when the tab
 * comes back, and right away when another member broadcasts "changed". Last write wins
 * per row. Our own echoes, and rows we still have unsent edits for, are skipped so a
 * slow round trip can't undo a newer local edit.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import type { MediaRecord } from '../core/types';
import { db, onLocalChange, writeRemote, SYNCED_TABLES, type SyncedTable } from '../data/db';
import { mediaPath, setRemoteMediaFetcher, sharedTree, SUPABASE_KEY, SUPABASE_URL, syncConfigured, treeLink } from './config';

export type SyncStatus = 'local' | 'signin' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'missing' | 'error';
export type Role = 'owner' | 'editor' | 'viewer';

interface SyncState {
  status: SyncStatus;
  /** Signed-in email, if any. */
  email: string | null;
  role: Role | null;
  canEdit: boolean;
  isOwner: boolean;
  treeName: string;
  pending: number;
  /** Human-readable problem, shown in the share panel. */
  problem: string | null;
  /** Set while the first download of a shared tree is running. */
  firstLoad: boolean;
}

export const useSync = create<SyncState>(() => ({
  status: sharedTree ? 'connecting' : 'local',
  email: null,
  role: null,
  canEdit: !sharedTree,
  isOwner: false,
  treeName: '',
  pending: 0,
  problem: null,
  firstLoad: Boolean(sharedTree),
}));

/** True when edits are allowed here: the private tree, or a shared tree you may edit. */
export const canEditNow = () => useSync.getState().canEdit;

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!syncConfigured) throw new Error('Sharing isn’t set up on this site yet.');
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  return client;
}

/** Identifies this page load, so our own rows coming back can be recognised. */
const CLIENT_ID = crypto.randomUUID();
const BUCKET = 'family-media';

/* ------------------------------------------------------------ row mapping */

type Row = Record<string, unknown> & { id: string };

/** What goes to the server for a row: media without its binaries. */
export function toData(table: SyncedTable, row: Row): Record<string, unknown> {
  if (table !== 'media') return row;
  const { blob, thumb, remote, ...meta } = row as unknown as MediaRecord & { remote?: boolean };
  void blob;
  void remote;
  const was = row as { hasThumb?: boolean; thumbMime?: string };
  return { ...meta, hasThumb: Boolean(thumb) || Boolean(was.hasThumb), thumbMime: thumb?.type || was.thumbMime };
}

/** A media row from the server: files stay in storage and download when first shown. */
function fromData(table: SyncedTable, data: Record<string, unknown>, local?: Row): Row {
  if (table !== 'media') return data as Row;
  // Keep binaries we already have (e.g. our own upload) when only the caption changed.
  const l = local as { blob?: Blob; thumb?: Blob } | undefined;
  if (l?.blob) return { ...data, blob: l.blob, thumb: l.thumb, remote: false } as unknown as Row;
  return { ...data, remote: true } as unknown as Row;
}

/* ------------------------------------------------------------ outbox */

const OUTBOX_KEY = sharedTree ? `herbarium-outbox-${sharedTree}` : '';
const UPLOADED_KEY = sharedTree ? `herbarium-uploaded-${sharedTree}` : '';
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
    /* storage blocked: the outbox still works for this session */
  }
}

/* ------------------------------------------------------------ start */

let started = false;
let live = false;
let reload: () => Promise<void> = async () => {};
let channel: RealtimeChannel | null = null;

/**
 * Connects a shared tree. `onRemote` re-reads the local cache into the app after
 * other people's rows were written to it. Does nothing for the private tree.
 */
export async function startSync(onRemote: () => Promise<void>): Promise<void> {
  if (!sharedTree || started) return;
  started = true;
  reload = onRemote;
  setRemoteMediaFetcher(downloadMedia);
  if (!syncConfigured) {
    useSync.setState({ status: 'error', firstLoad: false, problem: 'Sharing isn’t set up on this site yet.' });
    return;
  }
  const sb = supabase();

  onLocalChange((table, ids) => {
    for (const id of ids) outbox.add(key(table, id));
    saveList(OUTBOX_KEY, outbox);
    useSync.setState({ pending: outbox.size });
    schedulePush();
  });
  useSync.setState({ pending: outbox.size });

  const { data: sess } = await sb.auth.getSession();
  useSync.setState({ email: sess.session?.user.email ?? null });
  sb.auth.onAuthStateChange((_e, s) => {
    const email = s?.user.email ?? null;
    if (email !== useSync.getState().email) {
      useSync.setState({ email });
      void connect();
    }
  });

  setInterval(() => void pull(), 20_000);
  window.addEventListener('focus', () => void pull());
  window.addEventListener('online', () => {
    void pull();
    schedulePush(0);
  });
  await connect();
}

/** Checks who is signed in and their role in this tree, then downloads it. */
async function connect(): Promise<void> {
  const sb = supabase();
  if (!useSync.getState().email) {
    live = false;
    await forgetLocalCopy();
    useSync.setState({ status: 'signin', role: null, canEdit: false, isOwner: false, firstLoad: false, problem: null });
    return;
  }
  const { data, error } = await sb.rpc('tree_info', { p_tree: sharedTree });
  if (error) {
    useSync.setState({ status: navigator.onLine ? 'error' : 'offline', firstLoad: false, problem: error.message });
    return;
  }
  const info = (data as { name: string; role: Role }[])[0];
  if (!info) {
    live = false;
    // Not (or no longer) invited: don't keep a copy of the tree in this browser.
    await forgetLocalCopy();
    useSync.setState({
      status: 'missing',
      role: null,
      canEdit: false,
      isOwner: false,
      firstLoad: false,
      problem: `${useSync.getState().email} isn’t invited to this tree. Ask whoever sent the link to add this email address, or sign in with the one they added.`,
    });
    return;
  }
  live = true;
  useSync.setState({
    treeName: info.name,
    role: info.role,
    canEdit: info.role !== 'viewer',
    isOwner: info.role === 'owner',
    problem: null,
    status: 'connecting',
  });
  await pull();
  useSync.setState({ firstLoad: false });
  if (!channel) {
    channel = sb.channel(`tree:${sharedTree}`);
    channel.on('broadcast', { event: 'changed' }, () => void pull()).subscribe();
  }
  if (outbox.size) schedulePush(0);
}

/**
 * Removes this browser's copy of the shared tree, so a signed-out or removed person (or the
 * next person on a shared computer) can't see it. Unsent edits are dropped too.
 */
async function forgetLocalCopy(): Promise<void> {
  const had = (await db.people.count()) + (await db.media.count()) > 0 || outbox.size > 0;
  outbox.clear();
  uploaded.clear();
  saveList(OUTBOX_KEY, outbox);
  saveList(UPLOADED_KEY, uploaded);
  useSync.setState({ pending: 0 });
  if (!had) return;
  await writeRemote(async () => {
    for (const t of SYNCED_TABLES) await db.table(t).clear();
  });
  await db.meta.delete('syncSeq');
  await reload();
}

/* ------------------------------------------------------------ pull */

let pulling: Promise<void> | null = null;

export function pull(): Promise<void> {
  if (!live) return Promise.resolve();
  pulling ??= doPull().finally(() => (pulling = null));
  return pulling;
}

async function doPull() {
  const sb = supabase();
  // A small overlap catches rows whose sequence number was taken just before a
  // slower write committed; applying a row twice is harmless.
  let since = Math.max(0, (((await db.meta.get('syncSeq'))?.value as number) ?? 0) - 25);
  let changed = false;
  for (;;) {
    const { data, error } = await sb
      .from('records')
      .select('tbl, id, data, deleted, seq, client')
      .eq('tree_id', sharedTree!)
      .gt('seq', since)
      .order('seq')
      .limit(1000);
    if (error) {
      useSync.setState({ status: navigator.onLine ? 'error' : 'offline', problem: error.message });
      return;
    }
    const rows = data as { tbl: SyncedTable; id: string; data: Record<string, unknown> | null; deleted: boolean; seq: number; client: string | null }[];
    if (!rows.length) break;
    const fresh = rows.filter((r) => r.client !== CLIENT_ID && !outbox.has(key(r.tbl, r.id)) && SYNCED_TABLES.includes(r.tbl));
    if (fresh.length) {
      await writeRemote(async () => {
        for (const r of fresh) {
          const table = db.table(r.tbl);
          if (r.deleted || !r.data) await table.delete(r.id);
          else await table.put(fromData(r.tbl, r.data, await table.get(r.id)));
        }
      });
      changed = true;
    }
    since = rows[rows.length - 1].seq;
    await db.meta.put({ key: 'syncSeq', value: since });
    if (rows.length < 1000) break;
  }
  if (changed) await reload();
  if (!outbox.size) useSync.setState({ status: 'synced', problem: null });
}

/** Downloads a photo or recording (members only) and caches it in IndexedDB. */
async function downloadMedia(id: string, which: 'blob' | 'thumb'): Promise<Blob | undefined> {
  if (!live) return undefined;
  const { data, error } = await supabase().storage.from(BUCKET).download(mediaPath(sharedTree!, id, which));
  if (error || !data) return undefined;
  const rec = (await db.media.get(id)) as (MediaRecord & { thumbMime?: string }) | undefined;
  const type = which === 'blob' ? rec?.mime : rec?.thumbMime;
  const blob = type && data.type !== type ? new Blob([data], { type }) : data;
  if (rec) await writeRemote(() => db.media.update(id, which === 'blob' ? { blob } : { thumb: blob }));
  return blob;
}

/* ------------------------------------------------------------ push */

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;

function schedulePush(delay = 700) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function push() {
  const s = useSync.getState();
  if (pushing || !outbox.size || !live || !s.canEdit) return;
  pushing = true;
  useSync.setState({ status: 'syncing' });
  const sb = supabase();
  const tree = sharedTree!;
  try {
    const batch = [...outbox].slice(0, 200);
    const upserts: Record<string, unknown>[] = [];
    for (const k of batch) {
      const [t, id] = k.split('\u0001') as [SyncedTable, string];
      const row = (await db.table(t).get(id)) as Row | undefined;
      if (row && t === 'media') await uploadFiles(sb, tree, row as unknown as MediaRecord);
      if (!row && t === 'media') void removeFiles(sb, tree, id);
      upserts.push({ tree_id: tree, tbl: t, id, data: row ? toData(t, row) : null, deleted: !row, client: CLIENT_ID });
    }
    const { error } = await sb.from('records').upsert(upserts, { onConflict: 'tree_id,tbl,id' });
    if (error) throw new Error(error.message);
    for (const k of batch) outbox.delete(k);
    saveList(OUTBOX_KEY, outbox);
    useSync.setState({ pending: outbox.size, status: outbox.size ? 'syncing' : 'synced', problem: null });
    if (channel?.state === 'joined') void channel.send({ type: 'broadcast', event: 'changed', payload: {} });
    if (outbox.size) schedulePush(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    useSync.setState({ status: navigator.onLine ? 'error' : 'offline', problem: msg });
    schedulePush(15_000);
  } finally {
    pushing = false;
  }
}

async function uploadFiles(sb: SupabaseClient, tree: string, rec: MediaRecord) {
  if (!rec.blob || uploaded.has(rec.id)) return;
  await putFile(sb, mediaPath(tree, rec.id, 'blob'), rec.blob, rec.mime);
  if (rec.thumb) await putFile(sb, mediaPath(tree, rec.id, 'thumb'), rec.thumb, rec.thumb.type || 'image/webp');
  uploaded.add(rec.id);
  saveList(UPLOADED_KEY, uploaded);
}

async function putFile(sb: SupabaseClient, path: string, blob: Blob, type: string) {
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type || blob.type, upsert: false, cacheControl: '31536000' });
  // Media files never change once written, so "already there" is fine.
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Uploading a file failed: ${error.message}`);
}

async function removeFiles(sb: SupabaseClient, tree: string, id: string) {
  await sb.storage.from(BUCKET).remove([mediaPath(tree, id, 'blob'), mediaPath(tree, id, 'thumb')]);
}

/* ------------------------------------------------------------ sign-in */

/** Emails a sign-in code (and link) to this address. */
export async function sendSignInCode(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That doesn’t look like an email address.');
  const { error } = await supabase().auth.signInWithOtp({ email: e, options: { emailRedirectTo: location.href.split('#')[0] } });
  if (error) throw new Error(/rate|seconds/i.test(error.message) ? 'Too many codes sent just now. Wait a minute and try again.' : error.message);
}

/** Signs in with the code from the email. */
export async function verifySignInCode(email: string, code: string): Promise<void> {
  const { error } = await supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\s/g, ''), type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code didn’t work. It may have expired: send a new one.' : error.message);
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
  useSync.setState({ email: null });
  if (sharedTree) await connect();
}

/** In the private tree, sign-in state is only needed for sharing. */
export async function loadSession(): Promise<void> {
  if (!syncConfigured) return;
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  useSync.setState({ email: data.session?.user.email ?? null });
  sb.auth.onAuthStateChange((_e, s) => useSync.setState({ email: s?.user.email ?? null }));
}

/* ------------------------------------------------------------ sharing */

/**
 * Uploads the private tree in this browser as a new shared tree and returns its link.
 * `progress` gets (done, total) as rows and files go up.
 */
export async function shareLocalTree(name: string, progress: (done: number, total: number) => void): Promise<string> {
  const sb = supabase();
  // The id is made here: reading a just-created row back can trip the database's
  // own privacy rules in the same statement.
  const id = crypto.randomUUID();
  const { error } = await sb.from('trees').insert({ id, name: name.trim() || 'Family tree' });
  if (error) throw new Error(error.message);

  const tables = await Promise.all(SYNCED_TABLES.map(async (t) => [t, (await db.table(t).toArray()) as Row[]] as const));
  const total = tables.reduce((s, [, rows]) => s + rows.length, 0);
  let done = 0;
  progress(0, total);
  for (const [t, rows] of tables) {
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      if (t === 'media') {
        for (const r of slice) {
          const rec = r as unknown as MediaRecord;
          if (rec.blob) {
            await putFile(sb, mediaPath(id, rec.id, 'blob'), rec.blob, rec.mime);
            if (rec.thumb) await putFile(sb, mediaPath(id, rec.id, 'thumb'), rec.thumb, rec.thumb.type || 'image/webp');
          }
          progress(++done, total);
        }
      } else {
        done += slice.length;
      }
      const { error: e2 } = await sb
        .from('records')
        .upsert(slice.map((r) => ({ tree_id: id, tbl: t, id: r.id, data: toData(t, r), deleted: false, client: CLIENT_ID })), { onConflict: 'tree_id,tbl,id' });
      if (e2) throw new Error(e2.message);
      progress(done, total);
    }
  }
  return treeLink(id);
}

export interface Member {
  email: string;
  role: 'viewer' | 'editor';
  added_at: string;
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase().from('tree_members').select('email, role, added_at').eq('tree_id', sharedTree!).order('added_at');
  if (error) throw new Error(error.message);
  return data as Member[];
}

export async function addMember(email: string, role: Member['role']): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That doesn’t look like an email address.');
  const { error } = await supabase().from('tree_members').upsert({ tree_id: sharedTree!, email: e, role }, { onConflict: 'tree_id,email' });
  if (error) throw new Error(error.message);
}

export async function setMemberRole(email: string, role: Member['role']): Promise<void> {
  const { error } = await supabase().from('tree_members').update({ role }).eq('tree_id', sharedTree!).eq('email', email);
  if (error) throw new Error(error.message);
}

export async function removeMember(email: string): Promise<void> {
  const { error } = await supabase().from('tree_members').delete().eq('tree_id', sharedTree!).eq('email', email);
  if (error) throw new Error(error.message);
}
