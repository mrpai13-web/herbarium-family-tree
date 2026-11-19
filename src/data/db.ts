/** IndexedDB via Dexie. Everything stays in this browser profile on this computer. */
import Dexie, { type Table } from 'dexie';
import type { Group, MediaRecord, ParentLink, Person, Union } from '../core/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

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

export const db = new ArchiveDB();

/** Ask the browser not to evict this origin's data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
