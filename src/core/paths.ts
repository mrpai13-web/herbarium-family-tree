/** Edge geometry: turns a layout into drawable roots (cubic Beziers) and union bands. */
import { CARD_H, CARD_W, type Layout } from './layout';
import type { FamilyGraph, Id, ParentKind, UnionStatus } from './types';

/** A heart about 15 units wide, centred on (0, 0): the marriage / partnership symbol. */
export const HEART_D = 'M0 6.2C-6.8 1.6-8.6-2.4-6.6-5.2-4.8-7.6-1.6-7.2 0-4.7 1.6-7.2 4.8-7.6 6.6-5.2 8.6-2.4 6.8 1.6 0 6.2Z';
/** The two halves of a broken heart, for former partners. */
export const HEART_BROKEN_L = 'M-.6 5.6C-6.8 1.6-8.6-2.4-6.6-5.2-4.8-7.6-1.6-7.2-.6-5L.9-2.1-1.1.4.6 2.6Z';
export const HEART_BROKEN_R = 'M1.4 5.6C7.6 1.6 9.4-2.4 7.4-5.2 5.6-7.6 2.4-7.2 1.4-5L2.9-2.1.9.4 2.6 2.6Z';

/** Height on the card where partners are joined (portrait level). */
export const UNION_Y = 58;

export type Vec = [number, number];

export interface UnionEdge {
  id: Id;
  status: UnionStatus;
  partners: [Id, Id];
  x1: number;
  x2: number;
  y: number;
  /** Midpoint, where the union ring sits and shared children's roots start. */
  mx: number;
  /** SVG path for the joining line (straight, or an arc over cards in between). */
  d: string;
}

export interface RootEdge {
  /** Stable key: the parent-link ids it represents. */
  id: string;
  linkIds: Id[];
  childId: Id;
  parentIds: Id[];
  kind: ParentKind;
  d: string;
  /** Bezier control points of the curved part, for leaf placement. */
  curve: [Vec, Vec, Vec, Vec];
}

export function buildEdges(g: FamilyGraph, layout: Pick<Layout, 'pos'>): { unions: UnionEdge[]; roots: RootEdge[] } {
  const { pos } = layout;
  const unions: UnionEdge[] = [];
  const unionMid = new Map<Id, { mx: number; y: number }>();

  for (const u of Object.values(g.unions)) {
    const pa = pos[u.partners[0]], pb = pos[u.partners[1]];
    if (!pa || !pb) continue;
    const [L, R] = pa.x <= pb.x ? [pa, pb] : [pb, pa];
    const sameRow = L.y === R.y;
    const x1 = L.x + CARD_W, x2 = R.x, y = L.y + UNION_Y;
    const blocked = sameRow && Object.values(pos).some((p) => p.y === L.y && p.x > L.x && p.x < R.x);
    let d: string, mx: number, my = y;
    if (sameRow && !blocked) {
      d = `M${x1} ${y}H${x2}`;
      mx = (x1 + x2) / 2;
    } else {
      // Arc over the top of whatever sits between them.
      const ax = L.x + CARD_W / 2, bx = R.x + CARD_W / 2, top = Math.min(L.y, R.y);
      d = `M${ax} ${L.y}C${ax} ${top - 46} ${bx} ${top - 46} ${bx} ${R.y}`;
      mx = (ax + bx) / 2;
      my = top - 34;
    }
    unions.push({ id: u.id, status: u.status, partners: u.partners, x1, x2, y: my, mx, d });
    unionMid.set(u.id, { mx, y: my });
  }

  const roots: RootEdge[] = [];
  const byChild = new Map<Id, typeof g.parentLinks[string][]>();
  for (const l of Object.values(g.parentLinks)) {
    if (!pos[l.parentId] || !pos[l.childId]) continue;
    if (!byChild.has(l.childId)) byChild.set(l.childId, []);
    byChild.get(l.childId)!.push(l);
  }

  for (const [childId, links] of byChild) {
    const c = pos[childId];
    const cx = c.x + CARD_W / 2, ct = c.y;
    const used = new Set<Id>();
    // Shared root from a couple when both partners are this child's parents with the same kind.
    for (const u of Object.values(g.unions)) {
      const la = links.find((l) => l.parentId === u.partners[0] && !used.has(l.id));
      const lb = links.find((l) => l.parentId === u.partners[1] && !used.has(l.id));
      if (!la || !lb || la.kind !== lb.kind) continue;
      const m = unionMid.get(u.id);
      if (!m) continue;
      const parentTop = Math.min(pos[la.parentId].y, pos[lb.parentId].y);
      if (ct <= parentTop) continue;
      used.add(la.id).add(lb.id);
      const yb = parentTop + CARD_H + 22;
      const curve = sCurve([m.mx, yb], [cx, ct]);
      roots.push({
        id: la.id + '+' + lb.id,
        linkIds: [la.id, lb.id],
        childId,
        parentIds: [la.parentId, lb.parentId],
        kind: la.kind,
        d: `M${m.mx} ${m.y + 9}V${yb}` + curveD(curve),
        curve,
      });
    }
    for (const l of links) {
      if (used.has(l.id)) continue;
      const p = pos[l.parentId];
      const start: Vec = [p.x + CARD_W / 2, p.y + CARD_H];
      const curve = sCurve(start, [cx, ct]);
      roots.push({
        id: l.id,
        linkIds: [l.id],
        childId,
        parentIds: [l.parentId],
        kind: l.kind,
        d: `M${start[0]} ${start[1]}` + curveD(curve),
        curve,
      });
    }
  }
  return { unions, roots };
}

/** A soft S-curve between two points, vertical at both ends like a hanging root. */
export function sCurve(a: Vec, b: Vec): [Vec, Vec, Vec, Vec] {
  const k = Math.max(30, (b[1] - a[1]) * 0.55);
  return [a, [a[0], a[1] + k], [b[0], b[1] - k], b];
}

function curveD(c: [Vec, Vec, Vec, Vec]): string {
  return `C${c[1][0]} ${c[1][1]} ${c[2][0]} ${c[2][1]} ${c[3][0]} ${c[3][1]}`;
}

export function bezierAt(c: [Vec, Vec, Vec, Vec], t: number): { p: Vec; angle: number } {
  const u = 1 - t;
  const [P0, P1, P2, P3] = c;
  const p: Vec = [
    u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
    u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
  ];
  const dx = 3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
  const dy = 3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
  return { p, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** Leaf positions along a biological root: longer roots grow more leaves. */
export function leafStops(c: [Vec, Vec, Vec, Vec]): number[] {
  const len = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
  if (len > 320) return [0.28, 0.52, 0.76];
  if (len > 160) return [0.34, 0.66];
  return [0.5];
}

export const LEAF_D = 'M0 0C3-4.5 9-5 13 0C9 5 3 4.5 0 0Z';
