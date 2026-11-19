import type {
  AddDirection,
  FamilyGraph,
  Id,
  ParentKind,
  ParentLink,
  Person,
  Sex,
  Union,
  UnionKind,
  UnionStatus,
} from './types';

export const newId = (): Id =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ------------------------------------------------------------------ queries */

export function parentLinksOf(g: FamilyGraph, childId: Id): ParentLink[] {
  return Object.values(g.parentLinks).filter((l) => l.childId === childId);
}

export function childLinksOf(g: FamilyGraph, parentId: Id): ParentLink[] {
  return Object.values(g.parentLinks).filter((l) => l.parentId === parentId);
}

export function unionsOf(g: FamilyGraph, personId: Id): Union[] {
  return Object.values(g.unions).filter((u) => u.partners.includes(personId));
}

export function partnerIn(u: Union, personId: Id): Id {
  return u.partners[0] === personId ? u.partners[1] : u.partners[0];
}

export type SiblingKind = 'full' | 'half' | 'step' | 'adoptive';

/**
 * Siblings derived from shared parents.
 *  - full: share every parent, all biological
 *  - half: share at least one biological parent but not all
 *  - adoptive: share a parent where either link is adoptive/foster
 *  - step: no shared parent, but a parent of one is in a union with a parent of the other
 */
export function siblingsOf(g: FamilyGraph, id: Id): { id: Id; kind: SiblingKind }[] {
  const mine = parentLinksOf(g, id);
  const myParents = new Set(mine.map((l) => l.parentId));
  const out = new Map<Id, SiblingKind>();
  for (const pl of mine) {
    for (const cl of childLinksOf(g, pl.parentId)) {
      if (cl.childId === id || out.has(cl.childId)) continue;
      const theirs = parentLinksOf(g, cl.childId);
      const bothBio = (a: ParentLink) => a.kind === 'biological';
      const sharedBio = theirs.filter(
        (t) => bothBio(t) && mine.some((m) => m.parentId === t.parentId && bothBio(m)),
      );
      if (sharedBio.length === 0) {
        out.set(cl.childId, pl.kind === 'step' || cl.kind === 'step' ? 'step' : 'adoptive');
        continue;
      }
      const theirBio = new Set(theirs.filter(bothBio).map((t) => t.parentId));
      const myBio = new Set(mine.filter(bothBio).map((m) => m.parentId));
      const same = theirBio.size === myBio.size && [...myBio].every((p) => theirBio.has(p));
      out.set(cl.childId, same ? 'full' : 'half');
    }
  }
  // Step-siblings through a parent's partner.
  for (const p of myParents) {
    for (const u of unionsOf(g, p)) {
      const other = partnerIn(u, p);
      if (myParents.has(other)) continue;
      for (const cl of childLinksOf(g, other)) {
        if (cl.childId !== id && !out.has(cl.childId)) out.set(cl.childId, 'step');
      }
    }
  }
  return [...out].map(([sid, kind]) => ({ id: sid, kind }));
}

/** Current union(s) first, then the rest, newest start first. */
export function sortedUnions(g: FamilyGraph, personId: Id): Union[] {
  return unionsOf(g, personId).sort((a, b) => {
    const ac = a.status === 'current' ? 0 : 1;
    const bc = b.status === 'current' ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (b.start ?? '').localeCompare(a.start ?? '');
  });
}

/* --------------------------------------------------------------- mutations */

