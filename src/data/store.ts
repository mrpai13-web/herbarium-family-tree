/**
 * App state (zustand) with write-through persistence to IndexedDB.
 * The graph (people + links + unions) lives in memory; media blobs stay in
 * IndexedDB and are loaded on demand as object URLs.
 */
import { create } from 'zustand';
import {
  addChildOfCouple, blankPerson, connect, connectToCouple, quickAdd, removePerson,
  type ConnectAs, type ConnectOptions, type QuickAddResult,
} from '../core/relations';
import type {
  AddDirection,
  Group,
  ParentKind,
  FamilyGraph,
  Id,
  MediaMeta,
  MediaRecord,
  ParentLink,
  Person,
  Union,
} from '../core/types';
import { newId } from '../core/relations';
import { fullName } from '../core/dates';
import { nextGroupColor, suggestGroupName } from '../core/groups';
import { db } from './db';
import { analyseAudio, compressImage, forgetAllMediaUrls, forgetMediaUrl } from './media';
import { buildSeed } from './seed';

/** An "are you sure?" question shown in the confirm dialog. */
export interface Ask {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

/** Everything undo needs to put the archive back: the graph, media metadata, and the
 *  full media records (with blobs) that the step deleted, so they can be restored. */
export interface Snapshot {
  graph: FamilyGraph;
  media: Record<Id, MediaMeta>;
  records: MediaRecord[];
}
export interface HistoryEntry extends Snapshot {
  /** What the step did, e.g. "Delete Elena Ashby". */
  label: string;
}
/** How many steps back undo can go. */
const HISTORY = 60;

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'error';
}

interface State {
  ready: boolean;
  graph: FamilyGraph;
  /** Media metadata (no blobs), keyed by id. */
  media: Record<Id, MediaMeta>;
  selectedId: Id | null;
  /** Ids created in this session that should play their grow/bloom animation once. */
  fresh: Set<Id>;
  /** Person whose name field should grab focus when the drawer opens. */
  focusNameOf: Id | null;
  toasts: Toast[];
  /** The open confirm dialog, if any. */
  asking: (Ask & { resolve(ok: boolean): void }) | null;
  /** The group whose box is drawn on the tree (non-members fade), if any. */
  shownGroupId: Id | null;
  /** While true, clicking a card adds it to / removes it from the shown group. */
  groupEditing: boolean;
  /** Undo / redo stacks (newest last). Cleared by importing, restoring the sample or starting over. */
  past: HistoryEntry[];
  future: HistoryEntry[];

  undo(): Promise<void>;
  redo(): Promise<void>;

  /** New group (optionally with members); it's shown and opened for editing. */
  createGroup(memberIds?: Id[]): Promise<Id>;
  updateGroup(id: Id, patch: Partial<Omit<Group, 'id'>>): Promise<void>;
  deleteGroup(id: Id): Promise<void>;
  toggleGroupMember(groupId: Id, personId: Id): Promise<void>;
  /** Make this group the main family (its name titles the archive), or none. */
  setCoreGroup(id: Id | null): Promise<void>;
  showGroup(id: Id | null): void;
  setGroupEditing(on: boolean): void;

