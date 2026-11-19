import { motion } from 'framer-motion';
import { memo } from 'react';
import type { Point } from '../core/layout';
import { bezierAt, buildEdges, HEART_BROKEN_L, HEART_BROKEN_R, HEART_D, LEAF_D, leafStops, UNION_Y, type RootEdge, type UnionEdge } from '../core/paths';
import { yearOf } from '../core/dates';
import type { FamilyGraph, Id } from '../core/types';

const C = {
  moss: '#3E6B48',
  fern: '#7FA36B',
  bark: '#8A6A4A',
  faded: '#6E7A66',
  label: '#55634D',
  heart: '#A9566B',
  heartDeep: '#8A3B4E',
  heartPale: '#C9A0AB',
};

const GROW = { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const };

interface Props {
  graph: FamilyGraph;
  pos: Record<Id, Point>;
  fresh: Set<Id>;
  highlight: Set<Id>;
}

/** Roots, grafts and partner tendrils, drawn in world coordinates. */
export const Edges = memo(function Edges({ graph, pos, fresh, highlight }: Props) {
  const { unions, roots } = buildEdges(graph, { pos });
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
      <g>
        {roots.map((r) => (
          <Root
            key={r.id}
            r={r}
            isFresh={r.linkIds.some((l) => fresh.has(l))}
            lit={highlight.has(r.childId) && r.parentIds.some((p) => highlight.has(p))}
          />
        ))}
      </g>
      <g>
        {unions.map((u) => (
          <UnionBand
            key={u.id}
            u={u}
            label={unionLabel(graph, u.id)}
            isFresh={fresh.has(u.id)}
            lit={highlight.has(u.partners[0]) && highlight.has(u.partners[1])}
          />
        ))}
      </g>
    </svg>
  );
});

function unionLabel(g: FamilyGraph, id: Id): string {
  const u = g.unions[id];
  const s = yearOf(u.start), e = yearOf(u.end);
  if (u.status === 'divorced') return s && e ? `m. ${s} · div. ${e}` : e ? `div. ${e}` : 'divorced';
  if (u.status === 'separated') return e ? `sep. ${e}` : 'separated';
  const word = u.kind === 'married' ? 'm.' : 'since';
  return s ? `${word} ${s}` : '';
}

function Root({ r, isFresh, lit }: { r: RootEdge; isFresh: boolean; lit: boolean }) {
  const w = lit ? 1.35 : 1;
  const grow = isFresh
    ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: GROW }
    : { initial: false as const };
  const fade = (delay: number) =>
    isFresh ? { initial: { opacity: 0, scale: 0.2 }, animate: { opacity: 1, scale: 1 }, transition: { delay, duration: 0.35 } } : { initial: false as const };

  if (r.kind === 'biological') {
    return (
      <g>
        <motion.path d={r.d} fill="none" stroke={C.fern} strokeOpacity={0.3} strokeWidth={7 * w} strokeLinecap="round" {...grow} />
        <motion.path d={r.d} fill="none" stroke={C.moss} strokeWidth={2.2 * w} strokeLinecap="round" {...grow} />
        {leafStops(r.curve).map((t, i) => {
          const { p, angle } = bezierAt(r.curve, t);
          const a = angle + (i % 2 ? 55 : -55);
          return (
            <g key={t} transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) rotate(${a.toFixed(1)})`}>
              <motion.path d={LEAF_D} fill={C.fern} stroke={C.moss} strokeWidth={0.7} {...fade(0.45 + t * 0.3)} />
            </g>
          );
        })}
      </g>
    );
  }
  const dash = r.kind === 'adoptive' ? '8 3 2 3' : r.kind === 'step' ? '6 5' : '1 6';
  const opacity = r.kind === 'step' ? 0.75 : 1;
  return (
    <motion.path
      d={r.d}
      fill="none"
      stroke={C.bark}
      strokeOpacity={opacity}
      strokeWidth={(r.kind === 'foster' ? 2.4 : 1.9) * w}
      strokeDasharray={dash}
      strokeLinecap="round"
      {...(isFresh ? { initial: { opacity: 0 }, animate: { opacity }, transition: { duration: 0.6 } } : {})}
    />
  );
}

function UnionBand({ u, label, isFresh, lit }: { u: UnionEdge; label: string; isFresh: boolean; lit: boolean }) {
  const former = u.status === 'divorced' || u.status === 'separated';
  const grow = isFresh
    ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: GROW }
    : { initial: false as const };
  const straight = u.d.includes('H');
  return (
    <g>
      {former ? (
        straight ? (
          <motion.path
            d={`M${u.x1} ${u.y}H${u.mx - 7}M${u.mx + 7} ${u.y}H${u.x2}`}
            stroke={C.faded}
            strokeOpacity={0.55}
            strokeWidth={1.1}
            fill="none"
            {...grow}
          />
        ) : (
          <motion.path d={u.d} stroke={C.faded} strokeOpacity={0.55} strokeWidth={1.1} fill="none" strokeDasharray="10 6" {...grow} />
        )
      ) : (
        <motion.path d={u.d} stroke={C.moss} strokeWidth={lit ? 1.8 : 1.3} fill="none" {...grow} />
      )}
      <g transform={`translate(${u.mx} ${u.y})`}>
        {former ? (
          // Former partners: a faded heart, broken in two.
          <g opacity={0.6} transform="scale(1.05)">
            <path d={HEART_BROKEN_L} fill={C.heartPale} stroke={C.faded} strokeWidth={0.7} strokeLinejoin="round" transform="translate(-1.2 0.4) rotate(-8)" />
            <path d={HEART_BROKEN_R} fill={C.heartPale} stroke={C.faded} strokeWidth={0.7} strokeLinejoin="round" transform="translate(0.6 0.6) rotate(8)" />
          </g>
        ) : (
          <motion.g {...(isFresh ? { initial: { scale: 0 }, animate: { scale: 1 }, transition: { delay: 0.5, type: 'spring', stiffness: 260, damping: 11 } } : {})}>
            {/* Paper-coloured halo so the line doesn't run through the heart. */}
            <path d={HEART_D} fill="none" stroke="#E4E9DC" strokeWidth={4} strokeLinejoin="round" transform="scale(1.15)" />
            <path
              d={HEART_D}
              transform="scale(1.15)"
              fill={u.status === 'widowed' ? C.heartPale : C.heart}
              stroke={u.status === 'widowed' ? C.heart : C.heartDeep}
              strokeWidth={0.8}
              strokeLinejoin="round"
            />
            {u.status !== 'widowed' && <path d="M-4.4-3.6C-3.4-4.9-2-5-1.2-4.2" fill="none" stroke="#F7F6EE" strokeOpacity={0.7} strokeWidth={1.1} strokeLinecap="round" />}
          </motion.g>
        )}
      </g>
      {label && straight && (
        <text
          x={u.mx}
          y={u.y - UNION_Y - 12}
          textAnchor="middle"
          fontFamily='"Courier Prime", monospace'
          fontSize={10}
          fill={C.label}
          opacity={former ? 0.8 : 1}
        >
          {label}
        </text>
      )}
    </g>
  );
}
