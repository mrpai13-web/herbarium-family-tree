import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface View {
  x: number; // screen offset of world origin
  y: number;
  k: number; // zoom
}

export const MIN_K = 0.2;
export const MAX_K = 2.2;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/**
 * Pan / zoom for an infinite canvas: drag to pan, wheel or pinch to zoom at the
 * pointer, animated zoom-to and fit. Returns `moved` so clicks after a drag
 * can be ignored.
 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How much of the tree (in screen px) must stay on screen while panning and zooming. */
const KEEP = 140;

export function useViewport(container: RefObject<HTMLDivElement>, bounds?: RefObject<Bounds>) {
  const [view, setRawView] = useState<View>({ x: 0, y: 0, k: 1 });
  /**
   * Every view change goes through here. A non-finite value (e.g. a zero-distance pinch
   * dividing by zero) would draw every card nowhere and leave an empty sheet for good,
   * so such updates are dropped.
   */
  const setView = useCallback((next: View | ((v: View) => View)) => {
    setRawView((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k) && v.k > 0 ? v : prev;
    });
  }, []);

  /**
   * Keeps part of the tree on screen. Without this a quick drag on a small tree can
   * fling every card out of sight and the sheet looks blank.
   */
  const keepInView = useCallback(
    (v: View): View => {
      const el = container.current, b = bounds?.current;
      if (!el || !b || (b.maxX === b.minX && b.maxY === b.minY)) return v;
      const W = el.clientWidth, H = el.clientHeight;
      const mx = Math.min(KEEP, ((b.maxX - b.minX) * v.k) / 2, W / 3), my = Math.min(KEEP, ((b.maxY - b.minY) * v.k) / 2, H / 3);
      const clamp = (n: number, lo: number, hi: number) => (lo > hi ? n : Math.min(hi, Math.max(lo, n)));
      return {
        k: v.k,
        x: clamp(v.x, mx - b.maxX * v.k, W - mx - b.minX * v.k),
        y: clamp(v.y, my - b.maxY * v.k, H - my - b.minY * v.k),
      };
    },
    [container, bounds],
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const anim = useRef<number>();
  const moved = useRef(false);

  const stop = () => anim.current && cancelAnimationFrame(anim.current);

  const animateTo = useCallback((target: View, ms = 420) => {
    stop();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return setView(target);
    const from = viewRef.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e });
      if (t < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  }, []);

  /** Zoom by factor around a screen point (defaults to the centre). */
  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }, animated = true) => {
      const el = container.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = at?.x ?? r.width / 2;
      const py = at?.y ?? r.height / 2;
      const v = viewRef.current;
      const k = clampK(v.k * factor);
      const next = keepInView({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
      animated ? animateTo(next, 220) : (stop(), setView(next));
    },
    [animateTo, container, keepInView],
  );

  /** Fit a world-space box into the screen, leaving room for overlays. */
  const fit = useCallback(
    (b: { minX: number; minY: number; maxX: number; maxY: number }, animated = true, pad = { t: 110, r: 60, b: 60, l: 60 }) => {
      const el = container.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY);
      const k = clampK(Math.min(1.1, (r.width - pad.l - pad.r) / w, (r.height - pad.t - pad.b) / h));
      const next = {
        k,
        x: pad.l + (r.width - pad.l - pad.r - w * k) / 2 - b.minX * k,
        y: pad.t + (r.height - pad.t - pad.b - h * k) / 2 - b.minY * k,
      };
      animated ? animateTo(next) : setView(next);
    },
    [animateTo, container],
  );

  /** Centre a world point on screen (keeps zoom unless given). */
  const centerOn = useCallback(
    (wx: number, wy: number, k?: number) => {
      const el = container.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const kk = k ?? viewRef.current.k;
      animateTo({ k: kk, x: r.width / 2 - wx * kk, y: r.height / 2 - wy * kk });
    },
    [animateTo, container],
  );

  // Pointer handling: drag to pan, two-finger pinch to zoom.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; vx: number; vy: number } | null = null;
    let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
      stop();
      // A primary pointer going down starts a new gesture: forget any pointer whose
      // release we never saw (let go outside the window, alt-tab…), or the next drag
      // would be treated as a pinch against a stale point.
      if (e.isPrimary || e.pointerType === 'mouse') {
        pts.clear();
        pinch = null;
      }
      pts.set(e.pointerId, local(e));
      moved.current = false;
      if (pts.size === 1) {
        const p = local(e);
        start = { x: p.x, y: p.y, vx: viewRef.current.x, vy: viewRef.current.y };
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        // Two fingers on the same spot can't define a zoom; wait for them to spread.
        if (Math.hypot(a.x - b.x, a.y - b.y) < 8) return;
        pinch = {
          d: Math.hypot(a.x - b.x, a.y - b.y), k: viewRef.current.k,
          cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: viewRef.current.x, vy: viewRef.current.y,
        };
        start = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const k = clampK((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        setView(keepInView({ k, x: cx - ((pinch.cx - pinch.vx) * k) / pinch.k, y: cy - ((pinch.cy - pinch.vy) * k) / pinch.k }));
        moved.current = true;
      } else if (start) {
        const dx = p.x - start.x, dy = p.y - start.y;
        if (!moved.current && Math.hypot(dx, dy) < 4) return;
        if (!moved.current) {
          moved.current = true;
          el.setPointerCapture(e.pointerId);
          el.dataset.panning = 'true';
        }
        // Work out the position now: React may run this update after the pointer is
        // released and `start` is cleared, which used to crash with "reading 'vx' of null".
        const x = start.vx + dx, y = start.vy + dy;
        setView((v) => keepInView({ ...v, x, y }));
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        start = null;
        delete el.dataset.panning;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(-px * (e.ctrlKey ? 0.01 : 0.0018)), at, false);
    };
    // A click that ends a drag shouldn't open a card.
    const onClickCapture = (e: MouseEvent) => {
      if (moved.current) {
        e.stopPropagation();
        e.preventDefault();
        moved.current = false;
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    // A release outside the canvas (before capture began) still ends the drag.
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, [container, zoomBy, keepInView]);

  return { view, setView, animateTo, zoomBy, fit, centerOn };
}