  load(): Promise<void>;
  /** Re-read everything from IndexedDB (after a shared tree pulled other people's edits). */
  reload(): Promise<void>;
  /** Shows the confirm dialog; resolves true if the user confirms. */
  ask(q: Ask): Promise<boolean>;
  /** Adds someone not yet connected to anyone, selected and ready to name. */
  addPerson(): Promise<Id>;
  /** Connects two people already in the tree. Shows a toast and returns false when it would make no sense. */
  connectPeople(id: Id, otherId: Id, as: ConnectAs, opts?: ConnectOptions): Promise<boolean>;
  select(id: Id | null): void;
  sprout(anchorId: Id, dir: AddDirection): Promise<Id>;
  /** A new child of both partners in a union. */
  sproutCoupleChild(unionId: Id): Promise<Id>;
  /** Makes an existing person the child of both partners in a union. */
  connectCoupleChild(childId: Id, unionId: Id, kind: ParentKind): Promise<boolean>;
  updatePerson(id: Id, patch: Partial<Person>): Promise<void>;
  updateParentLink(id: Id, patch: Partial<ParentLink>): Promise<void>;
  removeParentLink(id: Id): Promise<void>;
  updateUnion(id: Id, patch: Partial<Union>): Promise<void>;
  removeUnion(id: Id): Promise<void>;
  /** Removes parent links and/or partnerships as one undo step. */
  breakConnection(linkIds: Id[], unionIds: Id[], label: string): Promise<void>;
  deletePerson(id: Id): Promise<void>;
  addImages(personId: Id, files: File[], asPortrait?: boolean): Promise<void>;
  addAudio(personId: Id, blob: Blob, title: string, recordedAt?: string): Promise<void>;
  updateMedia(id: Id, patch: Partial<MediaMeta>): Promise<void>;
  removeMedia(id: Id): Promise<void>;
  replaceAll(graph: FamilyGraph, media: MediaRecord[]): Promise<void>;
  startBlank(): Promise<void>;
  restoreSample(): Promise<void>;
  consumeFresh(id: Id): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
}

const strip = ({ blob: _b, thumb: _t, ...meta }: MediaRecord): MediaMeta => meta;
let toastId = 0;

let loading: Promise<void> | null = null;

const FIELD_NAMES: Partial<Record<keyof Person, string>> = {
  givenName: 'name', middleName: 'middle name', surname: 'surname', nickname: 'nickname', birthSurname: 'birth surname',
  sex: 'wording', birthDate: 'birth date', deathDate: 'death date', birthplace: 'birthplace', bio: 'story',
  photoId: 'portrait', galleryIds: 'photos', audioIds: 'voice memories',
};

/** While > 0, store actions don't record undo steps (they're part of a bigger step). */
let quiet = 0;
let historyBusy = false;

async function syncTable<T extends { id: Id }>(
  table: { bulkDelete(keys: Id[]): Promise<void>; bulkPut(items: T[]): Promise<unknown> },
  from: Record<Id, T>,
  to: Record<Id, T>,
) {
  await table.bulkDelete(Object.keys(from).filter((k) => !to[k]));
  await table.bulkPut(Object.values(to).filter((v) => from[v.id] !== v));
}

