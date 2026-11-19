import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFuzzy, parseFuzzy } from '../core/dates';
import type { FuzzyDate } from '../core/types';
import { useStore } from '../data/store';
import { EditableText } from './bits';
import { Hint } from './Hint';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
type Precision = 'day' | 'month' | 'year';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A date that can be typed ("1938", "Nov 1938", "2 Nov 1938") or picked from a
 * calendar. Family dates are often partial, so the calendar can also pick just a
 * month or just a year.
 */
export function DateInput({
  id,
  label,
  value,
  onCommit,
  placeholder = 'e.g. 2 Nov 1938',
  hint,
  className = '',
  wrapClassName = '',
}: {
  id: string;
  label: string;
  value?: FuzzyDate;
  onCommit(v?: FuzzyDate): void;
  placeholder?: string;
  hint?: string;
  className?: string;
  wrapClassName?: string;
}) {
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  return (
    <span className={`inline-flex min-w-0 items-center ${wrapClassName}`}>
      <EditableText
        id={id}
        label={label}
        value={formatFuzzy(value)}
        placeholder={placeholder}
        hint={hint}
        className={`min-w-0 ${className}`}
        onCommit={(v) => {
          const parsed = parseFuzzy(v);
          if (v && !parsed) toast(`“${v}” isn’t a date I can read. Try 1938, Nov 1938 or 2 Nov 1938, or use the calendar.`, 'error');
          else onCommit(parsed);
        }}
      />
      <Hint text={`Pick the ${label.toLowerCase()} from a calendar`}>
        <button
          ref={btn}
          type="button"
          aria-label={`Choose ${label.toLowerCase()} from a calendar`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-mist hover:text-moss-deep ${open ? 'bg-mist text-moss-deep' : ''}`}
        >
          <CalendarDays size={14} />
        </button>
      </Hint>
      {open && btn.current && (
        <CalendarPopover
          anchor={btn.current}
          label={label}
          value={value}
          onPick={(v) => {
            onCommit(v);
            setOpen(false);
            btn.current?.focus();
          }}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) btn.current?.focus();
          }}
        />
      )}
    </span>
  );
}

const W = 292;
const H_GUESS = 440;

function CalendarPopover({
  anchor,
  label,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  label: string;
  value?: FuzzyDate;
  onPick(v?: FuzzyDate): void;
  onClose(refocus: boolean): void;
}) {
  const today = new Date();
  const parts = value?.split('-').map((x) => parseInt(x, 10)) ?? [];
  const [selY, selM, selD] = parts;
  const [precision, setPrecision] = useState<Precision>(parts.length === 1 ? 'year' : parts.length === 2 ? 'month' : 'day');
  const [year, setYear] = useState(selY ?? today.getFullYear());
  const [month, setMonth] = useState(selM ? selM - 1 : today.getMonth());
  const [focusDay, setFocusDay] = useState(selY === year && selM && selD ? selD : 1);
  const [yearText, setYearText] = useState(String(year));
  const box = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const yearInput = useRef<HTMLInputElement>(null);
  const wantGridFocus = useRef(false);

  useEffect(() => setYearText(String(year)), [year]);

  // Place under the button, or above it when there isn't room; keep on screen.
  const [place, setPlace] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const H = box.current?.offsetHeight || H_GUESS;
    const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
    const fitsBelow = r.bottom + 6 + H <= window.innerHeight - 8;
    const top = fitsBelow ? r.bottom + 6 : r.top - 6 - H >= 8 ? r.top - 6 - H : window.innerHeight - H - 8;
    setPlace({ left, top: Math.max(8, top) });
  }, [anchor, precision]);

  // Start where the user would act: the chosen day, or the year box when empty.
  useEffect(() => {
    if (!value) {
      yearInput.current?.focus();
      yearInput.current?.select();
    } else {
      box.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wantGridFocus.current) {
      wantGridFocus.current = false;
      grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
    }
  });

  // Close when clicking elsewhere, or when the page underneath scrolls or resizes.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.contains(t)) close.current(false);
    };
    const scroll = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) close.current(false);
    };
    const resize = () => close.current(false);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [anchor]);

  const step = (dir: 1 | -1) => {
    if (precision === 'day') {
      const d = new Date(year, month + dir, 1);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
    } else setYear((y) => y + dir * (precision === 'year' ? 10 : 1));
  };

  const moveDay = (delta: number) => {
    const d = new Date(year, month, focusDay + delta);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setFocusDay(d.getDate());
    wantGridFocus.current = true;
  };

  const commitYearText = (s: string) => {
    setYearText(s);
    const n = parseInt(s, 10);
    if (/^\d{4}$/.test(s) && n >= 1000) setYear(n);
  };

  const navLabel = precision === 'day' ? 'month' : precision === 'month' ? 'year' : 'ten years';
  const decade = Math.floor(year / 10) * 10;
  const isToday = (y: number, m?: number, d?: number) =>
    y === today.getFullYear() && (m === undefined || m === today.getMonth()) && (d === undefined || d === today.getDate());

  const cell = 'grid place-items-center rounded-full font-label transition-colors focus-visible:outline-2';
  const tone = (selected: boolean, current: boolean, muted = false) =>
    selected
      ? 'bg-moss text-card hover:bg-moss-deep'
      : `${muted ? 'text-ink-muted/60' : 'text-ink'} hover:bg-mist ${current ? 'ring-1 ring-fern' : ''}`;

  return createPortal(
    <motion.div
      ref={box}
      role="dialog"
      aria-label={`Choose ${label.toLowerCase()}`}
      data-no-pan
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.14 }}
      className="fixed z-[60] flex flex-col gap-2.5 rounded-leaf-md border border-rule bg-paper p-3 shadow-lift"
      style={{ left: place.left, top: place.top, width: W }}
      onKeyDown={(e) => {
        // Keep Escape here: on the canvas it would also close the profile drawer.
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <span className="label-caps">{label}</span>
        <button type="button" onClick={() => onClose(true)} className="grid h-7 w-7 place-items-center rounded-full text-ink-muted hover:bg-mist" aria-label="Close calendar">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 rounded-leaf-sm bg-mist p-0.5" role="group" aria-label="How much of the date do you know?">
        {(
          [
            ['day', 'Exact day'],
            ['month', 'Month'],
            ['year', 'Year only'],
          ] as const
        ).map(([p, text]) => (
          <button
            key={p}
            type="button"
            aria-pressed={precision === p}
            onClick={() => setPrecision(p)}
            className={`rounded-[9px] py-1 text-[12px] font-semibold transition-colors ${
              precision === p ? 'bg-card text-moss-deep shadow-specimen' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => step(-1)} className="grid h-8 w-8 place-items-center rounded-full text-moss-deep hover:bg-mist" aria-label={`Previous ${navLabel}`}>
          <ChevronLeft size={16} />
        </button>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          {precision === 'day' && (
            <select className="select !text-[12.5px]" aria-label="Month" value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))}>
              {MONTHS_LONG.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <Hint text="Type a year to jump straight to it">
            <input
              ref={yearInput}
              aria-label="Year"
              inputMode="numeric"
              maxLength={4}
              value={yearText}
              onChange={(e) => commitYearText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => setYearText(String(year))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') (e.preventDefault(), setYear((y) => y + 1));
                if (e.key === 'ArrowDown') (e.preventDefault(), setYear((y) => y - 1));
                if (e.key === 'Enter' && precision === 'year' && /^\d{4}$/.test(yearText)) onPick(yearText);
              }}
              className="w-[62px] rounded-leaf-sm border border-rule bg-card px-2 py-1 text-center font-label text-[13px] text-ink focus:border-moss focus:outline-none"
            />
          </Hint>
          {precision === 'year' && <span className="font-label text-[11px] text-ink-muted">{decade}s</span>}
        </div>
        <button type="button" onClick={() => step(1)} className="grid h-8 w-8 place-items-center rounded-full text-moss-deep hover:bg-mist" aria-label={`Next ${navLabel}`}>
          <ChevronRight size={16} />
        </button>
      </div>

      {precision === 'day' && (
        <div>
          <div className="grid grid-cols-7 pb-1" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d} className="text-center text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                {d}
              </span>
            ))}
          </div>
          <div
            ref={grid}
            className="grid grid-cols-7 gap-y-0.5"
            onKeyDown={(e) => {
              const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
              if (delta) {
                e.preventDefault();
                moveDay(delta);
              }
            }}
          >
            {Array.from({ length: (new Date(year, month, 1).getDay() + 6) % 7 }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1).map((d) => {
              const selected = selY === year && selM === month + 1 && selD === d;
              return (
                <button
                  key={d}
                  type="button"
                  data-day={d}
                  data-selected={selected}
                  tabIndex={d === Math.min(focusDay, new Date(year, month + 1, 0).getDate()) ? 0 : -1}
                  aria-label={`${d} ${MONTHS_LONG[month]} ${year}`}
                  aria-pressed={selected}
                  onClick={() => onPick(`${year}-${pad(month + 1)}-${pad(d)}`)}
                  className={`${cell} mx-auto h-8 w-8 text-[12.5px] ${tone(selected, isToday(year, month, d))}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {precision === 'month' && (
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS_SHORT.map((m, i) => {
            const selected = selY === year && selM === i + 1 && !selD;
            return (
              <button
                key={m}
                type="button"
                data-selected={selected}
                aria-label={`${MONTHS_LONG[i]} ${year}`}
                aria-pressed={selected}
                onClick={() => onPick(`${year}-${pad(i + 1)}`)}
                className={`${cell} h-11 rounded-leaf-sm text-[13px] ${tone(selected, isToday(year, i))}`}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}

      {precision === 'year' && (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }, (_, i) => decade - 1 + i).map((y) => {
            const selected = selY === y && parts.length === 1;
            return (
              <button
                key={y}
                type="button"
                data-selected={selected}
                aria-pressed={selected}
                onClick={() => onPick(String(y))}
                className={`${cell} h-11 rounded-leaf-sm text-[13px] ${tone(selected, isToday(y), y < decade || y > decade + 9)}`}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11.5px] leading-snug text-ink-muted">
        {precision === 'day'
          ? 'Not sure of the day? Choose Month or Year only.'
          : precision === 'month'
            ? 'Saves the month and year, e.g. “Nov 1938”.'
            : 'Saves just the year. Type one above to jump to any decade.'}
      </p>

      <div className="flex items-center justify-between border-t border-rule pt-2">
        <button type="button" className="text-[12px] font-semibold text-petal hover:underline disabled:opacity-40" disabled={!value} onClick={() => onPick(undefined)}>
          Clear date
        </button>
        <button
          type="button"
          className="text-[12px] font-semibold text-moss-deep hover:underline"
          onClick={() => {
            const y = today.getFullYear(), m = pad(today.getMonth() + 1), d = pad(today.getDate());
            onPick(precision === 'day' ? `${y}-${m}-${d}` : precision === 'month' ? `${y}-${m}` : String(y));
          }}
        >
          {precision === 'day' ? 'Today' : precision === 'month' ? 'This month' : 'This year'}
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}
