import { motion } from 'framer-motion';
import { Unlink, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { describeParentLine, describeUnion } from '../core/describe';
import type { RootEdge, UnionEdge } from '../core/paths';
import type { FamilyGraph, Id } from '../core/types';
import { useStore } from '../data/store';

/** A line on the tree: a parent → child root (possibly shared by a couple) or a partnership. */
export type EdgeRef = { kind: 'root'; id: string } | { kind: 'union'; id: Id };
export const edgeKey = (e: EdgeRef) => `${e.kind}:${e.id}`;

interface Resolved {
  text: string;
  /** Ways to break it: one per parent for a couple's root, plus "both". */
  actions: { label: string; linkIds: Id[]; unionIds: Id[]; undoLabel: string }[];
  d: string;
}

function resolve(g: FamilyGraph, e: EdgeRef, roots: RootEdge[], unions: UnionEdge[]): Resolved | null {
  const first = (id: Id) => g.people[id]?.givenName || 'Unnamed';
  if (e.kind === 'union') {
    const u = unions.find((x) => x.id === e.id);
    if (!u || !g.unions[e.id]) return null;
    const pair = `${first(u.partners[0])} and ${first(u.partners[1])}`;
    return {
      text: describeUnion(g, e.id),
      d: u.d,
      actions: [{ label: 'Break this partnership', linkIds: [], unionIds: [e.id], undoLabel: `Break partnership of ${pair}` }],
    };
  }
  const r = roots.find((x) => x.id === e.id);
  if (!r) return null;
  const child = first(r.childId);
  const actions =
    r.parentIds.length > 1
      ? [
          ...r.parentIds.map((p, i) => ({
            label: `Unlink from ${first(p)}`,
            linkIds: [r.linkIds[i]],
            unionIds: [],
            undoLabel: `Unlink ${child} from ${first(p)}`,
          })),
          { label: 'Unlink from both', linkIds: r.linkIds, unionIds: [], undoLabel: `Unlink ${child} from ${r.parentIds.map(first).join(' and ')}` },
        ]
      : [{ label: 'Break this connection', linkIds: r.linkIds, unionIds: [], undoLabel: `Unlink ${child} from ${first(r.parentIds[0])}` }];
  return { text: describeParentLine(g, r.childId, r.parentIds, r.kind), d: r.d, actions };
}

/**
 * Invisible wide strokes over every line so it can be hovered (shows how the two are
 * related) and clicked (selects it, with buttons to break the connection).
 * Delete / Backspace on a selected line asks, then breaks it; Ctrl+Z undoes.
 */
export function EdgeLayer({
  graph,
  roots,
  unions,
  selected,
  onSelect,
}: {
  graph: FamilyGraph;
  roots: RootEdge[];
  unions: UnionEdge[];
  selected: (EdgeRef & { x: number; y: number }) | null;
  onSelect(e: (EdgeRef & { x: number; y: number }) | null): void;
}) {
  const [hover, setHover] = useState<(EdgeRef & { x: number; y: number }) | null>(null);
  const hovered = hover && resolve(graph, hover, roots, unions);
  const sel = selected && resolve(graph, selected, roots, unions);

  // The selected line went away (unlinked, undone, person deleted): drop the selection.
  useEffect(() => {
    if (selected && !sel) onSelect(null);
  }, [selected, sel, onSelect]);

  const hit = (e: EdgeRef, d: string) => (
    <path
      key={edgeKey(e)}
      d={d}
      fill="none"
      stroke="transparent"
      strokeWidth={16}
      strokeLinecap="round"
      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
      data-edge={edgeKey(e)}
      onPointerMove={(ev) => setHover({ ...e, x: ev.clientX, y: ev.clientY })}
      onPointerLeave={() => setHover(null)}
      onClick={(ev) => {
        ev.stopPropagation();
        setHover(null);
        onSelect({ ...e, x: ev.clientX, y: ev.clientY });
      }}
    />
  );

  const glow = (d: string, strong: boolean) => (
    <path d={d} fill="none" stroke="#7FA36B" strokeOpacity={strong ? 0.55 : 0.35} strokeWidth={strong ? 12 : 9} strokeLinecap="round" className="pointer-events-none" />
  );

  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
        {hovered && (!selected || edgeKey(hover!) !== edgeKey(selected)) && glow(hovered.d, false)}
        {sel && glow(sel.d, true)}
        {roots.map((r) => hit({ kind: 'root', id: r.id }, r.d))}
        {unions.map((u) => hit({ kind: 'union', id: u.id }, u.d))}
      </svg>
      {hovered &&
        !selected &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[70] max-w-[280px] rounded-[12px_4px_12px_4px] bg-ink px-3 py-2 text-[12.5px] font-medium leading-snug text-card shadow-lift"
            style={{ left: Math.min(hover!.x + 14, window.innerWidth - 290), top: hover!.y + 16 }}
            role="tooltip"
          >
            {hovered.text}
            <span className="mt-0.5 block text-[11px] font-normal opacity-70">Click to select</span>
          </div>,
          document.body,
        )}
      {selected && sel && <EdgeMenu at={selected} info={sel} onClose={() => onSelect(null)} />}
    </>
  );
}