export const useStore = create<State>((set, get) => {
  /** Records an undo step for what is about to change. */
  const checkpoint = (label: string, records: MediaRecord[] = []) => {
    if (quiet) return;
    const s = get();
    set({ past: [...s.past.slice(-(HISTORY - 1)), { label, graph: s.graph, media: s.media, records }], future: [] });
  };

  /** Puts state and IndexedDB back to `target`; returns a snapshot of what was there, for the other stack. */
  const restore = async (target: Snapshot): Promise<Snapshot> => {
    const cur = get();
    const vanish = Object.keys(cur.media).filter((id) => !target.media[id]);
    const kept = (await db.media.bulkGet(vanish)).filter((r): r is MediaRecord => !!r);
    const back = target.records.filter((r) => target.media[r.id] && !cur.media[r.id]);
    set({
      graph: target.graph,
      media: target.media,
      selectedId: cur.selectedId && target.graph.people[cur.selectedId] ? cur.selectedId : null,
      fresh: new Set(),
      focusNameOf: null,
      shownGroupId: cur.shownGroupId && target.graph.groups?.[cur.shownGroupId] ? cur.shownGroupId : null,
    });
    vanish.forEach(forgetMediaUrl);
    await db.transaction('rw', [db.people, db.parentLinks, db.unions, db.media, db.groups], async () => {
      await syncTable(db.people, cur.graph.people, target.graph.people);
      await syncTable(db.parentLinks, cur.graph.parentLinks, target.graph.parentLinks);
      await syncTable(db.unions, cur.graph.unions, target.graph.unions);
      await syncTable(db.groups, cur.graph.groups ?? {}, target.graph.groups ?? {});
      await db.media.bulkDelete(vanish);
      await db.media.bulkPut(back.map((r) => ({ ...r, ...target.media[r.id] })));
      for (const [id, m] of Object.entries(target.media)) if (cur.media[id] && cur.media[id] !== m) await db.media.update(id, m);
    });
    return { graph: cur.graph, media: cur.media, records: kept };
  };

  /** Replaces the groups (one undo step) and writes only what changed. */
  const saveGroups = async (next: Record<Id, Group>, label: string) => {
    const prev = get().graph.groups ?? {};
    checkpoint(label);
    set((s) => ({ graph: { ...s.graph, groups: next } }));
    await syncTable(db.groups, prev, next);
  };

  /** Puts a quick-add result into state and IndexedDB, selects the new person and focuses their name. */
  const applyQuickAdd = async (res: QuickAddResult): Promise<Id> => {
    const fresh = new Set(get().fresh);
    [...res.created, ...res.createdLinks, ...res.createdUnions].forEach((x) => fresh.add(x));
    set({ graph: res.graph, fresh, selectedId: res.personId, focusNameOf: res.personId });
    await db.transaction('rw', db.people, db.parentLinks, db.unions, async () => {
      await db.people.bulkPut(res.created.map((id) => res.graph.people[id]));
      await db.parentLinks.bulkPut(res.createdLinks.map((id) => res.graph.parentLinks[id]));
      await db.unions.bulkPut(res.createdUnions.map((id) => res.graph.unions[id]));
    });
    return res.personId;
  };

  return {
  ready: false,
  graph: { people: {}, parentLinks: {}, unions: {} },
  media: {},
  selectedId: null,
  fresh: new Set(),
  focusNameOf: null,
  toasts: [],
  asking: null,
  past: [],
  future: [],
  shownGroupId: null,
  groupEditing: false,

  async createGroup(memberIds = []) {
    const g = get().graph;
    const gr: Group = { id: newId(), name: suggestGroupName(g, memberIds), memberIds, color: nextGroupColor(g), createdAt: Date.now() };
    await saveGroups({ ...(g.groups ?? {}), [gr.id]: gr }, `Create group “${gr.name}”`);
    set({ shownGroupId: gr.id, groupEditing: true });
    return gr.id;
  },

  async updateGroup(id, patch) {
    const gs = get().graph.groups ?? {};
    if (!gs[id]) return;
    const label = patch.name !== undefined ? `Rename group to “${patch.name}”` : `Edit group “${gs[id].name}”`;
    await saveGroups({ ...gs, [id]: { ...gs[id], ...patch } }, label);
  },

  async deleteGroup(id) {
    const gs = { ...(get().graph.groups ?? {}) };
    const name = gs[id]?.name;
    if (!name) return;
    delete gs[id];
    await saveGroups(gs, `Delete group “${name}”`);
    if (get().shownGroupId === id) set({ shownGroupId: null, groupEditing: false });
  },

  async toggleGroupMember(groupId, personId) {
    const gs = get().graph.groups ?? {};
    const gr = gs[groupId];
    const p = get().graph.people[personId];
    if (!gr || !p) return;
    const has = gr.memberIds.includes(personId);
    const memberIds = has ? gr.memberIds.filter((m) => m !== personId) : [...gr.memberIds, personId];
    await saveGroups(
      { ...gs, [groupId]: { ...gr, memberIds } },
      has ? `Remove ${fullName(p)} from “${gr.name}”` : `Add ${fullName(p)} to “${gr.name}”`,
    );
  },

  async setCoreGroup(id) {
    const gs = get().graph.groups ?? {};
    const next = Object.fromEntries(
      Object.entries(gs).map(([k, gr]) => {
        const core = k === id;
        if (!!gr.core === core) return [k, gr];
        const { core: _c, ...rest } = gr;
        return [k, core ? { ...rest, core: true } : rest];
      }),
    );
    await saveGroups(next, id ? `Make “${gs[id]?.name}” the main family` : 'Clear the main family');
  },

  showGroup(id) {
    set({ shownGroupId: id, groupEditing: id ? get().groupEditing : false });
  },

  setGroupEditing(on) {
    set({ groupEditing: on && !!get().shownGroupId });
  },

  async undo() {
    const entry = get().past.at(-1);
    if (!entry || historyBusy || get().asking) return;
    historyBusy = true;
    try {
      set((s) => ({ past: s.past.slice(0, -1) }));
      const was = await restore(entry);
      set((s) => ({ future: [...s.future, { ...was, label: entry.label }] }));
      get().toast(`Undid “${entry.label}”. Ctrl+Shift+Z redoes it.`);
    } finally {
      historyBusy = false;
    }
  },

  async redo() {
    const entry = get().future.at(-1);
    if (!entry || historyBusy || get().asking) return;
    historyBusy = true;
    try {
      set((s) => ({ future: s.future.slice(0, -1) }));
      const was = await restore(entry);
      set((s) => ({ past: [...s.past, { ...was, label: entry.label }] }));
      get().toast(`Redid “${entry.label}”.`);
    } finally {
      historyBusy = false;
    }
  },

  load() {
    // StrictMode runs effects twice; share one load so the sample is seeded only once.
    loading ??= (async () => {
    const [people, links, unions, meta, groups] = await Promise.all([
      db.people.toArray(),
      db.parentLinks.toArray(),
      db.unions.toArray(),
      db.meta.get('initialised'),
      db.groups.toArray(),
    ]);
    if (!meta && people.length === 0) {
      // First launch: an empty sheet. The sample family is one click away in the Archive menu.
      await db.meta.put({ key: 'initialised', value: Date.now() });
      set({ ready: true });
      return;
    }
    const mediaMeta: Record<Id, MediaMeta> = {};
    await db.media.each((m) => {
      mediaMeta[m.id] = strip(m);
    });
    set({
      graph: {
        people: Object.fromEntries(people.map((p) => [p.id, p])),
        parentLinks: Object.fromEntries(links.map((l) => [l.id, l])),
        unions: Object.fromEntries(unions.map((u) => [u.id, u])),
        groups: Object.fromEntries(groups.map((x) => [x.id, x])),
      },
      media: mediaMeta,
      ready: true,
    });
    })();
    return loading;
  },

  async reload() {
    const [people, links, unions, groups] = await Promise.all([
      db.people.toArray(), db.parentLinks.toArray(), db.unions.toArray(), db.groups.toArray(),
    ]);
    const mediaMeta: Record<Id, MediaMeta> = {};
    await db.media.each((m) => {
      mediaMeta[m.id] = strip(m);
    });
    const peopleById = Object.fromEntries(people.map((p) => [p.id, p]));
    set((s) => ({
      graph: {
        people: peopleById,
        parentLinks: Object.fromEntries(links.map((l) => [l.id, l])),
        unions: Object.fromEntries(unions.map((u) => [u.id, u])),
        groups: Object.fromEntries(groups.map((x) => [x.id, x])),
      },
      media: mediaMeta,
      ready: true,
      selectedId: s.selectedId && peopleById[s.selectedId] ? s.selectedId : null,
    }));
  },

  select(id) {
    set({ selectedId: id });
  },

  ask(q) {
    get().asking?.resolve(false);
    return new Promise<boolean>((resolve) =>
      set({
        asking: {
          ...q,
          resolve: (ok) => {
            set({ asking: null });
            resolve(ok);
          },
        },
      }),
    );
  },

  async addPerson() {
    checkpoint('Add person');
    const p = blankPerson({ givenName: 'New person' });
    set((s) => ({
      graph: { ...s.graph, people: { ...s.graph.people, [p.id]: p } },
      fresh: new Set(s.fresh).add(p.id),
      selectedId: p.id,
      focusNameOf: p.id,
    }));
    await db.people.put(p);
    return p.id;
  },

  async connectPeople(id, otherId, as, opts) {
    let res;
    try {
      res = connect(get().graph, id, otherId, as, opts);
    } catch (e) {
      get().toast((e as Error).message, 'error');
      return false;
    }
    const g0 = get().graph;
    checkpoint(`Connect ${fullName(g0.people[otherId])} as ${fullName(g0.people[id])}’s ${as}`);
    const fresh = new Set(get().fresh);
    [...res.linkIds, ...res.createdPeople, ...(res.unionId ? [res.unionId] : [])].forEach((x) => fresh.add(x));
    set({ graph: res.graph, fresh });
    const r = res;
    await db.transaction('rw', db.people, db.parentLinks, db.unions, async () => {
      await db.people.bulkPut(r.createdPeople.map((p) => r.graph.people[p]));
      await db.parentLinks.bulkPut(r.linkIds.map((l) => r.graph.parentLinks[l]));
      if (r.unionId) await db.unions.put(r.graph.unions[r.unionId]);
    });
    return true;
  },

  async sproutCoupleChild(unionId) {
    checkpoint('Add child of a couple');
    return applyQuickAdd(addChildOfCouple(get().graph, unionId));
  },

  async connectCoupleChild(childId, unionId, kind) {
    let res;
    try {
      res = connectToCouple(get().graph, childId, unionId, kind);
    } catch (e) {
      get().toast((e as Error).message, 'error');
      return false;
    }
    checkpoint(`Connect ${fullName(get().graph.people[childId])} as a couple’s child`);
    const fresh = new Set(get().fresh);
    res.linkIds.forEach((l) => fresh.add(l));
    set({ graph: res.graph, fresh });
    const r = res;
    await db.parentLinks.bulkPut(r.linkIds.map((l) => r.graph.parentLinks[l]));
    return true;
  },

  async sprout(anchorId, dir) {
    checkpoint(`Add ${dir}`);
    return applyQuickAdd(quickAdd(get().graph, anchorId, dir));
  },

  async updatePerson(id, patch) {
    const p = get().graph.people[id];
    if (!p) return;
    const fields = (Object.keys(patch) as (keyof Person)[]).map((k) => FIELD_NAMES[k]).filter(Boolean);
    checkpoint(`Edit ${fullName(p)}’s ${fields.join(', ') || 'details'}`);
    const next = { ...p, ...patch, updatedAt: Date.now() };
    if (patch.givenName !== undefined && next.placeholder && patch.givenName !== 'Unknown parent') next.placeholder = false;
    set((s) => ({ graph: { ...s.graph, people: { ...s.graph.people, [id]: next } } }));
    await db.people.put(next);
  },

  async updateParentLink(id, patch) {
    const l = get().graph.parentLinks[id];
    if (!l) return;
    checkpoint('Edit relationship');
    const next = { ...l, ...patch };
    set((s) => ({ graph: { ...s.graph, parentLinks: { ...s.graph.parentLinks, [id]: next } } }));
    await db.parentLinks.put(next);
  },

  async removeParentLink(id) {
    checkpoint('Unlink parent and child');
    set((s) => {
      const parentLinks = { ...s.graph.parentLinks };
      delete parentLinks[id];
      return { graph: { ...s.graph, parentLinks } };
    });
    await db.parentLinks.delete(id);
  },

  async updateUnion(id, patch) {
    const u = get().graph.unions[id];
    if (!u) return;
    checkpoint('Edit partnership');
    const next = { ...u, ...patch };
    set((s) => ({ graph: { ...s.graph, unions: { ...s.graph.unions, [id]: next } } }));
    await db.unions.put(next);
  },

  async breakConnection(linkIds, unionIds, label) {
    checkpoint(label);
    set((s) => {
      const parentLinks = { ...s.graph.parentLinks };
      const unions = { ...s.graph.unions };
      linkIds.forEach((l) => delete parentLinks[l]);
      unionIds.forEach((u) => delete unions[u]);
      return { graph: { ...s.graph, parentLinks, unions } };
    });
    await db.transaction('rw', db.parentLinks, db.unions, async () => {
      await db.parentLinks.bulkDelete(linkIds);
      await db.unions.bulkDelete(unionIds);
    });
  },

  async removeUnion(id) {
    checkpoint('Unlink partners');
    set((s) => {
      const unions = { ...s.graph.unions };
      delete unions[id];
      return { graph: { ...s.graph, unions } };
    });
    await db.unions.delete(id);
  },

  async deletePerson(id) {
    const g = get().graph;
    const p = g.people[id];
    if (!p) return;
    const next = removePerson(g, id);
    const mediaIds = Object.values(get().media).filter((m) => m.personId === id).map((m) => m.id);
    // Keep their photos and recordings so undo can bring them back.
    const records = (await db.media.bulkGet(mediaIds)).filter((r): r is MediaRecord => !!r);
    checkpoint(`Delete ${fullName(p)}`, records);
    const media = { ...get().media };
    mediaIds.forEach((m) => (delete media[m], forgetMediaUrl(m)));
    set({ graph: next, media, selectedId: get().selectedId === id ? null : get().selectedId });
    const goneLinks = Object.keys(g.parentLinks).filter((k) => !next.parentLinks[k]);
    const goneUnions = Object.keys(g.unions).filter((k) => !next.unions[k]);
    await db.transaction('rw', [db.people, db.parentLinks, db.unions, db.media, db.groups], async () => {
      await syncTable(db.groups, g.groups ?? {}, next.groups ?? {});
      await db.people.delete(id);
      await db.parentLinks.bulkDelete(goneLinks);
      await db.unions.bulkDelete(goneUnions);
      await db.media.bulkDelete(mediaIds);
    });
  },

  async addImages(personId, files, asPortrait = false) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      get().toast('Those files aren’t images. Use JPEG, PNG, WebP or HEIC.', 'error');
      return;
    }
    const added: MediaRecord[] = [];
    const before = get().past.length;
    checkpoint(asPortrait ? 'Change portrait' : 'Add photos');
    for (const f of images) {
      try {
        const c = await compressImage(f);
        added.push({
          id: newId(), kind: 'image', personId, mime: c.mime, width: c.width, height: c.height,
          caption: '', blob: c.blob, thumb: c.thumb, createdAt: Date.now(),
        });
      } catch (e) {
        get().toast(`${f.name} couldn’t be read: ${(e as Error).message}`, 'error');
      }
    }
    if (!added.length) {
      // Nothing was added: drop the undo step again.
      if (get().past.length > before) set((s) => ({ past: s.past.slice(0, -1) }));
      return;
    }
    await db.media.bulkPut(added);
    const p = get().graph.people[personId];
    const patch: Partial<Person> = asPortrait
      ? { photoId: added[0].id, galleryIds: [...added.slice(1).map((a) => a.id), ...p.galleryIds] }
      : { galleryIds: [...p.galleryIds, ...added.map((a) => a.id)], photoId: p.photoId ?? added[0].id };
    set((s) => ({ media: { ...s.media, ...Object.fromEntries(added.map((a) => [a.id, strip(a)])) } }));
    quiet++;
    try {
      await get().updatePerson(personId, patch);
    } finally {
      quiet--;
    }
    const kb = Math.round(added.reduce((s, a) => s + a.blob.size, 0) / 1024);
    get().toast(
      asPortrait ? 'Portrait updated.' : `${added.length} photo${added.length > 1 ? 's' : ''} added (${kb} KB after compression).`,
    );
  },

  async addAudio(personId, blob, title, recordedAt) {
    let analysed;
    try {
      analysed = await analyseAudio(blob);
    } catch {
      get().toast('That audio file couldn’t be decoded. Try MP3, WAV or M4A.', 'error');
      return;
    }
    const rec: MediaRecord = {
      id: newId(), kind: 'audio', personId, mime: blob.type || 'audio/mpeg', title, recordedAt,
      duration: analysed.duration, peaks: analysed.peaks, blob, createdAt: Date.now(),
    };
    checkpoint('Add voice memory');
    await db.media.put(rec);
    set((s) => ({ media: { ...s.media, [rec.id]: strip(rec) } }));
    const p = get().graph.people[personId];
    quiet++;
    try {
      await get().updatePerson(personId, { audioIds: [rec.id, ...p.audioIds] });
    } finally {
      quiet--;
    }
    get().toast('Voice memory saved.');
  },

  async updateMedia(id, patch) {
    const m = get().media[id];
    if (!m) return;
    checkpoint(m.kind === 'audio' ? 'Edit voice memory' : 'Edit photo caption');
    set((s) => ({ media: { ...s.media, [id]: { ...m, ...patch } } }));
    await db.media.update(id, patch);
  },

  async removeMedia(id) {
    const m = get().media[id];
    if (!m) return;
    const p = get().graph.people[m.personId];
    const rec = await db.media.get(id);
    checkpoint(m.kind === 'audio' ? 'Delete voice memory' : 'Delete photo', rec ? [rec] : []);
    const media = { ...get().media };
    delete media[id];
    set({ media });
    forgetMediaUrl(id);
    await db.media.delete(id);
    if (p) {
      quiet++;
      try {
        await get().updatePerson(p.id, {
          galleryIds: p.galleryIds.filter((x) => x !== id),
          audioIds: p.audioIds.filter((x) => x !== id),
          photoId: p.photoId === id ? p.galleryIds.find((x) => x !== id) : p.photoId,
        });
      } finally {
        quiet--;
      }
    }
  },

  async replaceAll(graph, media) {
    forgetAllMediaUrls();
    await clearAll();
    await writeAll(graph, media);
    await db.meta.put({ key: 'initialised', value: Date.now() });
    set({
      graph,
      media: Object.fromEntries(media.map((m) => [m.id, strip(m)])),
      selectedId: null,
      fresh: new Set(),
      // A different archive: old undo steps would point at people who aren't there.
      past: [],
      future: [],
      shownGroupId: null,
      groupEditing: false,
    });
  },

  async startBlank() {
    await get().replaceAll({ people: {}, parentLinks: {}, unions: {}, groups: {} }, []);
  },

  async restoreSample() {
    const seed = buildSeed();
    await get().replaceAll(seed.graph, seed.media);
  },

  consumeFresh(id) {
    const f = get().fresh;
    if (!f.has(id)) return;
    const next = new Set(f);
    next.delete(id);
    set({ fresh: next, focusNameOf: get().focusNameOf === id ? null : get().focusNameOf });
  },

  toast(text, tone = 'info') {
    const t = { id: ++toastId, text, tone };
    set((s) => ({ toasts: [...s.toasts, t] }));
    setTimeout(() => get().dismissToast(t.id), tone === 'error' ? 7000 : 3600);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  };
});

