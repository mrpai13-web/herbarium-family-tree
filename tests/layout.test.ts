import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, CLUSTER_GAP, computeLayout, ROW_H, isotonicSpaced } from '../src/core/layout';
import { quickAdd } from '../src/core/relations';
import type { FamilyGraph } from '../src/core/types';
import { buildSeed } from '../src/data/seed';
import { buildEdges } from '../src/core/paths';

function byName(g: FamilyGraph, name: string) {
  return Object.values(g.people).find((p) => p.givenName === name)!.id;
}

function assertNoOverlap(g: FamilyGraph) {
  const { pos } = computeLayout(g);
  const rows = new Map<number, number[]>();
  for (const id of Object.keys(g.people)) {
    const p = pos[id];
    if (!rows.has(p.y)) rows.set(p.y, []);
    rows.get(p.y)!.push(p.x);
  }
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(CARD_W + 40);
  }
}

describe('isotonicSpaced', () => {
  it('keeps desired positions when they already fit', () => {
    expect(isotonicSpaced([0, 300, 600], [0, 200, 200])).toEqual([0, 300, 600]);
  });
  it('spreads a pile-up symmetrically around its mean', () => {
    const xs = isotonicSpaced([100, 100, 100], [0, 50, 50]);
    expect(xs).toEqual([50, 100, 150]);
  });
});

describe('computeLayout on the sample family', () => {
  const { graph } = buildSeed();
  const L = computeLayout(graph);
  it('puts three generations on three rows', () => {
    expect(L.gen[byName(graph, 'Walter')]).toBe(0);
    expect(L.gen[byName(graph, 'Margaret')]).toBe(0);
    expect(L.gen[byName(graph, 'Daniel')]).toBe(1);
    expect(L.gen[byName(graph, 'Claire')]).toBe(1); // in-law pulled to her partner's row
    expect(L.gen[byName(graph, 'Theo')]).toBe(2);
  });
  it('never overlaps cards', () => assertNoOverlap(graph));
  it('places Daniel between his former and current wife', () => {
    const x = (n: string) => L.pos[byName(graph, n)].x;
    expect(x('Claire')).toBeLessThan(x('Daniel'));
    expect(x('Daniel')).toBeLessThan(x('Priya'));
  });
  it('builds a shared root for each couple child and a separate step root', () => {
    const { roots, unions } = buildEdges(graph, L);
    expect(unions).toHaveLength(4);
    const june = roots.filter((r) => r.childId === byName(graph, 'June'));
    expect(june.map((r) => r.kind).sort()).toEqual(['biological', 'step']);
  });
});

describe('layout stays overlap-free as the tree grows', () => {
  it('after 60 random quick-adds', () => {
    let { graph } = buildSeed();
    let seed = 42;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
    const dirs = ['parent', 'partner', 'sibling', 'child'] as const;
    for (let i = 0; i < 60; i++) {
      const ids = Object.keys(graph.people);
      const anchor = ids[Math.floor(rnd() * ids.length)];
      graph = quickAdd(graph, anchor, dirs[Math.floor(rnd() * 4)]).graph;
    }
    assertNoOverlap(graph);
    expect(CLUSTER_GAP).toBeGreaterThan(0);
  });
});

describe('generation rows', () => {
  it('siblings and their partners line up on one row, eldest on the left', () => {
    const { graph } = buildSeed();
    const L = computeLayout(graph);
    const at = (n: string) => L.pos[Object.values(graph.people).find((p) => p.givenName === n)!.id];
    // Eleanor 1964, Daniel 1967, Samuel 1970 and their partners: one level line.
    const row = ['Eleanor', 'Daniel', 'Samuel', 'Tomás', 'Priya'].map((n) => at(n).y);
    expect(new Set(row).size).toBe(1);
    // Every card sits exactly on a row line.
    for (const id of Object.keys(L.pos)) expect(L.pos[id].y).toBe(L.gen[id] * ROW_H);
    expect(at('Eleanor').x).toBeLessThan(at('Daniel').x);
    expect(at('Daniel').x).toBeLessThan(at('Samuel').x);
  });
});

