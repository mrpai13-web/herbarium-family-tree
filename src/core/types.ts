/**
 * Family graph model.
 *
 * The tree is a graph, not a binary tree: people are nodes, and two kinds of
 * edges connect them.
 *  - ParentLink: one directed parent -> child edge with a kind (biological,
 *    adoptive, step, foster). A child can have any number of parents.
 *  - Union: an undirected partnership between two people with a status. A
 *    person can have any number of unions (remarriage, former partners).
 * Siblings are never stored: they are derived from shared parents, which is
 * what makes full / half / step / adoptive siblings fall out for free.
 */

export type Id = string;

/** Partial ISO date: "1938", "1938-11" or "1938-11-02". */
export type FuzzyDate = string;

export type Sex = 'female' | 'male' | 'unknown';

export interface Person {
  id: Id;
  givenName: string;
  /** One or more middle names, space separated. */
  middleName?: string;
  surname: string;
  nickname?: string;
  /** Surname at birth, shown as "née ...". */
  birthSurname?: string;
  sex: Sex;
  birthDate?: FuzzyDate;
  deathDate?: FuzzyDate;
  birthplace?: string;
  bio?: string;
  /** Media id of the portrait (an image Media record). */
  photoId?: Id;
  /** Media ids of gallery images, in display order. */
  galleryIds: Id[];
  /** Media ids of audio memories, in display order. */
  audioIds: Id[];
  /** Created by "Add sibling" when the parents are unknown. */
  placeholder?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ParentKind = 'biological' | 'adoptive' | 'step' | 'foster';

export interface ParentLink {
  id: Id;
  parentId: Id;
  childId: Id;
  kind: ParentKind;
  /** Year or date the relationship began (useful for adoptions). */
  since?: FuzzyDate;
}

export type UnionKind = 'married' | 'partners';
export type UnionStatus = 'current' | 'divorced' | 'separated' | 'widowed';

export interface Union {
  id: Id;
  /** Exactly two people. Order is display order only. */
  partners: [Id, Id];
  kind: UnionKind;
  status: UnionStatus;
  start?: FuzzyDate;
  end?: FuzzyDate;
}

export type MediaKind = 'image' | 'audio';

export interface MediaMeta {
  id: Id;
  kind: MediaKind;
  personId: Id;
  mime: string;
  title?: string;
  /** Caption for images, e.g. "Wedding, 1962". */
  caption?: string;
  /** When an audio memory was recorded (FuzzyDate). */
  recordedAt?: FuzzyDate;
  width?: number;
  height?: number;
  /** Seconds, audio only. */
  duration?: number;
  /** 0..1 peak amplitudes for drawing a waveform, audio only. */
  peaks?: number[];
  createdAt: number;
}

/** A Media record as stored: metadata plus the binary. */
export interface MediaRecord extends MediaMeta {
  blob: Blob;
  /** Small square-ish preview for canvas cards (images only). */
  thumb?: Blob;
}

/** A named set of people, e.g. "The Ashby Family". See core/groups.ts. */
export interface Group {
  id: Id;
  name: string;
  memberIds: Id[];
  /** Box and tab colour on the tree. */
  color: string;
  /** The main family: its name becomes the archive's title. At most one group has this. */
  core?: boolean;
  createdAt: number;
}

export interface FamilyGraph {
  people: Record<Id, Person>;
  parentLinks: Record<Id, ParentLink>;
  unions: Record<Id, Union>;
  /** Optional so older backups (before groups) still load. */
  groups?: Record<Id, Group>;
}

export type AddDirection = 'parent' | 'partner' | 'sibling' | 'child';
