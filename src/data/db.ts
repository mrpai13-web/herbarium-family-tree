/**
 * IndexedDB via Dexie. The private tree stays in this browser profile on this computer.
 * A shared tree (`?repo=owner/name`) gets its own database, used as a local cache of its GitHub repository.
 */
import Dexie, { type DBCoreMutateRequest, type Table } from 'dexie';
import type { Group, MediaRecord, ParentLink, Person, Union } from '../core/types';
import { sharedRepo } from '../sync/config';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** Tables whose rows are part of the family archive (and so get synced when shared). */
export const SYNCED_TABLES = ['people', 'parentLinks', 'unions', 'groups', 'media'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export class ArchiveDB extends Dexie {
  people!: Table<Person, string>;
  parentLinks!: Table<ParentLink, string>;
  unions!: Table<Union, string>;
  media!: Table<MediaRecord, string>;
  meta!: Table<MetaRow, string>;
  groups!: Table<Group, string>;

  constructor(name = 'herbarium-family-archive') {
    super(name);
    this.version(1).stores({
      people: 'id, surname',
      parentLinks: 'id, parentId, childId',
      unions: 'id, *partners',
      media: 'id, personId, kind',
      meta: 'key',
    });
    // v2: family groups.
    this.version(2).stores({ groups: 'id' });
  }
}

export const db = new ArchiveDB(sharedRepo ? `herbarium-shared-${sharedRepo.replace('/', '__')}` : undefined);

/* ------------------------------------------------------------ change feed */

type ChangeListener = (table: SyncedTable, ids: string[]) => void;
const listeners = new Set<ChangeListener>();

/** Called with the ids of synced rows written or deleted locally (not by `writeRemote`). */
export function onLocalChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const REMOTE = '__herbariumRemote';
const synced = new Set<string>(SYNCED_TABLES);

/**
 * Writes rows that came from the server: they must not be echoed back as local changes.
 * The flag sits on the IndexedDB transaction, which the middleware below can see.
 */
export function writeRemote<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [db.people, db.parentLinks, db.unions, db.groups, db.media], async (tx) => {
    (tx.idbtrans as unknown as Record<string, boolean>)[REMOTE] = true;
    return fn();
  });
}

// Middleware: every put/add/delete/clear on a synced table reports the touched ids.
db.use({
  stack: 'dbcore',
  name: 'herbarium-change-feed',
  create(down) {
    return {
      ...down,
      table(name) {
        const t = down.table(name);
        if (!synced.has(name)) return t;
        return {
          ...t,
          async mutate(req: DBCoreMutateRequest) {
            const remote = (req.trans as unknown as Record<string, boolean>)[REMOTE] === true;
            let ids: string[] = [];
            if (!remote && listeners.size) {
              if (req.type === 'delete') ids = req.keys.map(String);
              else if (req.type === 'deleteRange') {
                const res = await t.query({ trans: req.trans, values: false, query: { index: t.schema.primaryKey, range: req.range } });
                ids = res.result.map(String);
              } else ids = (req.keys ?? req.values.map((v) => (v as { id: string }).id)).map(String);
            }
            const out = await t.mutate(req);
            if (ids.length) for (const fn of listeners) fn(name as SyncedTable, ids);
            return out;
          },
        };
      },
    };
  },
});

/** Ask the browser not to evict this origin's data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