async function clearAll() {
  await db.transaction('rw', [db.people, db.parentLinks, db.unions, db.media, db.groups], async () => {
    await Promise.all([db.people.clear(), db.parentLinks.clear(), db.unions.clear(), db.media.clear(), db.groups.clear()]);
  });
}

async function writeAll(graph: FamilyGraph, media: MediaRecord[]) {
  await db.transaction('rw', [db.people, db.parentLinks, db.unions, db.media, db.groups], async () => {
    await db.groups.bulkPut(Object.values(graph.groups ?? {}));
    await db.people.bulkPut(Object.values(graph.people));
    await db.parentLinks.bulkPut(Object.values(graph.parentLinks));
    await db.unions.bulkPut(Object.values(graph.unions));
    await db.media.bulkPut(media);
  });
}

/** Actions that change the archive. */
const EDITS = [
  'undo', 'redo', 'createGroup', 'updateGroup', 'deleteGroup', 'toggleGroupMember', 'setCoreGroup',
  'addPerson', 'connectPeople', 'sprout', 'sproutCoupleChild', 'connectCoupleChild', 'updatePerson',
  'updateParentLink', 'removeParentLink', 'updateUnion', 'removeUnion', 'breakConnection', 'deletePerson',
  'addImages', 'addAudio', 'updateMedia', 'removeMedia',
] as const;
/** Actions that swap out the whole archive: never allowed in a shared tree. */
const REPLACES = ['replaceAll', 'startBlank', 'restoreSample'] as const;

/**
 * For a shared tree: edits only go through when `canEdit()` says so (signed in and
 * invited); otherwise `onBlocked` explains why. Replacing the whole tree is always blocked
 * there, so a click on "sample family" can't wipe everyone's shared tree.
 */
export function guardEdits(canEdit: () => boolean, onBlocked: (what: 'edit' | 'replace') => void) {
  const st = useStore.getState() as unknown as Record<string, (...a: unknown[]) => unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of EDITS) {
    const orig = st[k];
    patch[k] = (...a: unknown[]) => (canEdit() ? orig(...a) : (onBlocked('edit'), Promise.resolve(undefined)));
  }
  for (const k of REPLACES) patch[k] = () => (onBlocked('replace'), Promise.resolve(undefined));
  useStore.setState(patch as Partial<State>);
}
