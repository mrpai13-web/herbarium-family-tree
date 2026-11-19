/**
 * Auto-layout for the family graph. Pure and deterministic; see README "Layout".
 *
 *  1. Generations: parent -> child pushes the child down a row, partners share
 *     a row, and parents with no parents of their own are pulled down to sit
 *     right above their children (so in-laws don't float at the top).
 *  2. Clusters: partners in a row form one unbreakable cluster
 *     (former partners on the left, current on the right of the shared person).
 *  3. Ordering: Sugiyama-style barycentre sweeps, so each cluster sits near its
 *     parents and children; siblings keep birth order on ties.
 *  4. Coordinates: each row is solved as "be as close as possible to where my
 *     family wants me, never closer than the minimum gap", using isotonic
 *     regression (pool-adjacent-violators). The spacing constraint is what
 *     guarantees cards never overlap, at any tree size.
 *  Every card in a generation sits on the same line (siblings, their partners and
 *  cousins alike), so generations read as rows; age shows as left-to-right order.
 */
import type { FamilyGraph, Id, Union } from './types';

export const CARD_W = 148;
export const CARD_H = 190;
/** Gap between partners (room for the union ring). */
export const PARTNER_GAP = 52;
/** Gap between unrelated clusters in one row. */
export const CLUSTER_GAP = 44;
/** Vertical distance between the tops of two rows. */
export const ROW_H = CARD_H + 150;

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  /** Top-left corner of each card. */
  pos: Record<Id, Point>;
  gen: Record<Id, number>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Cluster {
  members: Id[];
  width: number;
  /** x offset of each member's card left edge from the cluster's left edge. */
  offsets: number[];
  x: number; // left edge
  order: number;
}

