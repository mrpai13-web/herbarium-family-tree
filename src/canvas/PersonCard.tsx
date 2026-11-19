import { motion } from 'framer-motion';
import { memo } from 'react';
import { lifespan, fullName } from '../core/dates';
import { CARD_H, CARD_W } from '../core/layout';
import type { Person } from '../core/types';

/** Which edge of the card a pick-whip leaves from; it sets the direction of the relationship. */
export type WhipSide = 'top' | 'bottom' | 'left' | 'right';

const SIDES: { side: WhipSide; label: string; verb: string; cls: string; tip: string }[] = [
  { side: 'top', label: 'Parent', verb: 'a parent (a generation above)', cls: 'left-1/2 -top-[16px] -ml-[16px]', tip: 'bottom-full mb-1 left-1/2 -translate-x-1/2' },
  { side: 'bottom', label: 'Child', verb: 'a child (a generation below)', cls: 'left-1/2 -bottom-[16px] -ml-[16px]', tip: 'top-full mt-1 left-1/2 -translate-x-1/2' },
  { side: 'left', label: 'Sibling', verb: 'a sibling (same generation)', cls: '-left-[16px] top-[46px]', tip: 'top-full mt-1 left-1/2 -translate-x-1/2' },
  { side: 'right', label: 'Partner', verb: 'a partner (same generation)', cls: '-right-[16px] top-[46px]', tip: 'top-full mt-1 left-1/2 -translate-x-1/2' },
];
import { Portrait } from '../ui/Portrait';

interface Props {
  person: Person;
  x: number;
  y: number;
  note?: string;
  selected: boolean;
  dimmed: boolean;
  isFresh: boolean;
  /** When a group is being edited: its colour, and whether this person is in it. */
  groupColor?: string;
  groupMember?: boolean;
  /** This card is where a pick-whip drag would land. */
  whipTarget: boolean;
  /** A pick-whip drag started from this card. */
  whipSource: boolean;
  onOpen(id: string): void;
  onWhipStart(id: string, side: WhipSide, e: React.PointerEvent): void;
  /** Keyboard (or a plain click) on a whip handle: open the connect menu. */
  onWhipOpen(id: string, side: WhipSide, el: HTMLElement): void;
}



