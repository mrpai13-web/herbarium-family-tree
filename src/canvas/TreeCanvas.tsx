import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { personMatches, yearOf } from '../core/dates';
import { CARD_H, CARD_W, computeLayout, ROW_H } from '../core/layout';
import { childLinksOf, parentLinksOf, unionsOf, partnerIn } from '../core/relations';
import type { AddDirection, FamilyGraph, Id } from '../core/types';
import { buildEdges, type UnionEdge } from '../core/paths';
import { describeUnion } from '../core/describe';
import { groupBox } from '../core/groups';
import type { ConnectAs } from '../core/relations';
import { useStore } from '../data/store';
import { Edges } from './Edges';
import { EdgeLayer, type EdgeRef } from './EdgeLayer';
import { Backdrop, Minimap, ZoomControls } from './Overlays';
import { PersonCard, type WhipSide } from './PersonCard';
import { CoupleMenu, type CoupleDrop } from './CoupleMenu';
import { useTweenedLayout } from './useTweenedLayout';
import { useViewport } from './useViewport';
import { WhipMenu, type WhipDrop } from './WhipMenu';

export interface TreeCanvasHandle {
  fit(): void;
  focusPerson(id: Id): void;
}

function noteFor(g: FamilyGraph, id: Id): string | undefined {
  const p = g.people[id];
  const adopted = parentLinksOf(g, id).find((l) => l.kind === 'adoptive');
  if (adopted) return adopted.since ? `adopted ${yearOf(adopted.since)}` : 'adopted';
  if (p.birthSurname && p.birthSurname !== p.surname) return `née ${p.birthSurname}`;
  if (p.nickname) return `“${p.nickname}”`;
  return undefined;
}

