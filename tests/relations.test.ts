import { describe, expect, it } from 'vitest';
import { parentLinksOf, quickAdd, siblingsOf, unionsOf, removePerson, blankPerson } from '../src/core/relations';
import type { FamilyGraph } from '../src/core/types';
import { buildSeed } from '../src/data/seed';
import { parseFuzzy, formatFuzzy, lifespan } from '../src/core/dates';

const id = (g: FamilyGraph, n: string) => Object.values(g.people).find((p) => p.givenName === n)!.id;

describe('siblingsOf', () => {
  const { graph } = buildSeed();
  it('derives full, adoptive and half/step siblings', () => {
    const s = Object.fromEntries(siblingsOf(graph, id(graph, 'Daniel')).map((x) => [graph.people[x.id].givenName, x.kind]));
    expect(s).toEqual({ Eleanor: 'full', Samuel: 'adoptive' });
    const j = Object.fromEntries(siblingsOf(graph, id(graph, 'June')).map((x) => [graph.people[x.id].givenName, x.kind]));
    expect(j.Theo).toBe('half');
  });
});

describe('quickAdd', () => {
  const { graph } = buildSeed();
  it('a child of someone with one current partner gets both as parents', () => {
    const r = quickAdd(graph, id(graph, 'Priya'), 'child');
    const ps = parentLinksOf(r.graph, r.personId).map((l) => r.graph.people[l.parentId].givenName).sort();
    expect(ps).toEqual(['Daniel', 'Priya']);
  });
  it('a sibling copies non-step parents', () => {
    const r = quickAdd(graph, id(graph, 'June'), 'sibling');
    const ps = parentLinksOf(r.graph, r.personId).map((l) => r.graph.people[l.parentId].givenName).sort();
    expect(ps).toEqual(['Claire', 'Daniel']);
  });
  it('a sibling of someone without parents creates a placeholder parent', () => {
    const r = quickAdd(graph, id(graph, 'Priya'), 'sibling');
    expect(r.created).toHaveLength(2);
    const ph = r.graph.people[r.created[1]];
    expect(ph.placeholder).toBe(true);
    expect(siblingsOf(r.graph, r.personId).map((s) => s.id)).toContain(id(graph, 'Priya'));
  });
  it('a second parent is joined to the first in a union; a third is a step-parent', () => {
    const lucky = blankPerson({ givenName: 'Solo' });
    const g0: FamilyGraph = { people: { [lucky.id]: lucky }, parentLinks: {}, unions: {} };
    const r1 = quickAdd(g0, lucky.id, 'parent');
    const r2 = quickAdd(r1.graph, lucky.id, 'parent');
    expect(unionsOf(r2.graph, r1.personId)).toHaveLength(1);
    const r3 = quickAdd(r2.graph, lucky.id, 'parent');
    expect(r3.graph.parentLinks[r3.createdLinks[0]].kind).toBe('step');
  });
  it('removePerson drops every edge touching them', () => {
    const g = removePerson(graph, id(graph, 'Daniel'));
    expect(Object.values(g.parentLinks).some((l) => l.parentId === id(graph, 'Daniel'))).toBe(false);
    expect(Object.values(g.unions)).toHaveLength(2);
  });
});

describe('dates', () => {
  it('parses what people type', () => {
    expect(parseFuzzy('1938')).toBe('1938');
    expect(parseFuzzy('Nov 1938')).toBe('1938-11');
    expect(parseFuzzy('2 November 1938')).toBe('1938-11-02');
    expect(parseFuzzy('2/11/1938')).toBe('1938-11-02');
    expect(parseFuzzy('nonsense')).toBeUndefined();
    expect(formatFuzzy('1938-11-02')).toBe('2 Nov 1938');
  });
  it('formats lifespans', () => {
    expect(lifespan({ birthDate: '1938', deathDate: '2019' } as never)).toBe('1938 – 2019');
    expect(lifespan({ birthDate: '1993-02-08' } as never)).toBe('b. 1993');
  });
});