export function computeLayout(g: FamilyGraph): Layout {
  const ids = Object.keys(g.people).sort((a, b) => cmpBirth(g, a, b));
  if (ids.length === 0) return { pos: {}, gen: {}, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

  const links = Object.values(g.parentLinks).filter((l) => g.people[l.parentId] && g.people[l.childId]);
  const unions = Object.values(g.unions).filter((u) => g.people[u.partners[0]] && g.people[u.partners[1]]);
  const parentsOf = new Map<Id, Id[]>();
  const childrenOf = new Map<Id, Id[]>();
  for (const id of ids) (parentsOf.set(id, []), childrenOf.set(id, []));
  for (const l of links) {
    parentsOf.get(l.childId)!.push(l.parentId);
    childrenOf.get(l.parentId)!.push(l.childId);
  }
  for (const [, kids] of childrenOf) kids.sort((a, b) => cmpBirth(g, a, b));

  /* ---- 1. generations (monotone relaxation; capped so bad data can't hang) */
  const gen: Record<Id, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const cap = ids.length * 4 + 10;
  for (let it = 0, changed = true; changed && it < cap; it++) {
    changed = false;
    for (const l of links) {
      if (gen[l.childId] < gen[l.parentId] + 1) (gen[l.childId] = gen[l.parentId] + 1), (changed = true);
    }
    for (const u of unions) {
      const [a, b] = u.partners;
      const m = Math.max(gen[a], gen[b]);
      if (gen[a] !== m || gen[b] !== m) (gen[a] = gen[b] = m), (changed = true);
    }
    for (const id of ids) {
      if (parentsOf.get(id)!.length) continue;
      const kids = childrenOf.get(id)!;
      if (!kids.length) continue;
      const target = Math.min(...kids.map((k) => gen[k])) - 1;
      if (target > gen[id]) (gen[id] = target), (changed = true);
    }
  }
  const minGen = Math.min(...ids.map((id) => gen[id]));
  for (const id of ids) gen[id] -= minGen;
  const rowsCount = Math.max(...ids.map((id) => gen[id])) + 1;

  /* ---- 2. clusters of partners within a row */
  const unionsBy = new Map<Id, Union[]>();
  for (const id of ids) unionsBy.set(id, []);
  for (const u of unions) {
    if (gen[u.partners[0]] !== gen[u.partners[1]]) continue;
    unionsBy.get(u.partners[0])!.push(u);
    unionsBy.get(u.partners[1])!.push(u);
  }
  const clusterOf = new Map<Id, Cluster>();
  const rows: Cluster[][] = Array.from({ length: rowsCount }, () => []);
  for (const id of ids) {
    if (clusterOf.has(id)) continue;
    // Collect the partner component.
    const comp: Id[] = [];
    const stack = [id];
    const seen = new Set([id]);
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const u of unionsBy.get(c)!) {
        const o = u.partners[0] === c ? u.partners[1] : u.partners[0];
        if (!seen.has(o)) (seen.add(o), stack.push(o));
      }
    }
    const members = arrangePartners(comp, unionsBy, g);
    const offsets = members.map((_, i) => i * (CARD_W + PARTNER_GAP));
    const cl: Cluster = { members, offsets, width: offsets[offsets.length - 1] + CARD_W, x: 0, order: 0 };
    for (const m of members) clusterOf.set(m, cl);
    rows[gen[id]].push(cl);
  }

  /* ---- 3. ordering: DFS seed, then barycentre sweeps */
  const dfsIndex = new Map<Id, number>();
  let counter = 0;
  const visit = (id: Id) => {
    if (dfsIndex.has(id)) return;
    dfsIndex.set(id, counter++);
    for (const m of clusterOf.get(id)!.members) if (!dfsIndex.has(m)) dfsIndex.set(m, counter++);
    for (const m of clusterOf.get(id)!.members) for (const k of childrenOf.get(m)!) visit(k);
  };
  const roots = ids.filter((id) => gen[id] === 0);
  for (const r of roots) visit(r);
  for (const id of ids) visit(id);
  for (const row of rows) {
    for (const cl of row) cl.order = Math.min(...cl.members.map((m) => dfsIndex.get(m)!));
    row.sort((a, b) => a.order - b.order);
    row.forEach((cl, i) => (cl.order = i));
  }
  const memberIndex = (id: Id) => {
    const cl = clusterOf.get(id)!;
    return cl.order + cl.members.indexOf(id) / (cl.members.length + 1);
  };
  const sweep = (r: number, neighbours: (id: Id) => Id[]) => {
    const row = rows[r];
    const keyed = row.map((cl, i) => {
      const ns = cl.members.flatMap(neighbours);
      const key = ns.length ? ns.reduce((s, n) => s + memberIndex(n), 0) / ns.length : i;
      return { cl, key, birth: cl.members[0] };
    });
    keyed.sort((a, b) => a.key - b.key || cmpBirth(g, a.birth, b.birth));
    keyed.forEach((k, i) => ((k.cl.order = i), (row[i] = k.cl)));
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let r = 1; r < rowsCount; r++) sweep(r, (id) => parentsOf.get(id)!);
    for (let r = rowsCount - 2; r >= 0; r--) sweep(r, (id) => childrenOf.get(id)!);
  }
  for (let r = 1; r < rowsCount; r++) sweep(r, (id) => parentsOf.get(id)!);

  /* ---- 4. coordinates */
  for (const row of rows) {
    let x = 0;
    for (const cl of row) (cl.x = x), (x += cl.width + CLUSTER_GAP);
  }
  const centerOf = (id: Id) => {
    const cl = clusterOf.get(id)!;
    return cl.x + cl.offsets[cl.members.indexOf(id)] + CARD_W / 2;
  };
  /** Where a child "hangs from": the midpoint of its parents in this row above. */
  const anchorAbove = (id: Id): number | undefined => {
    const ps = parentsOf.get(id)!.filter((p) => gen[p] === gen[id] - 1);
    if (!ps.length) return undefined;
    return ps.reduce((s, p) => s + centerOf(p), 0) / ps.length;
  };
  const solveRow = (r: number, want: (cl: Cluster) => number | undefined) => {
    const row = rows[r];
    const desired = row.map((cl) => want(cl) ?? cl.x);
    const xs = isotonicSpaced(desired, row.map((_cl, i) => (i === 0 ? 0 : row[i - 1].width + CLUSTER_GAP)));
    row.forEach((cl, i) => (cl.x = xs[i]));
  };
  const wantFromParents = (cl: Cluster) => {
    const votes: number[] = [];
    cl.members.forEach((m, i) => {
      const a = anchorAbove(m);
      if (a !== undefined) votes.push(a - cl.offsets[i] - CARD_W / 2);
    });
    return votes.length ? votes.reduce((s, v) => s + v, 0) / votes.length : undefined;
  };
  const wantFromChildren = (cl: Cluster) => {
    const votes: number[] = [];
    cl.members.forEach((m, i) => {
      const kids = childrenOf.get(m)!.filter((k) => gen[k] === gen[m] + 1);
      if (!kids.length) return;
      // A couple's children hang from the couple's midpoint, so vote with that.
      const partnerKids = cl.members.filter((o) => o !== m && kids.some((k) => parentsOf.get(k)!.includes(o)));
      const selfCenter = cl.offsets[i] + CARD_W / 2;
      const hang = partnerKids.length
        ? (selfCenter + partnerKids.reduce((s, o) => s + cl.offsets[cl.members.indexOf(o)] + CARD_W / 2, 0)) /
          (partnerKids.length + 1)
        : selfCenter;
      const kidsCenter = kids.reduce((s, k) => s + centerOf(k), 0) / kids.length;
      votes.push(kidsCenter - hang);
    });
    return votes.length ? votes.reduce((s, v) => s + v, 0) / votes.length : undefined;
  };
  for (let pass = 0; pass < 8; pass++) {
    for (let r = 1; r < rowsCount; r++) solveRow(r, wantFromParents);
    for (let r = rowsCount - 2; r >= 0; r--) solveRow(r, wantFromChildren);
  }
  for (let r = 1; r < rowsCount; r++) solveRow(r, wantFromParents);

  /* ---- output */
  const pos: Record<Id, Point> = {};
  let minX = Infinity, maxX = -Infinity;
  for (let r = 0; r < rowsCount; r++) {
    for (const cl of rows[r]) {
      cl.members.forEach((m, i) => {
        const x = Math.round(cl.x + cl.offsets[i]);
        pos[m] = { x, y: r * ROW_H };
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + CARD_W);
      });
    }
  }
  // Shift so the layout starts at x = 0.
  for (const id of ids) pos[id].x -= minX;
  return {
    pos,
    gen,
    bounds: { minX: 0, minY: 0, maxX: maxX - minX, maxY: (rowsCount - 1) * ROW_H + CARD_H },
  };
}