export const TreeCanvas = forwardRef<TreeCanvasHandle, { query: string; drawerOpen: boolean }>(function TreeCanvas(
  { query, drawerOpen },
  ref,
) {
  const graph = useStore((s) => s.graph);
  const selectedId = useStore((s) => s.selectedId);
  const fresh = useStore((s) => s.fresh);
  const select = useStore((s) => s.select);
  const consumeFresh = useStore((s) => s.consumeFresh);
  const shownGroup = useStore((s) => (s.shownGroupId ? s.graph.groups?.[s.shownGroupId] : undefined));
  const groupEditing = useStore((s) => s.groupEditing);
  const toggleGroupMember = useStore((s) => s.toggleGroupMember);
  const setGroupEditing = useStore((s) => s.setGroupEditing);
  const showGroup = useStore((s) => s.showGroup);

  const box = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => computeLayout(graph), [graph]);
  const boundsRef = useRef(layout.bounds);
  boundsRef.current = layout.bounds;
  const { view, setView, zoomBy, fit, centerOn } = useViewport(box, boundsRef);
  const pos = useTweenedLayout(layout);
  const [size, setSize] = useState({ w: 1200, h: 800 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Room on the right for the drawer when it's open (desktop widths).
  const rightPad = drawerOpen && size.w > 900 ? 460 : 60;
  const doFit = useCallback(
    (animated = true) => fit(layout.bounds, animated, { t: 120, r: rightPad, b: 70, l: 60 }),
    [fit, layout.bounds, rightPad],
  );

  // Fit once on first render.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && Object.keys(layout.pos).length && size.w > 0) {
      fitted.current = true;
      doFit(false);
    }
  }, [doFit, layout.pos, size.w]);

  const focusPerson = useCallback(
    (id: Id) => {
      const p = layout.pos[id];
      if (!p) return;
      const k = view.k;
      const sx = p.x * k + view.x, sy = p.y * k + view.y;
      const visible = sx > 40 && sy > 100 && sx + CARD_W * k < size.w - rightPad && sy + CARD_H * k < size.h - 40;
      if (!visible) {
        const offset = rightPad > 60 ? (rightPad - 60) / 2 / k : 0;
        centerOn(p.x + CARD_W / 2 + offset, p.y + CARD_H / 2, Math.max(k, 0.7));
      }
    },
    [layout.pos, view, size, rightPad, centerOn],
  );

  useImperativeHandle(ref, () => ({ fit: () => doFit(), focusPerson }), [doFit, focusPerson]);

  // Keep a freshly sprouted person in view, then retire their "fresh" flag once animations are done.
  useEffect(() => {
    if (!fresh.size) return;
    if (selectedId && fresh.has(selectedId)) focusPerson(selectedId);
    const ids = [...fresh];
    const t = setTimeout(() => ids.forEach(consumeFresh), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  // Keyboard: F = fit, +/- = zoom (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'f' || e.key === 'F') doFit();
      else if (e.key === '+' || e.key === '=') zoomBy(1.2);
      else if (e.key === '-') zoomBy(1 / 1.2);
      else if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doFit, zoomBy, select]);

  const highlight = useMemo(() => {
    const s = new Set<Id>();
    if (!selectedId || !graph.people[selectedId]) return s;
    s.add(selectedId);
    parentLinksOf(graph, selectedId).forEach((l) => s.add(l.parentId));
    childLinksOf(graph, selectedId).forEach((l) => s.add(l.childId));
    unionsOf(graph, selectedId).forEach((u) => s.add(partnerIn(u, selectedId)));
    return s;
  }, [graph, selectedId]);

  const matches = (id: Id) => personMatches(graph.people[id], query);
  const members = useMemo(() => new Set(shownGroup?.memberIds ?? []), [shownGroup]);

  // While editing a group, clicking a card adds or removes them instead of opening the profile.
  const editingRef = useRef<{ on: boolean; id?: Id }>({ on: false });
  editingRef.current = { on: groupEditing, id: shownGroup?.id };
  const onOpen = useCallback(
    (id: Id) => {
      const e = editingRef.current;
      if (e.on && e.id) void toggleGroupMember(e.id, id);
      else select(id);
    },
    [select, toggleGroupMember],
  );

  // Showing a group brings it into view.
  const shownId = shownGroup?.id;
  useEffect(() => {
    if (!shownId) return;
    const g = useStore.getState().graph.groups?.[shownId];
    const b = g && groupBox(g.memberIds, layout.pos);
    if (b) fit({ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h }, true, { t: 130, r: rightPad, b: 80, l: 60 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  // Esc or Enter finishes editing a group.
  useEffect(() => {
    if (!groupEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopImmediatePropagation();
        setGroupEditing(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [groupEditing, setGroupEditing]);

  // ---- Pick whip: drag a vine from a card's side (or a couple's link) to another card, or to empty sheet.
  // The side sets the direction: up = a parent, down = a child, left = a sibling, right = a partner.
  type Source = { kind: 'person'; id: Id; side: WhipSide } | { kind: 'union'; id: Id };
  const [whip, setWhip] = useState<{ src: Source; x: number; y: number; over: Id | null } | null>(null);
  const [drop, setDrop] = useState<WhipDrop | null>(null);
  const [coupleDrop, setCoupleDrop] = useState<CoupleDrop | null>(null);
  const [edgeSel, setEdgeSel] = useState<(EdgeRef & { x: number; y: number }) | null>(null);
  const edges = useMemo(() => buildEdges(graph, { pos }), [graph, pos]);
  const swallowClick = useRef(false);
  const viewNow = useRef(view);
  viewNow.current = view;
  const toWorld = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    const v = viewNow.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };
  const startWhip = useCallback((src: Source, e: React.PointerEvent) => {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    let over: Id | null = null;
    setDrop(null);
    setCoupleDrop(null);
    const self = src.kind === 'person' ? src.id : null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      // A card, or one of its handles, counts as that card.
      const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-person-id], [data-card-of]');
      const hitId = hit?.dataset.personId ?? hit?.dataset.cardOf;
      over = hitId && hitId !== self ? hitId : null;
      if (box.current) box.current.dataset.whipping = 'true';
      setWhip({ src, ...toWorld(ev.clientX, ev.clientY), over });
    };
    const stop = () => {
      if (box.current) delete box.current.dataset.whipping;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', esc, true);
      setWhip(null);
    };
    const end = (ev: PointerEvent) => {
      stop();
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 0);
      const st = useStore.getState();
      if (src.kind === 'union') {
        if (!moved) setCoupleDrop({ unionId: src.id, x: sx, y: sy });
        else if (over) setCoupleDrop({ unionId: src.id, to: over, x: ev.clientX, y: ev.clientY });
        else void st.sproutCoupleChild(src.id);
        return;
      }
      if (!moved) setDrop({ from: src.id, x: sx, y: sy, preset: PRESET[src.side] });
      else if (over) setDrop({ from: src.id, to: over, x: ev.clientX, y: ev.clientY, preset: PRESET[src.side] });
      // Dropped on empty sheet: grow a new relative in that direction straight away (Ctrl+Z undoes).
      else void st.sprout(src.id, SPROUT[src.side]);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        stop();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', esc, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onWhipStart = useCallback((id: Id, side: WhipSide, e: React.PointerEvent) => startWhip({ kind: 'person', id, side }, e), [startWhip]);
  const onWhipOpen = useCallback((from: Id, side: WhipSide, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setDrop({ from, x: r.left + r.width / 2, y: r.bottom, preset: PRESET[side] });
  }, []);
  const whipFrom = whip ? whipStart(whip.src, pos, edges.unions) : null;

  return (
    <div
      ref={box}
      onClickCapture={(e) => {
        // The click that ends a whip drag lands on whatever is underneath; ignore it.
        if (swallowClick.current) {
          e.stopPropagation();
          swallowClick.current = false;
        }
      }}
      className="canvas-bg absolute inset-0 cursor-grab touch-none select-none overflow-hidden data-[panning=true]:cursor-grabbing"
      role="application"
      aria-label="Family tree canvas. Drag to pan, scroll or pinch to zoom."
      onClick={(e) => {
        if (e.target === e.currentTarget) select(null);
      }}
    >
      <Backdrop />
      <GenerationBands graph={graph} gen={layout.gen} view={view} />
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        onClick={(e) => {
          if (e.target === e.currentTarget) select(null);
        }}
      >
        {shownGroup && <GroupFrame name={shownGroup.name} color={shownGroup.color} box={groupBox(shownGroup.memberIds, pos)} editing={groupEditing} />}
        <Edges graph={graph} pos={pos} fresh={fresh} highlight={highlight} />
        <EdgeLayer graph={graph} roots={edges.roots} unions={edges.unions} selected={edgeSel} onSelect={setEdgeSel} />
        {Object.values(graph.people).map((p) =>
          pos[p.id] ? (
            <PersonCard
              key={p.id}
              person={p}
              x={pos[p.id].x}
              y={pos[p.id].y}
              note={noteFor(graph, p.id)}
              selected={p.id === selectedId}
              dimmed={!matches(p.id) || (!!shownGroup && !members.has(p.id))}
              groupColor={groupEditing && shownGroup ? shownGroup.color : undefined}
              groupMember={members.has(p.id)}
              isFresh={fresh.has(p.id)}
              whipTarget={whip?.over === p.id}
              whipSource={whip?.src.kind === 'person' && whip.src.id === p.id}
              onOpen={onOpen}
              onWhipStart={onWhipStart}
              onWhipOpen={onWhipOpen}
            />
          ) : null,
        )}
        {edges.unions.map((u) => (
          <CoupleHandle
            key={u.id}
            u={u}
            names={u.partners.map((id) => graph.people[id]?.givenName || 'Unnamed').join(' and ')}
            about={describeUnion(graph, u.id)}
            active={whip?.src.kind === 'union' && whip.src.id === u.id}
            onStart={(e) => startWhip({ kind: 'union', id: u.id }, e)}
            onOpen={(el) => {
              const r = el.getBoundingClientRect();
              setCoupleDrop({ unionId: u.id, x: r.left + r.width / 2, y: r.bottom });
            }}
          />
        ))}
        {whip && whipFrom && (
          <WhipVine from={whipFrom} to={whip} over={!!whip.over} label={whipLabel(whip.src, whip.over, graph)} />
        )}
      </div>
      {drop && graph.people[drop.from] && <WhipMenu drop={drop} graph={graph} gen={layout.gen} onClose={() => setDrop(null)} />}
      {coupleDrop && graph.unions[coupleDrop.unionId] && <CoupleMenu drop={coupleDrop} graph={graph} onClose={() => setCoupleDrop(null)} />}

      {shownGroup && (
        <div className="pointer-events-none absolute inset-x-0 top-[132px] z-10 flex justify-center px-4 sm:top-4" data-no-pan>
          <div
            className="pointer-events-auto flex max-w-[min(560px,100%)] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-leaf-md border bg-card/95 px-3.5 py-2 text-[13px] shadow-lift"
            style={{ borderColor: shownGroup.color }}
            role="status"
          >
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: shownGroup.color }} />
            <span className="min-w-0">
              {groupEditing ? 'Editing ' : ''}
              <b className="font-display font-normal">{shownGroup.name}</b>
              <span className="text-ink-muted">
                {' · '}
                {shownGroup.memberIds.length} {shownGroup.memberIds.length === 1 ? 'person' : 'people'}
                {groupEditing ? ' · click cards to add or remove' : ''}
              </span>
            </span>
            {groupEditing ? (
              <button type="button" className="btn-solid !py-1 !text-[12.5px]" onClick={() => setGroupEditing(false)}>
                Done
              </button>
            ) : (
              <>
                <button type="button" className="btn !py-1 !text-[12.5px]" onClick={() => setGroupEditing(true)}>
                  Add or remove people
                </button>
                <button type="button" className="btn !py-1 !text-[12.5px]" onClick={() => showGroup(null)} aria-label="Hide group box">
                  Hide
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div
        className="absolute bottom-4 flex flex-col items-end gap-3 transition-[right] duration-300"
        style={{ right: rightPad > 60 ? 456 : 16 }}
      >
        <ZoomControls k={view.k} onIn={() => zoomBy(1.25)} onOut={() => zoomBy(0.8)} onFit={() => doFit()} />
        <div className="hidden sm:block">
          <Minimap
            pos={pos}
            bounds={layout.bounds}
            view={view}
            size={size}
            selectedId={selectedId}
            onCenter={(wx, wy) => setView((v) => ({ ...v, x: size.w / 2 - wx * v.k, y: size.h / 2 - wy * v.k }))}
          />
        </div>
      </div>
    </div>
  );
});

const PRESET: Record<WhipSide, ConnectAs> = { top: 'child', bottom: 'parent', left: 'sibling', right: 'partner' };
const SPROUT: Record<WhipSide, AddDirection> = { top: 'parent', bottom: 'child', left: 'sibling', right: 'partner' };

/** Where the vine leaves from: the handle on that side of the card, or the couple's ring. */
function whipStart(
  src: { kind: 'person'; id: Id; side: WhipSide } | { kind: 'union'; id: Id },
  pos: Record<Id, { x: number; y: number }>,
  unions: UnionEdge[],
): { x: number; y: number; dir: [number, number] } | null {
  if (src.kind === 'union') {
    const u = unions.find((e) => e.id === src.id);
    return u ? { x: u.mx, y: u.y, dir: [0, 1] } : null;
  }
  const p = pos[src.id];
  if (!p) return null;
  switch (src.side) {
    case 'top':
      return { x: p.x + CARD_W / 2, y: p.y - 16, dir: [0, -1] };
    case 'bottom':
      return { x: p.x + CARD_W / 2, y: p.y + CARD_H + 16, dir: [0, 1] };
    case 'left':
      return { x: p.x - 16, y: p.y + 62, dir: [-1, 0] };
    default:
      return { x: p.x + CARD_W + 16, y: p.y + 62, dir: [1, 0] };
  }
}

/** The chip next to the pointer that says what letting go will do. */
function whipLabel(src: { kind: 'person'; id: Id; side: WhipSide } | { kind: 'union'; id: Id }, over: Id | null, g: FamilyGraph): string {
  const first = (id: Id) => g.people[id]?.givenName || 'Unnamed';
  if (src.kind === 'union') {
    const u = g.unions[src.id];
    const couple = u ? `${first(u.partners[0])} & ${first(u.partners[1])}` : 'the couple';
    return over ? `${first(over)}: child of ${couple}` : `New child of ${couple}`;
  }
  const word = { top: 'parent', bottom: 'child', left: 'sibling', right: 'partner' }[src.side];
  return over ? `${first(over)}: ${first(src.id)}’s ${word}` : `New ${word} of ${first(src.id)}`;
}

/** The vine that follows the pointer during a pick-whip drag. */
function WhipVine({ from, to, over, label }: { from: { x: number; y: number; dir: [number, number] }; to: { x: number; y: number }; over: boolean; label: string }) {
  const reach = Math.max(50, Math.hypot(to.x - from.x, to.y - from.y) / 2.5);
  const c1x = from.x + from.dir[0] * reach, c1y = from.y + from.dir[1] * reach;
  const d = `M${from.x} ${from.y}C${c1x} ${c1y} ${(c1x + to.x) / 2} ${(c1y + to.y) / 2} ${to.x} ${to.y}`;
  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
        <path d={d} fill="none" stroke="#7FA36B" strokeOpacity=".35" strokeWidth="9" strokeLinecap="round" />
        <path d={d} fill="none" stroke="#3E6B48" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="10 6" className="whip-vine" />
        <circle cx={to.x} cy={to.y} r={over ? 9 : 6} fill={over ? '#3E6B48' : '#F7F6EE'} stroke="#3E6B48" strokeWidth="2.4" />
      </svg>
      <div
        className="pointer-events-none absolute whitespace-nowrap rounded-leaf-sm bg-ink px-2 py-1 text-[12px] font-semibold text-card shadow-lift"
        style={{ left: to.x + 16, top: to.y + 14 }}
      >
        {label}
      </div>
    </>
  );
}

/** Pick-whip point on a couple's ring: drag it to make someone the child of both partners. */
function CoupleHandle({ u, names, about, active, onStart, onOpen }: { u: UnionEdge; names: string; about: string; active: boolean; onStart(e: React.PointerEvent): void; onOpen(el: HTMLElement): void }) {
  return (
    <button
      type="button"
      data-no-pan
      data-couple={u.id}
      aria-label={`${names}: drag to connect or add a child of both`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        onStart(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.detail === 0) onOpen(e.currentTarget);
      }}
      className={`group/c absolute z-10 grid h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full transition-colors ${
        active ? 'bg-moss/20' : 'hover:bg-moss/15 focus-visible:bg-moss/15'
      }`}
      style={{ left: u.mx, top: u.y }}
    >
      <span
        className={`grid h-[22px] w-[22px] place-items-center rounded-full bg-moss text-white shadow-[0_0_0_3px_#E4E9DC] transition-[opacity,transform] duration-200 ${
          active ? 'scale-100 opacity-100' : 'scale-50 opacity-0 group-hover/c:scale-100 group-hover/c:opacity-100 group-focus-visible/c:scale-100 group-focus-visible/c:opacity-100'
        }`}
      >
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 3v11M5.5 10 10 14.5 14.5 10" />
        </svg>
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-[12px_4px_12px_4px] bg-ink px-2.5 py-1.5 text-left text-[12px] font-medium leading-snug text-card opacity-0 shadow-lift transition-opacity group-hover/c:opacity-100 group-focus-visible/c:opacity-100">
        {about}
        <span className="mt-0.5 block text-[11px] font-normal opacity-70">Drag for a child of both</span>
      </span>
    </button>
  );
}

/** The box drawn around a shown group's cards, with its name on a tab. */
/**
 * A faint band behind each generation row, labelled at its bottom-left corner on screen
 * with its number and birth years, so the generations read at a glance.
 */
function GenerationBands({ graph, gen, view }: { graph: FamilyGraph; gen: Record<Id, number>; view: { x: number; y: number; k: number } }) {
  const rows = useMemo(() => {
    const out: { years: number[]; count: number }[] = [];
    for (const [id, r] of Object.entries(gen)) {
      const row = (out[r] ??= { years: [], count: 0 });
      row.count++;
      const y = yearOf(graph.people[id]?.birthDate);
      if (y !== undefined) row.years.push(y);
    }
    return out;
  }, [graph, gen]);
  if (rows.length < 2) return null;
  const PAD = 46;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {rows.map((row, r) => {
        if (!row) return null;
        const top = view.y + (r * ROW_H - PAD) * view.k;
        const h = (CARD_H + PAD * 2) * view.k;
        const lo = row.years.length ? Math.min(...row.years) : undefined, hi = row.years.length ? Math.max(...row.years) : undefined;
        const span = lo === undefined ? '' : lo === hi ? `b. ${lo}` : `b. ${lo}–${hi}`;
        return (
          <div
            key={r}
            className={`absolute inset-x-0 border-y border-dashed border-moss/10 ${r % 2 ? 'bg-moss/[0.035]' : 'bg-fern/[0.06]'}`}
            style={{ top, height: h }}
          >
            {view.k > 0.3 && (
              <span className="label-caps absolute bottom-2 left-3 flex items-baseline gap-2 whitespace-nowrap text-moss/55">
                Generation {r + 1}
                {span && <span className="font-normal normal-case tracking-normal text-ink/40">{span}</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GroupFrame({ name, color, box, editing }: { name: string; color: string; box: { x: number; y: number; w: number; h: number } | null; editing: boolean }) {
  if (!box) return null;
  return (
    <div
      className="pointer-events-none absolute rounded-[36px_12px_36px_12px] transition-[left,top,width,height] duration-500 ease-out"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        border: `2.5px ${editing ? 'dashed' : 'solid'} ${color}`,
        background: `${color}0F`,
        boxShadow: `0 0 0 6px ${color}14`,
      }}
      aria-hidden="true"
    >
      <span
        className="absolute -top-[15px] left-6 whitespace-nowrap rounded-full px-3 py-1 font-display text-[14px] leading-none text-card shadow-specimen"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  );
}
