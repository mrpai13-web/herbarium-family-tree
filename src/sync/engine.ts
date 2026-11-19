/**
 * Keeps a shared tree's local cache (IndexedDB) and Supabase in step.
 *
 * Local edits: the db middleware reports every touched row id; ids wait in an outbox
 * (kept in localStorage, so they survive a reload or going offline) and are pushed a
 * moment later by reading the row's current value: present -> upsert, gone -> soft delete.
 * Photos and audio are uploaded to storage before their row, so readers never see a row
 * whose file isn't there yet.
 *
 * Remote edits: rows are pulled by sequence number (`pull_tree`) on start, every 20 s,
 * when the tab comes back, and right away when another editor broadcasts "changed".
 * Last write wins per row. Our own echoes, and rows we still have unsent edits for,
 * are skipped so a slow round trip can't undo a newer local edit.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import type { MediaRecord } from '../core/types';
import { db, onLocalChange, writeRemote, SYNCED_TABLES, type SyncedTable } from '../data/db';
import { mediaPath, sharedTreeId, SUPABASE_KEY, SUPABASE_URL, syncConfigured, treeLink } from './config';

export type SyncStatus = 'local' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'missing' | 'error';

interface SyncState {
  status: SyncStatus;
  /** Signed-in email, if any. */
  email: string | null;
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
  status: sharedTreeId ? 'connecting' : 'local',
  email: null,
  canEdit: !sharedTreeId,
  isOwner: false,
  treeName: '',
  pending: 0,
  problem: null,
  firstLoad: Boolean(sharedTreeId),
}));

/** True when edits are allowed here: the private tree, or a shared tree you may edit. */
export const canEditNow = () => useSync.getState().canEdit;

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!syncConfigured) throw new Error('Sharing is not set up on this site (no Supabase keys).');
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  return client;
}

/** Identifies this page load, so our own rows coming back can be recognised. */
const CLIENT_ID = crypto.randomUUID();

/* ------------------------------------------------------------ row mapping */

type Row = Record<string, unknown> & { id: string };

/** What goes to the server for a row: media without its binaries. */
export function toData(table: SyncedTable, row: Row): Record<string, unknown> {
  if (table !== 'media') return row;
  const { blob, thumb, remote, ...meta } = row as unknown as MediaRecord & { remote?: boolean; hasThumb?: boolean };
  void blob;
  void remote;
  return { ...meta, hasThumb: Boolean(thumb) || Boolean((row as { hasThumb?: boolean }).hasThumb) };
}

/** A media row from the server: files stay in storage, fetched by URL when shown. */
export function fromData(table: SyncedTable, data: Record<string, unknown>, local?: Row): Row {
  if (table !== 'media') return data as Row;
  // Keep binaries we already have (e.g. our own upload) when only the caption changed.
  if (local && (local as { blob?: Blob }).blob) return { ...local, ...data, remote: false } as Row;
  return { ...data, remote: true } as unknown as Row;
}

/* ------------------------------------------------------------ outbox */

const OUTBOX_KEY = sharedTreeId ? `herbarium-outbox-${sharedTreeId}` : '';
const UPLOADED_KEY = sharedTreeId ? `herbarium-uploaded-${sharedTreeId}` : '';
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
let reload: () => Promise<void> = async () => {};
let channel: RealtimeChannel | null = null;

/**
 * Connects a shared tree. `onRemote` re-reads the local cache into the app after
 * remote rows were written. Does nothing for the private tree.
 */
