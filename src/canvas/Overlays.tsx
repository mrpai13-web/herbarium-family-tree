import { Maximize, Minus, Plus } from 'lucide-react';
import { useRef } from 'react';
import { CARD_H, CARD_W, type Point } from '../core/layout';
import type { Id } from '../core/types';
import type { View } from './useViewport';

export function ZoomControls({ k, onIn, onOut, onFit }: { k: number; onIn(): void; onOut(): void; onFit(): void }) {
  const btn = 'grid h-9 w-10 place-items-center rounded-[10px] text-moss-deep hover:bg-mist';
  return (
    <div data-no-pan className="flex flex-col items-stretch rounded-leaf-md border border-rule bg-card/95 p-1 shadow-specimen" role="group" aria-label="Zoom">
      <button type="button" className={btn} onClick={onIn} aria-label="Zoom in" title="Zoom in">
        <Plus size={16} />
      </button>
      <span className="py-0.5 text-center font-label text-[10px] tabular-nums text-ink-muted" aria-live="polite">
        {Math.round(k * 100)}%
      </span>
      <button type="button" className={btn} onClick={onOut} aria-label="Zoom out" title="Zoom out">
        <Minus size={16} />
      </button>
      <div className="mx-2 my-1 h-px bg-rule" />
      <button type="button" className={btn} onClick={onFit} aria-label="Fit tree to screen" title="Fit to screen (F)">
        <Maximize size={15} />
      </button>
    </div>
  );
}

const MM_W = 188;
const MM_H = 128;

/** Overview of the whole tree; click or drag to move the view. */
export function Minimap({
  pos,
  bounds,
  view,
  size,
  selectedId,
  onCenter,
}: {
  pos: Record<Id, Point>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  view: View;
  size: { w: number; h: number };
  selectedId: Id | null;
  onCenter(wx: number, wy: number): void;
}) {
  const pad = 120;
  const vx = -view.x / view.k, vy = -view.y / view.k;
  const vw = size.w / view.k, vh = size.h / view.k;
  // Show the tree and the current view together, so the view box never falls off the map.
  const bx = Math.min(bounds.minX - pad, vx), by = Math.min(bounds.minY - pad, vy);
  const bw = Math.max(bounds.maxX + pad, vx + vw) - bx, bh = Math.max(bounds.maxY + pad, vy + vh) - by;
  const s = Math.min((MM_W - 8) / bw, (MM_H - 8) / bh);
  const ox = (MM_W - bw * s) / 2, oy = (MM_H - bh * s) / 2;
  const toMM = (wx: number, wy: number) => [ox + (wx - bx) * s, oy + (wy - by) * s];
  const [rx, ry] = toMM(vx, vy);
  const dragging = useRef(false);

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    onCenter(bx + (mx - ox) / s, by + (my - oy) / s);
  };
  return (
    <div data-no-pan className="overflow-hidden rounded-leaf-md border border-rule bg-card/95 shadow-specimen">
      <svg
        width={MM_W}
        height={MM_H}
        role="img"
        aria-label="Mini-map of the whole tree. Click to move there."
        className="block cursor-pointer touch-none"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => dragging.current && move(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        {Object.entries(pos).map(([id, p]) => {
          const [x, y] = toMM(p.x, p.y);
          return (
            <rect key={id} x={x} y={y} width={Math.max(2, CARD_W * s)} height={Math.max(2, CARD_H * s)} rx={2} fill={id === selectedId ? '#3E6B48' : '#C6D0B9'} />
          );
        })}
        <rect
          x={rx}
          y={ry}
          width={(size.w / view.k) * s}
          height={(size.h / view.k) * s}
          fill="rgba(127,163,107,.12)"
          stroke="#7FA36B"
          strokeWidth={1.5}
          rx={3}
        />
      </svg>
    </div>
  );
}

function fern(x: number, y: number, r: number, s: number, key: string) {
  const leaves = [];
  for (let i = 0; i < 11; i++) {
    const yy = -14 - i * 12.5, w = 11 - i * 0.75;
    leaves.push(
      <ellipse key={'a' + i} cx={w + 1} cy={yy} rx={w} ry={3.2} transform={`rotate(-32 0 ${yy})`} />,
      <ellipse key={'b' + i} cx={-w - 1} cy={yy} rx={w} ry={3.2} transform={`rotate(32 0 ${yy})`} />,
    );
  }
  return (
    <g key={key} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} fill="#7FA36B" stroke="#5E8550" opacity={0.22}>
      <path d="M0 0Q8-70 0-150" fill="none" strokeWidth={1.6} />
      {leaves}
    </g>
  );
}

/** Pressed ferns in the sheet's corners; fixed to the screen, purely decorative. */
export function Backdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <svg x="0" y="100%" overflow="visible">{fern(30, -10, 24, 1.4, 'bl')}</svg>
      <svg x="100%" y="0" overflow="visible">{fern(-40, 70, 200, 1.1, 'tr')}</svg>
      <svg x="100%" y="100%" overflow="visible">{fern(-250, -6, -24, 0.9, 'br')}</svg>
    </svg>
  );
}
