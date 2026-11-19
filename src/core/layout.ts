/**
 * Auto-layout for the family graph. Pure and deterministic; see README "Layout".
 *
 *  1. Generations: a walk over the family puts each child exactly one row below
 *     their parents and partners on one row, so siblings, their partners and
 *     in-law families line up; a relaxation then repairs conflicting data.
 *  2. Clusters: partners in a row form one unbreakable cluster
 *     (former partners on the left, current on the right of the shared person).
 *  3. Ordering: built outward from a focus couple (the selected family group's):
 *     one partner's relatives to the left, the other's to the right, and recursively
 *     every couple's two families on their own partner's side, so a parent's father
 *     and mother stay above that parent. Then adjacent swaps that strictly reduce
 *     line crossings clean up what the structure didn't decide.
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
  row: number;
  width: number;
  /** x offset of each member's card left edge from the cluster's left edge. */
  offsets: number[];
  x: number; // left edge
  order: number;
}

export interface LayoutOptions {
  /**
   * The family to build the tree around (a family group's members). Its central couple
   * sits in the middle with one partner's relatives to the left and the other's to the right.
   * Without it, the couple with the most direct ancestors and descendants is used.
   */
  focus?: Id[];
}

export function computeLayout(g: FamilyGraph, opts: LayoutOptions = {}): Layout {
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

  /* ---- 1. generations
   * First a breadth-first walk over the family: a child is exactly one row below a parent,
   * partners share a row. So siblings and their partners line up, and families joined by
   * marriage align with each other however many ancestors each has recorded. Then a
   * relaxation repairs anything the walk couldn't satisfy (e.g. a marriage across
   * generations): children always end up below parents, partners on one row. */
  const gen: Record<Id, number> = {};
  const compOf: Record<Id, number> = {};
  {
    const adj = new Map<Id, [Id, number][]>(ids.map((id) => [id, []]));
    for (const u of unions) {
      adj.get(u.partners[0])!.push([u.partners[1], 0]);
      adj.get(u.partners[1])!.push([u.partners[0], 0]);
    }
    for (const l of links) {
      adj.get(l.parentId)!.push([l.childId, 1]);
      adj.get(l.childId)!.push([l.parentId, -1]);
    }
    let comp = 0;
    for (const start of ids) {
      if (start in gen) continue;
      gen[start] = 0;
      compOf[start] = comp;
      const queue = [start];
      for (let qi = 0; qi < queue.length; qi++) {
        const c = queue[qi];
        for (const [o, d] of adj.get(c)!) {
          if (o in gen) continue;
          gen[o] = gen[c] + d;
          compOf[o] = comp;
          queue.push(o);
        }
      }
      comp++;
    }
  }
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
  // Each separate family starts at the top row.
  const compMin = new Map<number, number>();
  for (const id of ids) compMin.set(compOf[id], Math.min(compMin.get(compOf[id]) ?? Infinity, gen[id]));
  for (const id of ids) gen[id] -= compMin.get(compOf[id])!;
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
    const cl: Cluster = { members, row: gen[id], offsets, width: offsets[offsets.length - 1] + CARD_W, x: 0, order: 0 };
    for (const m of members) clusterOf.set(m, cl);
    rows[gen[id]].push(cl);
  }

  /* ---- 3. ordering, built outward from the focus family (see orderAroundFocus) */
  orderAroundFocus(g, rows, clusterOf, parentsOf, childrenOf, gen, opts.focus);
  reduceCrossings(rows, clusterOf, parentsOf, childrenOf, gen);

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
 * Decides the left-to-right order of the clusters in every row.
 *
 * The tree is walked outward from the focus couple, appending clusters to their row as
 * they're reached, so each row's order is the order of the walk. Everything is appended in
 * whole "blocks" (a person's family on one side of them), which keeps families together:
 *  - The focus couple's left partner gets their whole family to the left, the right
 *    partner theirs to the right; the couple's descendants hang in between.
 *  - `up(P, side)`: P's parents with, on the outer side, the outer parent's own family, then
 *    P's brothers and sisters (and their partners' families further out), and on the inner
 *    side the inner parent's family. So a parent's father and mother stay above that parent.
 *  - `down(C)`: a couple's children in birth order; the first half have their partner (and
 *    the partner's family) on the left, the rest on the right, so in-laws spread outward.
 */
