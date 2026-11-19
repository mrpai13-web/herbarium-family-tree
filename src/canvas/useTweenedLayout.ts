import { useEffect, useRef, useState } from 'react';
import type { Layout, Point } from '../core/layout';

/**
 * When the layout changes (someone is added), glide existing cards to their new
 * spots instead of jumping. Cards and roots both render from these positions,
 * so the roots stay attached while everything moves.
 */
export function useTweenedLayout(layout: Layout, ms = 520): Record<string, Point> {
  const [shown, setShown] = useState(layout.pos);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const from = shownRef.current;
    const to = layout.pos;
    const moving = Object.keys(to).some((id) => from[id] && (from[id].x !== to[id].x || from[id].y !== to[id].y));
    if (!moving || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      // Gentle spring-like ease-out with a hint of overshoot.
      const e = 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.35);
      const next: Record<string, Point> = {};
      for (const id of Object.keys(to)) {
        const a = from[id] ?? to[id];
        next[id] = { x: a.x + (to[id].x - a.x) * e, y: a.y + (to[id].y - a.y) * e };
      }
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShown(to);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, ms]);

  // New people (not yet in `shown`) appear at their final spot straight away.
  const missing = Object.keys(layout.pos).some((id) => !shown[id]);
  return missing ? { ...layout.pos, ...pick(shown, layout.pos) } : shown;
}

function pick(a: Record<string, Point>, keys: Record<string, Point>) {
  const out: Record<string, Point> = {};
  for (const k of Object.keys(keys)) if (a[k]) out[k] = a[k];
  return out;
}