export function blankPerson(over: Partial<Person> = {}): Person {
  const now = Date.now();
  return {
    id: newId(),
    givenName: '',
    surname: '',
    sex: 'unknown',
    galleryIds: [],
    audioIds: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

export interface QuickAddResult {
  graph: FamilyGraph;
  /** The person the user asked for. */
  personId: Id;
  /** Every person created (may include a placeholder parent). */
  created: Id[];
  /** Every parent link / union created, so the UI can animate them. */
  createdLinks: Id[];
  createdUnions: Id[];
}

const DEFAULT_NAME: Record<AddDirection, string> = {
  parent: 'New parent',
  partner: 'New partner',
  sibling: 'New sibling',
  child: 'New child',
};

/**
 * One-click "sprout a relative". Creates a named-by-role person immediately
 * (no form), wired with the most likely relationships; everything can be
 * corrected afterwards in the profile drawer.
 */
export function quickAdd(
  g: FamilyGraph,
  anchorId: Id,
  dir: AddDirection,
  opts: { sex?: Sex } = {},
): QuickAddResult {
  const anchor = g.people[anchorId];
  if (!anchor) throw new Error(`No person ${anchorId}`);
  const graph: FamilyGraph = {
    ...g,
    people: { ...g.people },
    parentLinks: { ...g.parentLinks },
    unions: { ...g.unions },
  };
  const created: Id[] = [];
  const createdLinks: Id[] = [];
  const createdUnions: Id[] = [];
  const surname = dir === 'partner' ? '' : anchor.surname;
  const person = blankPerson({ givenName: DEFAULT_NAME[dir], surname, sex: opts.sex ?? 'unknown' });
  graph.people[person.id] = person;
  created.push(person.id);

  const link = (parentId: Id, childId: Id, kind: ParentKind) => {
    const l: ParentLink = { id: newId(), parentId, childId, kind };
    graph.parentLinks[l.id] = l;
    createdLinks.push(l.id);
  };
  const unite = (a: Id, b: Id) => {
    const u: Union = { id: newId(), partners: [a, b], kind: 'married', status: 'current' };
    graph.unions[u.id] = u;
    createdUnions.push(u.id);
  };

  switch (dir) {
    case 'partner':
      unite(anchorId, person.id);
      break;

    case 'child': {
      // A child of the anchor and their one current partner, if there is exactly one.
      const current = unionsOf(graph, anchorId).filter((u) => u.status === 'current');
      link(anchorId, person.id, 'biological');
      if (current.length === 1) link(partnerIn(current[0], anchorId), person.id, 'biological');
      break;
    }

    case 'parent': {
      const existing = parentLinksOf(graph, anchorId);
      const bio = existing.filter((l) => l.kind === 'biological');
      // Two biological parents already: the newcomer is most likely a step-parent.
      link(person.id, anchorId, bio.length >= 2 ? 'step' : 'biological');
      if (bio.length === 1) {
        const other = bio[0].parentId;
        const already = unionsOf(graph, other).some((u) => u.partners.includes(person.id));
        if (!already) unite(other, person.id);
      } else if (bio.length >= 2) {
        // Step-parent: partner of one of the parents is filled in later by the user.
      }
      break;
    }

    case 'sibling': {
      let parents = parentLinksOf(graph, anchorId);
      if (parents.length === 0) {
        // Siblings are defined by shared parents, so create an unknown parent to hold them.
        const ph = blankPerson({ givenName: 'Unknown parent', surname: anchor.surname, placeholder: true });
        graph.people[ph.id] = ph;
        created.push(ph.id);
        link(ph.id, anchorId, 'biological');
        parents = parentLinksOf(graph, anchorId);
      }
      for (const pl of parents) {
        if (pl.kind === 'step') continue;
        link(pl.parentId, person.id, pl.kind);
      }
      break;
    }
  }
  return { graph, personId: person.id, created, createdLinks, createdUnions };
}

/** Removes a person and every edge touching them. Media cleanup is the caller's job. */
export function removePerson(g: FamilyGraph, id: Id): FamilyGraph {
  const people = { ...g.people };
  delete people[id];
  const parentLinks = Object.fromEntries(
    Object.entries(g.parentLinks).filter(([, l]) => l.parentId !== id && l.childId !== id),
  );
  const unions = Object.fromEntries(Object.entries(g.unions).filter(([, u]) => !u.partners.includes(id)));
  const groups = g.groups
    ? Object.fromEntries(
        Object.entries(g.groups).map(([k, gr]) => [k, gr.memberIds.includes(id) ? { ...gr, memberIds: gr.memberIds.filter((m) => m !== id) } : gr]),
      )
    : undefined;
  return { people, parentLinks, unions, ...(groups ? { groups } : {}) };
}

/** People reachable from `id` through any edge, including `id`. */
export function component(g: FamilyGraph, id: Id): Set<Id> {
  const seen = new Set<Id>([id]);
  const stack = [id];
  const nbrs = (p: Id): Id[] => [
    ...parentLinksOf(g, p).map((l) => l.parentId),
    ...childLinksOf(g, p).map((l) => l.childId),
    ...unionsOf(g, p).map((u) => partnerIn(u, p)),
  ];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of nbrs(cur)) if (!seen.has(n)) (seen.add(n), stack.push(n));
  }
  return seen;
}