/** A specimen card taped to the sheet. Hover or focus reveals the four sprout handles. */
export const PersonCard = memo(function PersonCard({
  person, x, y, note, selected, dimmed, isFresh, whipTarget, whipSource, onOpen, onWhipStart, onWhipOpen, groupColor, groupMember,
}: Props) {
  const editingGroup = groupColor !== undefined;
  const audio = person.audioIds.length;
  return (
    <motion.div
      className="group absolute hover:z-20 focus-within:z-20"
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
      initial={isFresh ? { opacity: 0, scale: 0.5, rotate: -8, y: -14 } : false}
      animate={{ opacity: dimmed ? 0.35 : 1, scale: 1, rotate: 0, y: 0 }}
      transition={isFresh ? { delay: 0.45, type: 'spring', stiffness: 260, damping: 17 } : { duration: 0.2 }}
    >
      <button
        type="button"
        data-person-id={person.id}
        aria-keyshortcuts="Delete"
        onClick={() => onOpen(person.id)}
        aria-label={`${fullName(person)}${lifespan(person) ? ', ' + lifespan(person) : ''}${audio ? `, ${audio} voice memor${audio > 1 ? 'ies' : 'y'}` : ''}. Open profile`}
        className={[
          'relative flex h-full w-full flex-col items-center rounded-leaf px-2 pb-2 pt-4 text-center transition-[transform,box-shadow,border-color] duration-200',
          'group-hover:-translate-y-0.5 group-hover:shadow-lift',
          person.placeholder ? 'border border-dashed border-ink-muted/50 bg-card/70' : 'border border-rule bg-card shadow-specimen',
          selected ? '!border-moss ring-[3px] ring-fern/40' : '',
          whipTarget ? '!border-moss -translate-y-1 shadow-lift ring-4 ring-fern/60' : '',
        ].join(' ')}
      >
        <span className="tape" />
        {editingGroup && (
          <span
            className="absolute -left-2.5 -top-2.5 z-10 grid h-7 w-7 place-items-center rounded-full text-[15px] font-bold shadow-specimen"
            style={groupMember ? { background: groupColor, color: '#F7F6EE' } : { background: '#F7F6EE', color: groupColor, border: `2px dashed ${groupColor}` }}
            aria-hidden="true"
          >
            {groupMember ? '✓' : '+'}
          </span>
        )}
        <Portrait person={person} size={62} />
        <span className="mt-2 block w-full truncate font-display text-[15px] leading-tight text-ink">{person.givenName || 'Unnamed'}</span>
        <span className="mt-0.5 block w-full truncate text-[9px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
          {person.surname || ' '}
        </span>
        <span className="mt-1.5 block font-label text-[11px] tabular-nums text-ink-soft">{lifespan(person) || ' '}</span>
        {note && <span className="mt-0.5 block w-full truncate font-label text-[10.5px] italic text-[#7A5C3E]">{note}</span>}
        {audio > 0 && (
          <span
            className="absolute right-2.5 top-2.5 flex h-[18px] items-center gap-[2px] rounded-leaf-sm bg-moss px-1.5 text-[10px] font-semibold text-card"
            aria-hidden="true"
            title={`${audio} voice memor${audio > 1 ? 'ies' : 'y'}`}
          >
            {[5, 10, 7, 11].map((h, i) => (
              <i key={i} className="block w-[2px] rounded-sm bg-current" style={{ height: h }} />
            ))}
            <em className="ml-[3px] not-italic">{audio}</em>
          </span>
        )}
      </button>

      {/* Pick whips on every side. Up = a parent, down = a child, left = a sibling, right = a partner.
          Drag onto a card to connect, onto empty sheet to add someone new, or click for a menu. */}
      {!editingGroup && SIDES.map((h) => (
        <button
          key={h.side}
          type="button"
          data-no-pan
          data-whip={h.side}
          data-card-of={person.id}
          aria-label={`${fullName(person)}: drag to connect or add ${h.verb}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            onWhipStart(person.id, h.side, e);
          }}
          onClick={(e) => {
            e.stopPropagation();
            // Pointer clicks are handled when the drag ends; this is the keyboard path.
            if (e.detail === 0) onWhipOpen(person.id, h.side, e.currentTarget);
          }}
          className={`absolute z-10 grid h-[32px] w-[32px] touch-none place-items-center rounded-full bg-moss text-white shadow-[0_0_0_3px_#E4E9DC] transition-[opacity,transform] duration-200 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] hover:scale-110 hover:bg-moss-deep focus-visible:scale-100 focus-visible:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100 group-hover:scale-100 group-hover:opacity-100 ${h.cls} ${
            whipSource ? 'pointer-events-none opacity-0' : selected ? 'scale-100 opacity-100' : 'pointer-events-none scale-50 opacity-0 group-focus-within:pointer-events-auto group-hover:pointer-events-auto focus-visible:pointer-events-auto'
          } cursor-grab [&:hover>span]:opacity-100 [&:focus-visible>span]:opacity-100`}
        >
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden="true"
            style={{ transform: `rotate(${{ top: -90, bottom: 90, left: 180, right: 0 }[h.side]}deg)` }}
          >
            <path d="M2.5 13.5C5 13.5 6 6.5 10 6.5S14 10 17 10" />
            <path d="M14.2 7.2 17 10l-2.8 2.8" />
          </svg>
          <span
            className={`pointer-events-none absolute whitespace-nowrap rounded-leaf-sm border border-rule bg-card px-1.5 py-0.5 text-[11px] font-semibold text-ink opacity-0 transition-opacity ${h.tip}`}
          >
            {h.label}
          </span>
        </button>
      ))}
    </motion.div>
  );
});