/**
 * Order the people of one partner component in a line: a person with several
 * partners sits in the middle, former partners on the left, current on the right.
 */
function arrangePartners(comp: Id[], unionsBy: Map<Id, Union[]>, g: FamilyGraph): Id[] {
  if (comp.length === 1) return comp;
  const degree = (id: Id) => unionsBy.get(id)!.length;
  const hub = [...comp].sort((a, b) => degree(b) - degree(a) || cmpBirth(g, a, b))[0];
  const left: Id[] = [];
  const right: Id[] = [];
  const placed = new Set([hub]);
  const hubUnions = [...unionsBy.get(hub)!].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  for (const u of hubUnions) {
    const o = u.partners[0] === hub ? u.partners[1] : u.partners[0];
    if (placed.has(o)) continue;
    placed.add(o);
    (u.status === 'current' || u.status === 'widowed' ? right : left).push(o);
  }
  if (left.length === 0 && right.length > 1) left.push(right.shift()!);
  // Partners of partners go on the outside of the partner they belong to.
  const extend = (side: Id[], outward: 'left' | 'right') => {
    for (let i = 0; i < side.length; i++) {
      for (const u of unionsBy.get(side[i])!) {
        const o = u.partners[0] === side[i] ? u.partners[1] : u.partners[0];
        if (placed.has(o)) continue;
        placed.add(o);
        side.splice(outward === 'right' ? i + 1 : i, 0, o);
        if (outward === 'left') i++;
      }
    }
  };
  // left is oldest-first, so the most recent former partner ends up next to the hub.
  extend(right, 'right');
  extend(left, 'left');
  const line = [...left, hub, ...right];
  for (const id of comp) if (!placed.has(id)) line.push(id); // shouldn't happen
  return line;
}

/**
 * Least-squares positions closest to `desired`, subject to
 * x[i] - x[i-1] >= minGap[i]. Pool-adjacent-violators on x - cumulativeGap.
 */
export function isotonicSpaced(desired: number[], minGap: number[]): number[] {
  const n = desired.length;
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) (acc += i === 0 ? 0 : minGap[i]), cum.push(acc);
  const target = desired.map((d, i) => d - cum[i]);
  const blocks: { sum: number; count: number }[] = [];
  for (const t of target) {
    blocks.push({ sum: t, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.pop();
      a.sum += b.sum;
      a.count += b.count;
    }
  }
  const y: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) y.push(b.sum / b.count);
  return y.map((v, i) => v + cum[i]);
}

function cmpBirth(g: FamilyGraph, a: Id, b: Id): number {
  const pa = g.people[a], pb = g.people[b];
  const da = pa?.birthDate ?? '9999', db = pb?.birthDate ?? '9999';
  return da.localeCompare(db) || (pa?.createdAt ?? 0) - (pb?.createdAt ?? 0) || a.localeCompare(b);
}