/** Everyone above `id` through parent links (any kind), not including `id`. */
export function ancestorsOf(g: FamilyGraph, id: Id): Set<Id> {
  const out = new Set<Id>();
  const stack = [id];
  while (stack.length) {
    for (const l of parentLinksOf(g, stack.pop()!)) if (!out.has(l.parentId)) (out.add(l.parentId), stack.push(l.parentId));
  }
  return out;
}

/** How `otherId` relates to `id` when connecting two people who are already in the tree. */
export type ConnectAs = 'parent' | 'child' | 'partner' | 'sibling';

export interface ConnectOptions {
  /** For parent / child links. Defaults to birth, or step beside two birth parents. */
  parentKind?: ParentKind;
  /** For partners. */
  unionKind?: UnionKind;
  unionStatus?: UnionStatus;
}

export interface ConnectResult {
  graph: FamilyGraph;
  linkIds: Id[];
  unionId?: Id;
  /** Placeholder parents created to hold two siblings who had no parents yet. */
  createdPeople: Id[];
}

const nameOf = (p: Person) => [p.givenName, p.surname].filter(Boolean).join(' ') || 'Unnamed';

/** Why `otherId` can't become `id`'s `as`, in words for the user, or null when it's fine. */
export function connectProblem(g: FamilyGraph, id: Id, otherId: Id, as: ConnectAs): string | null {
  const a = g.people[id], b = g.people[otherId];
  if (!a || !b) return 'Choose someone to connect.';
  if (id === otherId) return 'Someone can’t be related to themselves.';
  const isParent = (p: Id, c: Id) => parentLinksOf(g, c).some((l) => l.parentId === p);
  if (as === 'partner') {
    if (unionsOf(g, id).some((u) => u.partners.includes(otherId))) return `${nameOf(a)} and ${nameOf(b)} are already partners.`;
    if (isParent(id, otherId) || isParent(otherId, id)) return `${nameOf(a)} and ${nameOf(b)} are already parent and child.`;
    return null;
  }
  if (as === 'sibling') {
    if (siblingsOf(g, id).some((s) => s.id === otherId)) return `${nameOf(a)} and ${nameOf(b)} are already siblings.`;
    if (ancestorsOf(g, id).has(otherId)) return `${nameOf(b)} is ${nameOf(a)}’s ancestor, so they can’t be siblings.`;
    if (ancestorsOf(g, otherId).has(id)) return `${nameOf(a)} is ${nameOf(b)}’s ancestor, so they can’t be siblings.`;
    return null;
  }
  const [parent, child] = as === 'parent' ? [otherId, id] : [id, otherId];
  if (isParent(parent, child)) return `${nameOf(g.people[parent])} is already ${nameOf(g.people[child])}’s parent.`;
  // A parent can't also be a descendant: that would make the tree loop back on itself.
  if (ancestorsOf(g, parent).has(child))
    return `${nameOf(g.people[child])} is already an ancestor of ${nameOf(g.people[parent])}, so ${nameOf(g.people[parent])} can’t be their parent.`;
  return null;
}

