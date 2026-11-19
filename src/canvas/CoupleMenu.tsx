import { motion } from 'framer-motion';
import { Link2, Plus, Unlink, X } from 'lucide-react';
import { describeUnion } from '../core/describe';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fullName, lifespan } from '../core/dates';
import { coupleChildProblem } from '../core/relations';
import type { FamilyGraph, Id, ParentKind } from '../core/types';
import { useStore } from '../data/store';

export interface CoupleDrop {
  unionId: Id;
  /** Dropped on this person; absent when the couple's handle was clicked. */
  to?: Id;
  x: number;
  y: number;
}

const KINDS: { v: ParentKind; label: string }[] = [
  { v: 'biological', label: 'by birth' },
  { v: 'adoptive', label: 'adopted' },
  { v: 'step', label: 'step' },
  { v: 'foster', label: 'foster' },
];
const W = 320;

/** End of a pick-whip drag from a couple's link: make someone the child of both partners. */
export function CoupleMenu({ drop, graph, onClose }: { drop: CoupleDrop; graph: FamilyGraph; onClose(): void }) {
  const connectCoupleChild = useStore((s) => s.connectCoupleChild);
  const sproutCoupleChild = useStore((s) => s.sproutCoupleChild);
  const toast = useStore((s) => s.toast);
  const breakConnection = useStore((s) => s.breakConnection);
  const union = graph.unions[drop.unionId];
  const [a, b] = union ? union.partners.map((p) => graph.people[p]) : [];
  const [childId, setChildId] = useState<Id>(drop.to ?? '');
  const [kind, setKind] = useState<ParentKind>('biological');
  const child = childId ? graph.people[childId] : undefined;
  const problem = childId ? coupleChildProblem(graph, childId, drop.unionId) : null;
  const others = useMemo(
    () =>
      Object.values(graph.people)
        .filter((p) => !union?.partners.includes(p.id))
        .sort((x, y) => fullName(x).localeCompare(fullName(y))),
    [graph.people, union],
  );

  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: drop.x, top: drop.y });
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 220;
    setPlace({
      left: Math.min(Math.max(8, drop.x - W / 2), window.innerWidth - W - 8),
      top: Math.max(8, Math.min(window.innerHeight - h - 8, drop.y + 14 + h > window.innerHeight - 8 ? drop.y - 14 - h : drop.y + 14)),
    });
  }, [drop.x, drop.y, childId]);

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
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true));
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  if (!union || !a || !b) return null;
  const couple = `${a.givenName || 'Unnamed'} and ${b.givenName || 'Unnamed'}`;

  return createPortal(
    <motion.div
      ref={box}
      role="dialog"
      aria-label={`Child of ${fullName(a)} and ${fullName(b)}`}
      data-no-pan
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="fixed z-[60] flex flex-col gap-3 rounded-leaf-md border border-rule bg-paper p-3.5 shadow-lift"
      style={{ left: place.left, top: place.top, width: W }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps truncate">Child of {couple}</span>
        <button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-mist" aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <form
        className="flex flex-col gap-2.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!childId || problem) return;
          if (await connectCoupleChild(childId, drop.unionId, kind)) {
            toast(`${fullName(child!)} is now the child of ${couple}.`);
            onClose();
          }
        }}
      >
        {!drop.to && (
          <select
            className="select !py-1.5 !text-[12.5px]"
            aria-label="Person to make their child"
            value={childId}
            data-autofocus
            onChange={(e) => setChildId(e.target.value)}
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
        <p className="text-[14px] leading-relaxed text-ink">
          <span className={child ? 'font-display' : 'italic text-ink-muted'}>{child ? child.givenName || 'Unnamed' : 'Someone'}</span>{' '}
          <span className="text-ink-soft">is the child of</span> <span className="font-display">{couple}</span>
        </p>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          Kind
          <select
            className="select !py-1 !text-[12px]"
            aria-label="Kind of child"
            value={kind}
            data-autofocus={drop.to ? true : undefined}
            onChange={(e) => setKind(e.target.value as ParentKind)}
          >
            {KINDS.map((k) => (
              <option key={k.v} value={k.v}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {problem && (
          <p className="text-[12px] leading-snug text-petal" role="alert">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn !py-1.5 !text-[12.5px]" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-solid !py-1.5 !text-[12.5px]" disabled={!childId || !!problem}>
            <Link2 size={13} /> Connect
          </button>
        </div>
      </form>

      {!drop.to && (
        <div className="flex flex-col gap-1.5 border-t border-rule pt-2.5">
          <button
            type="button"
            className="btn w-full justify-center !py-1.5 !text-[12.5px]"
            onClick={() => {
              onClose();
              void sproutCoupleChild(drop.unionId);
            }}
          >
            <Plus size={13} /> Add a new child of {couple}
          </button>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-muted">{describeUnion(graph, drop.unionId)}.</p>
          <button
            type="button"
            className="btn w-full justify-center !py-1.5 !text-[12.5px] !text-petal hover:!bg-petal/10"
            onClick={async () => {
              onClose();
              await breakConnection([], [drop.unionId], `Break partnership of ${couple}`);
              toast(`Partnership of ${couple} broken. Ctrl+Z undoes it.`);
            }}
          >
            <Unlink size={13} /> Break this partnership
          </button>
        </div>
      )}
    </motion.div>,
    document.body,
  );
}