function orderAroundFocus(
  g: FamilyGraph,
  rows: Cluster[][],
  clusterOf: Map<Id, Cluster>,
  parentsOf: Map<Id, Id[]>,
  childrenOf: Map<Id, Id[]>,
  gen: Record<Id, number>,
  focus?: Id[],
) {
  const order: Cluster[][] = rows.map(() => []);
  const placed = new Set<Cluster>();
  const busy = new Set<Cluster>();
  const done = (cl: Cluster) => placed.has(cl) || busy.has(cl);
  const emit = (cl: Cluster) => {
    if (placed.has(cl)) return;
    placed.add(cl);
    order[cl.row].push(cl);
  };
  const sexRank = (id: Id) => (g.people[id]?.sex === 'male' ? 0 : g.people[id]?.sex === 'female' ? 2 : 1);
  // Couples read husband, wife unless something below decides otherwise.
  for (const row of rows)
    for (const cl of row) if (cl.members.length === 2 && sexRank(cl.members[0]) > sexRank(cl.members[1])) cl.members.reverse();

  /** Put `anchor` on the inner edge: the right end when the block grows left, and vice versa. */
  const orient = (cl: Cluster, anchor: Id, side: 'left' | 'right') => {
    if (placed.has(cl) || cl.members.length < 2) return;
    const i = cl.members.indexOf(anchor);
    if (cl.members.length === 2) {
      if ((side === 'left') !== (i === 1)) cl.members.reverse();
    } else if ((side === 'left' && i < (cl.members.length - 1) / 2) || (side === 'right' && i > (cl.members.length - 1) / 2)) {
      cl.members.reverse();
    }
  };
  const cmpBirthIds = (a: Id, b: Id) => cmpBirth(g, a, b);
  /** The clusters of `cl`'s children (minus `skip`), ordered by which partner they belong to, then birth. */
  const childClusters = (cl: Cluster, skip?: Id): { kid: Id; cl: Cluster }[] => {
    const kids = new Map<Id, number>();
    cl.members.forEach((m, i) => {
      for (const k of childrenOf.get(m)!) {
        if (k === skip || gen[k] <= cl.row) continue;
        kids.set(k, (kids.get(k) ?? 0) + i);
      }
    });
    const key = (k: Id) => kids.get(k)! / Math.max(1, parentsOf.get(k)!.filter((p) => cl.members.includes(p)).length);
    const out: { kid: Id; cl: Cluster }[] = [];
    const seen = new Set<Cluster>();
    for (const k of [...kids.keys()].sort((a, b) => key(a) - key(b) || cmpBirthIds(a, b))) {
      const kc = clusterOf.get(k)!;
      if (kc === cl || seen.has(kc) || done(kc)) continue;
      seen.add(kc);
      out.push({ kid: k, cl: kc });
    }
    return out;
  };
  const parentClusters = (p: Id): Cluster[] => {
    const out: Cluster[] = [];
    const ps = [...parentsOf.get(p)!].sort((a, b) => sexRank(a) - sexRank(b) || cmpBirthIds(a, b));
    for (const q of ps) {
      const c = clusterOf.get(q)!;
      if (!out.includes(c)) out.push(c);
    }
    return out;
  };

  const up = (p: Id, side: 'left' | 'right') => {
    for (const pc of parentClusters(p)) {
      if (done(pc)) continue;
      busy.add(pc);
      const ms = pc.members;
      const first = ms[0], last = ms[ms.length - 1], mid = ms.slice(1, -1);
      const sibs = childClusters(pc, p);
      if (side === 'left') {
        up(first, 'left');
        for (const m of mid) up(m, 'left');
        for (const s of sibs) family(s.kid, s.cl, 'left');
        emit(pc);
        if (ms.length > 1) up(last, 'right');
      } else {
        if (ms.length > 1) up(first, 'left');
        emit(pc);
        for (const m of mid) up(m, 'right');
        for (const s of sibs) family(s.kid, s.cl, 'right');
        up(last, 'right');
      }
      busy.delete(pc);
    }
  };
  /** A brother's or sister's household, with their partner's family on the outer side. */
  const family = (anchor: Id, cl: Cluster, side: 'left' | 'right') => {
    if (done(cl)) return;
    busy.add(cl);
    orient(cl, anchor, side);
    const others = cl.members.filter((m) => m !== anchor);
    if (side === 'left') for (const o of others) up(o, 'left');
    downInner(cl);
    if (side === 'right') for (const o of others) up(o, 'right');
    busy.delete(cl);
  };
  const downInner = (cl: Cluster) => {
    const kcs = childClusters(cl);
    const half = Math.floor(kcs.length / 2);
    kcs.forEach((k, i) => i < half && family(k.kid, k.cl, 'left'));
    emit(cl);
    kcs.forEach((k, i) => i >= half && family(k.kid, k.cl, 'right'));
  };
  const centre = (cl: Cluster) => {
    if (done(cl)) return;
    busy.add(cl);
    const ms = cl.members;
    up(ms[0], 'left');
    for (const m of ms.slice(1, -1)) up(m, 'left');
    downInner(cl);
    if (ms.length > 1) up(ms[ms.length - 1], 'right');
    busy.delete(cl);
  };

  centre(focusCluster(rows, clusterOf, parentsOf, childrenOf, focus));
  // Anything not reached (separate families, people on their own) follows on the right.
  const rest = rows.flat().sort((a, b) => a.row - b.row || cmpBirthIds(a.members[0], b.members[0]));
  for (const cl of rest) centre(cl);

  order.forEach((row, r) => {
    rows[r] = row;
    row.forEach((cl, i) => (cl.order = i));
  });
}