/** Makes `otherId` into `id`'s `as`. Throws if `connectProblem` reports a problem. */
export function connect(g: FamilyGraph, id: Id, otherId: Id, as: ConnectAs, opts: ConnectOptions = {}): ConnectResult {
  const problem = connectProblem(g, id, otherId, as);
  if (problem) throw new Error(problem);
  const graph: FamilyGraph = { ...g, people: { ...g.people }, parentLinks: { ...g.parentLinks }, unions: { ...g.unions } };
  const linkIds: Id[] = [];
  const createdPeople: Id[] = [];
  const link = (parentId: Id, childId: Id, kind: ParentKind) => {
    if (parentLinksOf(graph, childId).some((l) => l.parentId === parentId)) return;
    const l: ParentLink = { id: newId(), parentId, childId, kind };
    graph.parentLinks[l.id] = l;
    linkIds.push(l.id);
  };

  if (as === 'partner') {
    const u: Union = {
      id: newId(),
      partners: [id, otherId],
      kind: opts.unionKind ?? 'married',
      status: opts.unionStatus ?? 'current',
    };
    graph.unions[u.id] = u;
    return { graph, linkIds, unionId: u.id, createdPeople };
  }

  if (as === 'sibling') {
    // Siblings are people who share parents: give the one without parents the other's.
    const own = (x: Id) => parentLinksOf(graph, x).filter((l) => l.kind !== 'step');
    let [from, to] = [id, otherId];
    if (!own(from).length && own(to).length) [from, to] = [to, from];
    if (!own(from).length) {
      const ph = blankPerson({ givenName: 'Unknown parent', surname: graph.people[from].surname, placeholder: true });
      graph.people[ph.id] = ph;
      createdPeople.push(ph.id);
      link(ph.id, from, 'biological');
    }
    for (const l of own(from)) link(l.parentId, to, l.kind);
    return { graph, linkIds, createdPeople };
  }

  const [parentId, childId] = as === 'parent' ? [otherId, id] : [id, otherId];
  // Like quick-add: a third parent next to two birth parents is most likely a step-parent.
  const bio = parentLinksOf(graph, childId).filter((l) => l.kind === 'biological').length;
  link(parentId, childId, opts.parentKind ?? (bio >= 2 ? 'step' : 'biological'));
  return { graph, linkIds, createdPeople };
}

/* ------------------------------------------------- children of a couple */

/** Why `childId` can't become the child of both partners in `unionId`, or null when fine. */
export function coupleChildProblem(g: FamilyGraph, childId: Id, unionId: Id): string | null {
  const u = g.unions[unionId];
  const c = g.people[childId];
  if (!u || !c) return 'Choose someone to connect.';
  if (u.partners.includes(childId)) return `${nameOf(c)} is one of this couple, so can’t also be their child.`;
  const missing = u.partners.filter((p) => !parentLinksOf(g, childId).some((l) => l.parentId === p));
  if (!missing.length) return `${nameOf(c)} is already their child.`;
  for (const p of missing) {
    if (ancestorsOf(g, p).has(childId)) return `${nameOf(c)} is already an ancestor of ${nameOf(g.people[p])}, so can’t be their child.`;
  }
  return null;
}

/** Makes `childId` the child of both partners (adds whichever parent links are missing). */
export function connectToCouple(g: FamilyGraph, childId: Id, unionId: Id, kind: ParentKind = 'biological'): ConnectResult {
  const problem = coupleChildProblem(g, childId, unionId);
  if (problem) throw new Error(problem);
  const graph: FamilyGraph = { ...g, parentLinks: { ...g.parentLinks } };
  const linkIds: Id[] = [];
  for (const p of g.unions[unionId].partners) {
    if (parentLinksOf(graph, childId).some((l) => l.parentId === p)) continue;
    const l: ParentLink = { id: newId(), parentId: p, childId, kind };
    graph.parentLinks[l.id] = l;
    linkIds.push(l.id);
  }
  return { graph, linkIds, createdPeople: [] };
}

/** A brand-new child of both partners, like quick-add but for the couple. */
export function addChildOfCouple(g: FamilyGraph, unionId: Id): QuickAddResult {
  const u = g.unions[unionId];
  if (!u) throw new Error(`No union ${unionId}`);
  const [a, b] = u.partners.map((p) => g.people[p]);
  const person = blankPerson({ givenName: 'New child', surname: a?.surname || b?.surname || '' });
  const graph: FamilyGraph = { ...g, people: { ...g.people, [person.id]: person }, parentLinks: { ...g.parentLinks } };
  const createdLinks: Id[] = [];
  for (const p of u.partners) {
    const l: ParentLink = { id: newId(), parentId: p, childId: person.id, kind: 'biological' };
    graph.parentLinks[l.id] = l;
    createdLinks.push(l.id);
  }
  return { graph, personId: person.id, created: [person.id], createdLinks, createdUnions: [] };
}