function EdgeMenu({ at, info, onClose }: { at: { x: number; y: number }; info: Resolved; onClose(): void }) {
  const breakConnection = useStore((s) => s.breakConnection);
  const ask = useStore((s) => s.ask);
  const toast = useStore((s) => s.toast);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: at.x, top: at.y });
  const W = 300;
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 140;
    setPlace({
      left: Math.min(Math.max(8, at.x - W / 2), window.innerWidth - W - 8),
      top: Math.max(8, Math.min(window.innerHeight - h - 8, at.y + 14 + h > window.innerHeight - 8 ? at.y - 14 - h : at.y + 14)),
    });
  }, [at.x, at.y]);

  const run = async (a: Resolved['actions'][number]) => {
    onClose();
    await breakConnection(a.linkIds, a.unionIds, a.undoLabel);
    toast(`${a.undoLabel}. Ctrl+Z undoes it.`);
  };

  const latest = useRef({ info, onClose, run });
  latest.current = { info, onClose, run };
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button[data-first]')?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      // Clicking another line re-selects; anywhere else closes.
      if (!box.current?.contains(t) && !t.closest?.('[data-edge]')) latest.current.onClose();
    };
    // Capture phase, so Delete here never reaches the "delete the selected person" shortcut.
    const key = async (e: KeyboardEvent) => {
      if (useStore.getState().asking) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        latest.current.onClose();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('input, textarea, select')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const { info: inf, run: go } = latest.current;
        const all = inf.actions[inf.actions.length - 1];
        const ok = await ask({
          title: 'Break this connection?',
          body: `${inf.text}. This removes the line between them; both people stay on the tree. You can undo it with Ctrl+Z.`,
          confirmLabel: 'Break connection',
          danger: true,
        });
        if (ok) void go(all);
      }
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true));
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [ask]);

  return createPortal(
    <motion.div
      ref={box}
      role="dialog"
      aria-label="Selected connection"
      data-no-pan
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="fixed z-[60] flex flex-col gap-2.5 rounded-leaf-md border border-rule bg-paper p-3.5 shadow-lift"
      style={{ left: place.left, top: place.top, width: W }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-[15px] leading-snug text-ink">{info.text}</p>
        <button type="button" onClick={onClose} className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-mist" aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {info.actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            data-first={i === 0 || undefined}
            className="btn justify-center !py-1.5 !text-[12.5px] !text-petal hover:!bg-petal/10"
            onClick={() => void run(a)}
          >
            <Unlink size={13} /> {a.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-muted">Both people stay on the tree. Press Delete to break it, Esc to close, Ctrl+Z to undo.</p>
    </motion.div>,
    document.body,
  );
}