/**
 * The couple the tree is built around: among couples in the focus set, the one through
 * whom most of the set descends or is descended (so a group of a couple, their children and
 * their parents picks the couple, not the grandparents). With no focus, everyone counts.
 */
function focusCluster(
  rows: Cluster[][],
  clusterOf: Map<Id, Cluster>,
  parentsOf: Map<Id, Id[]>,
  childrenOf: Map<Id, Id[]>,
  focus?: Id[],
): Cluster {
  const all = rows.flat();
  const inFocus = new Set((focus ?? []).filter((id) => clusterOf.has(id)));
  const counts = (ids: Set<Id>) => (cl: Cluster) => {
    const seen = new Set<Id>(cl.members);
    const walk = (start: Id[], next: Map<Id, Id[]>) => {
      const stack = [...start];
      while (stack.length) for (const n of next.get(stack.pop()!)!) if (!seen.has(n)) (seen.add(n), stack.push(n));
    };
    walk(cl.members, parentsOf);
    walk(cl.members, childrenOf);
    let n = 0;
    for (const id of seen) if (ids.has(id)) n++;
    return n;
  };
  const everyone = new Set(clusterOf.keys());
  const score = counts(inFocus.size ? inFocus : everyone);
  const total = counts(everyone);
  let candidates = all;
  if (inFocus.size) {
    const withFocus = all.filter((cl) => cl.members.some((m) => inFocus.has(m)));
    const couples = withFocus.filter((cl) => cl.members.filter((m) => inFocus.has(m)).length >= 2);
    candidates = couples.length ? couples : withFocus;
  } else {
    const couples = all.filter((cl) => cl.members.length >= 2);
    if (couples.length) candidates = couples;
  }
  let best = candidates[0];
  let bestKey = [-1, -1];
  for (const cl of candidates) {
    const key = [score(cl), total(cl)];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) (best = cl), (bestKey = key);
  }
  return best;
}

/**
 * Swaps neighbouring clusters (and turns couples around) only when that strictly lowers the
 * number of crossing lines between the rows on either side, so the family-side structure
 * stays unless changing it untangles something.
 */
function reduceCrossings(
  rows: Cluster[][],
  clusterOf: Map<Id, Cluster>,
  parentsOf: Map<Id, Id[]>,
  childrenOf: Map<Id, Id[]>,
  gen: Record<Id, number>,
) {
  const at = (id: Id) => {
    const cl = clusterOf.get(id)!;
    return cl.order + (cl.members.indexOf(id) + 0.5) / cl.members.length;
  };
  /** Lines between row r and r+1: [x on row r, x on row r+1]. A couple's child hangs from their midpoint. */
  const lines = (r: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const cl of rows[r + 1] ?? []) {
      for (const k of cl.members) {
        const ps = parentsOf.get(k)!.filter((p) => gen[p] === r);
        const byCluster = new Map<Cluster, number[]>();
        for (const p of ps) {
          const pc = clusterOf.get(p)!;
          if (!byCluster.has(pc)) byCluster.set(pc, []);
          byCluster.get(pc)!.push(at(p));
        }
        for (const xs of byCluster.values()) out.push([xs.reduce((a, b) => a + b, 0) / xs.length, at(k)]);
      }
    }
    return out;
  };
  const crossings = (r: number) => {
    if (r < 0 || r + 1 >= rows.length) return 0;
    const ls = lines(r);
    let n = 0;
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) if ((ls[i][0] - ls[j][0]) * (ls[i][1] - ls[j][1]) < 0) n++;
    return n;
  };
  const near = (r: number) => crossings(r - 1) + crossings(r);
  const hasLines = (cl: Cluster) =>
    cl.members.some((m) => parentsOf.get(m)!.length || childrenOf.get(m)!.length);
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.some(hasLines)) continue;
      let before = near(r);
      for (let i = 0; i + 1 < row.length; i++) {
        if (!hasLines(row[i]) && !hasLines(row[i + 1])) continue;
        const swap = () => {
          [row[i], row[i + 1]] = [row[i + 1], row[i]];
          row[i].order = i;
          row[i + 1].order = i + 1;
        };
        swap();
        const after = near(r);
        if (after < before) (before = after), (improved = true);
        else swap();
      }
      for (const cl of row) {
        if (cl.members.length < 2 || !hasLines(cl)) continue;
        cl.members.reverse();
        const after = near(r);
        if (after < before) (before = after), (improved = true);
        else cl.members.reverse();
      }
    }
    if (!improved) break;
  }
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
