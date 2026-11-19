/** Plain-language sentences for the lines on the tree ("Daniel is the son of Walter and Margaret"). */
import { yearOf } from './dates';
import type { FamilyGraph, Id, ParentKind, Person } from './types';

const first = (p?: Person) => p?.givenName || 'Unnamed';

function andList(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "son", "adopted daughter", "stepchild", "foster son"… */
export function childWord(p: Person | undefined, kind: ParentKind): string {
  const base = p?.sex === 'male' ? 'son' : p?.sex === 'female' ? 'daughter' : 'child';
  switch (kind) {
    case 'adoptive':
      return `adopted ${base}`;
    case 'step':
      return `step${base}`;
    case 'foster':
      return `foster ${base}`;
    default:
      return base;
  }
}

/** One parent → child line (or a couple's shared line) as a sentence. */
export function describeParentLine(g: FamilyGraph, childId: Id, parentIds: Id[], kind: ParentKind): string {
  const child = g.people[childId];
  const parents = parentIds.map((p) => first(g.people[p]));
  const word = childWord(child, kind);
  const since = kind !== 'biological' ? parentSince(g, childId, parentIds) : undefined;
  return `${first(child)} is the ${word} of ${andList(parents)}${since ? ` (since ${since})` : ''}`;
}

function parentSince(g: FamilyGraph, childId: Id, parentIds: Id[]): number | undefined {
  const l = Object.values(g.parentLinks).find((x) => x.childId === childId && parentIds.includes(x.parentId) && x.since);
  return yearOf(l?.since);
}

/** A partnership line as a sentence: "Walter and Margaret were married in 1962; Walter died in 2019". */
export function describeUnion(g: FamilyGraph, unionId: Id): string {
  const u = g.unions[unionId];
  if (!u) return '';
  const [a, b] = u.partners.map((p) => g.people[p]);
  const pair = `${first(a)} and ${first(b)}`;
  const s = yearOf(u.start), e = yearOf(u.end);
  const married = u.kind === 'married';
  switch (u.status) {
    case 'divorced':
      return `${pair} were married${s ? ` in ${s}` : ''} and divorced${e ? ` in ${e}` : ''}`;
    case 'separated':
      return `${pair} were ${married ? 'married' : 'partners'}${s ? ` from ${s}` : ''} and separated${e ? ` in ${e}` : ''}`;
    case 'widowed': {
      const gone = [a, b].find((p) => p?.deathDate);
      return `${pair} were ${married ? 'married' : 'partners'}${s ? ` from ${s}` : ''}${gone ? ` until ${first(gone)} died${yearOf(gone.deathDate) ? ` in ${yearOf(gone.deathDate)}` : ''}` : ', now widowed'}`;
    }
    default:
      return married ? `${pair} are married${s ? ` (since ${s})` : ''}` : `${pair} are partners${s ? ` (since ${s})` : ''}`;
  }
}