describe('connect existing people', () => {
  it('links a parent, a partner and a child, and refuses loops and duplicates', async () => {
    const { connect, connectProblem } = await import('../src/core/relations');
    const { graph } = buildSeed();
    const walter = id(graph, 'Walter'), june = id(graph, 'June'), theo = id(graph, 'Theo');
    const lone = blankPerson({ givenName: 'Ada', surname: 'Lund' });
    const g: FamilyGraph = { ...graph, people: { ...graph.people, [lone.id]: lone } };

    // Ada as Walter's parent works; then Walter can't also be Ada's parent.
    const r1 = connect(g, walter, lone.id, 'parent');
    expect(parentLinksOf(r1.graph, walter).map((l) => l.parentId)).toContain(lone.id);
    expect(connectProblem(r1.graph, lone.id, walter, 'parent')).toMatch(/ancestor/);
    // June (Walter's granddaughter) can't become Walter's parent.
    expect(connectProblem(g, walter, june, 'parent')).toMatch(/ancestor/);
    // Already linked, and self.
    expect(connectProblem(g, walter, id(graph, 'Margaret'), 'partner')).toMatch(/already partners/);
    expect(connectProblem(g, walter, walter, 'child')).toMatch(/themselves/);
    // A third parent beside two birth parents becomes a step-parent.
    const r2 = connect(g, theo, lone.id, 'parent');
    expect(r2.graph.parentLinks[r2.linkIds[0]].kind).toBe('step');
    // An explicit kind wins.
    const r2b = connect(g, theo, lone.id, 'parent', { parentKind: 'foster' });
    expect(r2b.graph.parentLinks[r2b.linkIds[0]].kind).toBe('foster');
    // Partner.
    const r3 = connect(g, lone.id, walter, 'partner');
    expect(unionsOf(r3.graph, lone.id)).toHaveLength(1);
  });

  it('connects siblings by sharing parents, or through a placeholder parent', async () => {
    const { connect, connectProblem } = await import('../src/core/relations');
    const { graph } = buildSeed();
    const lone = blankPerson({ givenName: 'Ada' });
    const g: FamilyGraph = { ...graph, people: { ...graph.people, [lone.id]: lone } };
    const lucia = id(graph, 'Lucia');
    const r = connect(g, lone.id, lucia, 'sibling');
    expect(siblingsOf(r.graph, lone.id).map((s) => s.id)).toContain(lucia);
    expect(r.createdPeople).toHaveLength(0);
    expect(connectProblem(r.graph, lone.id, lucia, 'sibling')).toMatch(/already siblings/);
    expect(connectProblem(g, lucia, id(graph, 'Walter'), 'sibling')).toMatch(/ancestor/);
    const b = blankPerson({ givenName: 'Bo' });
    const g2: FamilyGraph = { people: { [lone.id]: lone, [b.id]: b }, parentLinks: {}, unions: {} };
    const r2 = connect(g2, lone.id, b.id, 'sibling');
    expect(r2.createdPeople).toHaveLength(1);
    expect(r2.graph.people[r2.createdPeople[0]].placeholder).toBe(true);
    expect(siblingsOf(r2.graph, b.id).map((s) => s.id)).toEqual([lone.id]);
  });

  it('fullName includes middle names', async () => {
    const { fullName, personMatches } = await import('../src/core/dates');
    const p = blankPerson({ givenName: 'Margaret', middleName: 'Rose Ellen', surname: 'Ashby' });
    expect(fullName(p)).toBe('Margaret Rose Ellen Ashby');
    expect(personMatches(p, 'ellen')).toBe(true);
  });
});

