import { motion } from 'framer-motion';
import { Link2, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fullName, lifespan } from '../core/dates';
import { connectProblem, parentLinksOf, type ConnectAs } from '../core/relations';
import type { AddDirection, FamilyGraph, Id, ParentKind, UnionKind, UnionStatus } from '../core/types';
import { useStore } from '../data/store';

export interface WhipDrop {
  from: Id;
  /** Dropped on this person; absent when opened by click / keyboard or dropped on empty space. */
  to?: Id;
  /** Screen position to open at. */
  x: number;
  y: number;
  /** Dropped on empty sheet: lead with "add a new relative". */
  onEmpty?: boolean;
  /** The relationship the drag direction asked for (up = child of, down = parent of, left = sibling, right = partner). */
  preset?: ConnectAs;
}

const RELATIONS: { v: ConnectAs; label: string }[] = [
  { v: 'parent', label: 'parent' },
  { v: 'child', label: 'child' },
  { v: 'partner', label: 'partner' },
  { v: 'sibling', label: 'sibling' },
];
const PARENT_KINDS: { v: ParentKind; label: string }[] = [
  { v: 'biological', label: 'by birth' },
  { v: 'adoptive', label: 'adoptive' },
  { v: 'step', label: 'step' },
  { v: 'foster', label: 'foster' },
];
const ADD: { dir: AddDirection; label: string }[] = [
  { dir: 'parent', label: 'Parent' },
  { dir: 'partner', label: 'Partner' },
  { dir: 'child', label: 'Child' },
  { dir: 'sibling', label: 'Sibling' },
];
const W = 330;

/**
 * Where a pick-whip drag ends: choose how the two people are related, or (dropped on
 * empty sheet) create a brand-new relative.
 */