export async function startSync(onRemote: () => Promise<void>): Promise<void> {
  if (!sharedTreeId || started) return;
  started = true;
  reload = onRemote;
  const sb = supabase();

  const { data: sess } = await sb.auth.getSession();
  useSync.setState({ email: sess.session?.user.email ?? null });
  sb.auth.onAuthStateChange((_e, s) => {
    const email = s?.user.email ?? null;
    if (email !== useSync.getState().email) {
      useSync.setState({ email });
      void refreshAccess();
    }
  });

  onLocalChange((table, ids) => {
    for (const id of ids) outbox.add(key(table, id));
    saveList(OUTBOX_KEY, outbox);
    useSync.setState({ pending: outbox.size });
    schedulePush();
  });
  useSync.setState({ pending: outbox.size });

  await refreshAccess();
  if (useSync.getState().status === 'missing') return;
  await pull();
  useSync.setState({ firstLoad: false });
  if (outbox.size) schedulePush(0);

  channel = sb.channel(`tree:${sharedTreeId}`);
  channel.on('broadcast', { event: 'changed' }, () => void pull()).subscribe();

  setInterval(() => void pull(), 20_000);
  window.addEventListener('focus', () => void pull());
  window.addEventListener('online', () => {
    void pull();
    schedulePush(0);
  });
}

/** Re-checks whether this tree exists and whether the signed-in person may edit it. */
export async function refreshAccess(): Promise<void> {
  if (!sharedTreeId) return;
  const { data, error } = await supabase().rpc('tree_info', { p_tree: sharedTreeId });
  if (error) {
    useSync.setState({ status: navigator.onLine ? 'error' : 'offline', problem: error.message });
    return;
  }
  const info = (data as { name: string; can_edit: boolean; is_owner: boolean }[])[0];
  if (!info) {
    useSync.setState({ status: 'missing', firstLoad: false, problem: 'This shared tree no longer exists, or the link is incomplete.' });
    return;
  }
  useSync.setState({ treeName: info.name, canEdit: info.can_edit, isOwner: info.is_owner, problem: null });
  if (info.can_edit && outbox.size) schedulePush(0);
}

/* ------------------------------------------------------------ pull */

let pulling: Promise<void> | null = null;

export function pull(): Promise<void> {
  pulling ??= doPull().finally(() => (pulling = null));
  return pulling;
}

async function doPull() {
  const tree = sharedTreeId!;
  const sb = supabase();
  // A small overlap catches rows whose sequence number was taken just before a
  // slower write committed; applying a row twice is harmless.
  let since = Math.max(0, (((await db.meta.get('syncSeq'))?.value as number) ?? 0) - 25);
  let changed = false;
  for (;;) {
    const { data, error } = await sb.rpc('pull_tree', { p_tree: tree, p_since: since, p_limit: 1000 });
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

/* ------------------------------------------------------------ push */

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;

function schedulePush(delay = 700) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function push() {
  const s = useSync.getState();
  if (pushing || !outbox.size || !s.canEdit || s.status === 'missing') return;
  pushing = true;
  useSync.setState({ status: 'syncing' });
  const sb = supabase();
  const tree = sharedTreeId!;
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
    void channel?.send({ type: 'broadcast', event: 'changed', payload: {} });
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
  const { error } = await sb.storage.from('family-media').upload(path, blob, { contentType: type || blob.type, upsert: false, cacheControl: '31536000' });
  // Media files never change once written, so "already there" is fine.
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Uploading a file failed: ${error.message}`);
}

async function removeFiles(sb: SupabaseClient, tree: string, id: string) {
  await sb.storage.from('family-media').remove([mediaPath(tree, id, 'blob'), mediaPath(tree, id, 'thumb')]);
}

/* ------------------------------------------------------------ sign-in */

export async function sendSignInLink(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.href.split('#')[0] } });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
  useSync.setState({ email: null });
  await refreshAccess();
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
  const { data: tree, error } = await sb.from('trees').insert({ name: name.trim() || 'Family tree' }).select('id').single();
  if (error) throw new Error(error.message);
  const id = (tree as { id: string }).id;

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
  added_at: string;
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase().from('tree_members').select('email, added_at').eq('tree_id', sharedTreeId!).order('added_at');
  if (error) throw new Error(error.message);
  return data as Member[];
}

export async function addMember(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That doesn’t look like an email address.');
  const { error } = await supabase().from('tree_members').insert({ tree_id: sharedTreeId!, email: e });
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
}

export async function removeMember(email: string): Promise<void> {
  const { error } = await supabase().from('tree_members').delete().eq('tree_id', sharedTreeId!).eq('email', email);
  if (error) throw new Error(error.message);
}