describe('unconnected people', () => {
  it('people added on their own never overlap the tree or each other', async () => {
    const { blankPerson } = await import('../src/core/relations');
    const { graph } = buildSeed();
    const g = { ...graph, people: { ...graph.people } };
    for (let i = 0; i < 5; i++) {
      const p = blankPerson({ givenName: `Loose ${i}` });
      g.people[p.id] = p;
    }
    const L = computeLayout(g);
    const ids = Object.keys(g.people);
    expect(Object.keys(L.pos)).toHaveLength(ids.length);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = L.pos[ids[i]], b = L.pos[ids[j]];
        const apart = Math.abs(a.x - b.x) >= CARD_W || Math.abs(a.y - b.y) >= CARD_H;
        expect(apart).toBe(true);
      }
    // An empty tree lays out to nothing.
    expect(computeLayout({ people: {}, parentLinks: {}, unions: {} }).pos).toEqual({});
  });
});

describe('generations line up across families', () => {
  // A small family built by name: parents(child, ...parents), married(a, b).
  function family() {
    const g: FamilyGraph = { people: {}, parentLinks: {}, unions: {}, groups: {} };
    const id = (n: string) => n;
    const person = (n: string) => (g.people[n] ??= { ...blankPersonFor(n), id: id(n) });
    let k = 0;
    return {
      g,
      parents(child: string, ...ps: string[]) {
        person(child);
        for (const p of ps) {
          person(p);
          const lid = `l${k++}`;
          g.parentLinks[lid] = { id: lid, parentId: p, childId: child, kind: 'biological' };
        }
      },
      married(a: string, b: string) {
        person(a);
        person(b);
        const uid = `u${k++}`;
        g.unions[uid] = { id: uid, partners: [a, b], kind: 'married', status: 'current' };
      },
    };
  }
  const blankPersonFor = (n: string) => ({
    id: n, givenName: n, surname: '', galleryIds: [], audioIds: [], createdAt: 0,
  }) as unknown as FamilyGraph['people'][string];

  it('a spouse with more recorded ancestors does not push their partner below their siblings', () => {
    const f = family();
    // Frank and his brother; the brother's kids. Gloria has parents and grandparents recorded.
    f.parents('Frank', 'Dad', 'Mum');
    f.parents('Brother', 'Dad', 'Mum');
    f.married('Dad', 'Mum');
    f.parents('Nephew', 'Brother');
    f.parents('Niece', 'Brother');
    f.parents('Gloria', 'GPa', 'GMa');
    f.parents('GPa', 'GGPa');
    f.married('Frank', 'Gloria');
    const L = computeLayout(f.g);
    expect(L.gen.Frank).toBe(L.gen.Brother);
    expect(L.gen.Gloria).toBe(L.gen.Frank);
    expect(L.gen.Nephew).toBe(L.gen.Frank + 1);
    expect(L.gen.Dad).toBe(L.gen.Frank - 1);
    expect(L.gen.GPa).toBe(L.gen.Gloria - 1);
    for (const id of Object.keys(L.pos)) expect(L.pos[id].y).toBe(L.gen[id] * ROW_H);
  });

  it('brothers and their wives share a row, and the patriarch sits alone on top', () => {
    const f = family();
    f.parents('Po-Chen', 'Ben Shao Chi');
    f.parents('Wu-Chen', 'Ben Shao Chi');
    f.married('Po-Chen', 'Kuanyin');
    f.married('Wu-Chen', 'Lien-Fang');
    // Lien-Fang's parents are known; Kuanyin's aren't.
    f.parents('Lien-Fang', 'LF-Father', 'LF-Mother');
    f.parents('Grandchild', 'Po-Chen', 'Kuanyin');
    const L = computeLayout(f.g);
    const row = ['Po-Chen', 'Kuanyin', 'Wu-Chen', 'Lien-Fang'].map((n) => L.gen[n]);
    expect(new Set(row).size).toBe(1);
    expect(L.gen['Ben Shao Chi']).toBe(row[0] - 1);
    // Lien-Fang's parents are Ben's generation, not above him.
    expect(L.gen['LF-Father']).toBe(L.gen['Ben Shao Chi']);
    expect(L.gen.Grandchild).toBe(row[0] + 1);
  });
});