export function WhipMenu({ drop, graph, gen, onClose }: { drop: WhipDrop; graph: FamilyGraph; gen: Record<Id, number>; onClose(): void }) {
  const connectPeople = useStore((s) => s.connectPeople);
  const sprout = useStore((s) => s.sprout);
  const toast = useStore((s) => s.toast);
  const from = graph.people[drop.from];
  const [toId, setToId] = useState<Id>(drop.to ?? '');
  const to = toId ? graph.people[toId] : undefined;

  // Best first guess from where the cards sit: the higher row is the parent.
  const guess = (t: Id | undefined): ConnectAs => {
    if (drop.preset) return drop.preset;
    if (!t || gen[t] === undefined || gen[drop.from] === undefined) return 'parent';
    return gen[drop.from] < gen[t] ? 'parent' : gen[drop.from] > gen[t] ? 'child' : 'partner';
  };
  const [as, setAs] = useState<ConnectAs>(guess(drop.to));
  const [parentKind, setParentKind] = useState<ParentKind | ''>('');
  const [unionKind, setUnionKind] = useState<UnionKind>('married');
  const [unionStatus, setUnionStatus] = useState<UnionStatus>('current');

  // "from is to's <as>" is connect(to, from, as).
  const problem = toId ? connectProblem(graph, toId, drop.from, as) : null;
  const child = as === 'parent' ? toId : as === 'child' ? drop.from : '';
  const defaultKind: ParentKind =
    child && parentLinksOf(graph, child).filter((l) => l.kind === 'biological').length >= 2 ? 'step' : 'biological';

  const others = useMemo(
    () => Object.values(graph.people).filter((p) => p.id !== drop.from).sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [graph.people, drop.from],
  );

  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: drop.x, top: drop.y });
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 260;
    setPlace({
      left: Math.min(Math.max(8, drop.x - W / 2), window.innerWidth - W - 8),
      top: Math.max(8, Math.min(window.innerHeight - h - 8, drop.y + 14 + h > window.innerHeight - 8 ? drop.y - 14 - h : drop.y + 14)),
    });
  }, [drop.x, drop.y, as, toId]);

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close.current();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    // Defer so the pointerup that opened the menu doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true));
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  if (!from) return null;
  const fromName = from.givenName || 'Unnamed';
  const toName = to ? to.givenName || 'Unnamed' : 'someone';

  const submit = async () => {
    if (!toId || problem) return;
    const ok = await connectPeople(toId, drop.from, as, {
      parentKind: as === 'parent' || as === 'child' ? parentKind || defaultKind : undefined,
      unionKind,
      unionStatus,
    });
    if (ok) {
      toast(`${fullName(from)} is now ${to ? fullName(to) : ''}’s ${as}.`);
      onClose();
    }
  };

  const addRow = (
    <div className="grid grid-cols-4 gap-1.5">
      {ADD.map((a, i) => (
        <button
          key={a.dir}
          type="button"
          data-autofocus={drop.onEmpty && i === 0 ? true : undefined}
          className="btn justify-center !gap-1 !px-1 !py-1.5 !text-[12px]"
          onClick={() => {
            onClose();
            void sprout(drop.from, a.dir);
          }}
        >
          <Plus size={12} /> {a.label}
        </button>
      ))}
    </div>
  );

  return createPortal(
    <motion.div
      ref={box}
      role="dialog"
      aria-label={to ? `Connect ${fullName(from)} and ${fullName(to)}` : `Connect ${fullName(from)}`}
      data-no-pan
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="fixed z-[60] flex flex-col gap-3 rounded-leaf-md border border-rule bg-paper p-3.5 shadow-lift"
      style={{ left: place.left, top: place.top, width: W }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps truncate">{to ? 'Connect' : drop.onEmpty ? `Add a relative of ${fromName}` : `Connect ${fromName}`}</span>
        <button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-mist" aria-label="Close">
          <X size={14} />
        </button>
      </div>

      {drop.onEmpty && (
        <>
          {addRow}
          <p className="-mb-1 text-[11.5px] text-ink-muted">or connect {fromName} to someone already on the tree:</p>
        </>
      )}

      <form
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!drop.to && (
          <select
            className="select !py-1.5 !text-[12.5px]"
            aria-label="Person to connect to"
            value={toId}
            data-autofocus={!drop.onEmpty || undefined}
            onChange={(e) => {
              setToId(e.target.value);
              setAs(guess(e.target.value || undefined));
            }}
          >
            <option value="">Choose a person…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {fullName(p)}
                {lifespan(p) ? ` (${lifespan(p)})` : ''}
              </option>
            ))}
          </select>
        )}

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-relaxed text-ink">
          <span className="font-display">{fromName}</span>
          <span className="text-ink-soft">is</span>
          <span>
            <span className={to ? 'font-display' : 'italic text-ink-muted'}>{toName}</span>
            <span className="text-ink-soft">’s</span>
          </span>
          <select
            className="select !py-1 !text-[12.5px]"
            aria-label="Relationship"
            value={as}
            data-autofocus={drop.to ? true : undefined}
            onChange={(e) => setAs(e.target.value as ConnectAs)}
          >
            {RELATIONS.map((r) => (
              <option key={r.v} value={r.v}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {(as === 'parent' || as === 'child') && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            Kind
            <select
              className="select !py-1 !text-[12px]"
              aria-label="Kind of parent and child link"
              value={parentKind || defaultKind}
              onChange={(e) => setParentKind(e.target.value as ParentKind)}
            >
              {PARENT_KINDS.map((k) => (
                <option key={k.v} value={k.v}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {as === 'partner' && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
            <select className="select !py-1 !text-[12px]" aria-label="Married or partners" value={unionKind} onChange={(e) => setUnionKind(e.target.value as UnionKind)}>
              <option value="married">Married</option>
              <option value="partners">Partners</option>
            </select>
            <select className="select !py-1 !text-[12px]" aria-label="Status" value={unionStatus} onChange={(e) => setUnionStatus(e.target.value as UnionStatus)}>
              <option value="current">Together</option>
              <option value="widowed">Widowed</option>
              <option value="separated">Separated</option>
              <option value="divorced">Divorced</option>
            </select>
          </div>
        )}
        {as === 'sibling' && (
          <p className="text-[11.5px] leading-snug text-ink-muted">
            Siblings share parents, so the one without recorded parents gets the other’s. If neither has any, an “Unknown parent” card holds them both.
          </p>
        )}

        {problem && (
          <p className="text-[12px] leading-snug text-petal" role="alert">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn !py-1.5 !text-[12.5px]" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-solid !py-1.5 !text-[12.5px]" disabled={!toId || !!problem}>
            <Link2 size={13} /> Connect
          </button>
        </div>
      </form>

      {!drop.onEmpty && !drop.to && (
        <div className="border-t border-rule pt-2.5">
          <p className="mb-1.5 text-[11.5px] text-ink-muted">or add a new relative of {fromName}:</p>
          {addRow}
        </div>
      )}
    </motion.div>,
    document.body,
  );
}