describe('children of a couple', () => {
  it('adds a new child of both partners, or connects an existing person to both', async () => {
    const { addChildOfCouple, connectToCouple, coupleChildProblem } = await import('../src/core/relations');
    const { graph } = buildSeed();
    const walter = id(graph, 'Walter'), margaret = id(graph, 'Margaret');
    const union = Object.values(graph.unions).find((u) => u.partners.includes(walter) && u.partners.includes(margaret))!;
    const r = addChildOfCouple(graph, union.id);
    expect(parentLinksOf(r.graph, r.personId).map((l) => l.parentId).sort()).toEqual([walter, margaret].sort());
    expect(r.graph.people[r.personId].surname).toBe('Ashby');

    const lone = blankPerson({ givenName: 'Ada' });
    const g: FamilyGraph = { ...graph, people: { ...graph.people, [lone.id]: lone } };
    const c = connectToCouple(g, lone.id, union.id, 'adoptive');
    expect(c.linkIds).toHaveLength(2);
    expect(parentLinksOf(c.graph, lone.id).every((l) => l.kind === 'adoptive')).toBe(true);
    // Refusals: already their child, one of the couple, an ancestor.
    expect(coupleChildProblem(graph, id(graph, 'Daniel'), union.id)).toMatch(/already their child/);
    expect(coupleChildProblem(graph, walter, union.id)).toMatch(/one of this couple/);
    const tomasEleanor = Object.values(graph.unions).find((u) => u.partners.includes(id(graph, 'Eleanor')))!;
    expect(coupleChildProblem(graph, walter, tomasEleanor.id)).toMatch(/ancestor/);
  });
});

describe('describing lines', () => {
  it('reads parent lines and partnerships as sentences', async () => {
    const { describeParentLine, describeUnion } = await import('../src/core/describe');
    const { graph } = buildSeed();
    const walter = id(graph, 'Walter'), margaret = id(graph, 'Margaret');
    const daniel = id(graph, 'Daniel'), samuel = id(graph, 'Samuel');
    expect(describeParentLine(graph, daniel, [walter, margaret], 'biological')).toBe('Daniel is the son of Walter and Margaret');
    expect(describeParentLine(graph, samuel, [walter, margaret], 'adoptive')).toMatch(/^Samuel is the adopted son of Walter and Margaret \(since 1974\)$/);
    const wm = Object.values(graph.unions).find((u) => u.partners.includes(walter))!;
    expect(describeUnion(graph, wm.id)).toBe('Walter and Margaret were married from 1962 until Walter died in 2019');
    const cd = Object.values(graph.unions).find((u) => u.status === 'divorced')!;
    expect(describeUnion(graph, cd.id)).toMatch(/were married in 1994 and divorced in 2003/);
  });
});

describe('family groups', () => {
  it('titles the archive from the main group and drops deleted people from groups', async () => {
    const { familyTitle, groupBox, suggestGroupName, coreGroup } = await import('../src/core/groups');
    const { computeLayout } = await import('../src/core/layout');
    const { graph } = buildSeed();
    expect(familyTitle(graph)).toBe('The Ashby Family');
    const core = coreGroup(graph)!;
    const renamed: FamilyGraph = { ...graph, groups: { ...graph.groups, [core.id]: { ...core, name: 'Peggy & Walter’s family' } } };
    expect(familyTitle(renamed)).toBe('Peggy & Walter’s family');
    // No main group: fall back to the most common surname.
    const { core: _c, ...plain } = core;
    expect(familyTitle({ ...graph, groups: { ...graph.groups, [core.id]: plain } })).toBe('The Ashby Family');
    expect(suggestGroupName(graph, [id(graph, 'Lucia')])).toBe('The Reyes Family 2');
    // Deleting a member removes them from every group; quick-add keeps groups.
    const walter = id(graph, 'Walter');
    expect(removePerson(graph, walter).groups![core.id].memberIds).not.toContain(walter);
    expect(quickAdd(graph, walter, 'child').graph.groups).toBe(graph.groups);
    // The box surrounds every member card.
    const L = computeLayout(graph);
    const box = groupBox(core.memberIds, L.pos)!;
    for (const m of core.memberIds) {
      expect(L.pos[m].x).toBeGreaterThan(box.x);
      expect(L.pos[m].y).toBeGreaterThan(box.y);
      expect(L.pos[m].x + 148).toBeLessThan(box.x + box.w);
    }
  });
});
