import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { Hint } from './Hint';

/** Text input that saves on blur or Enter, and reverts on Escape. */
export function EditableText({
  id,
  value,
  onCommit,
  placeholder,
  className = '',
  autoFocusSelect = false,
  label,
  hint,
}: {
  id: string;
  value: string;
  onCommit(v: string): void;
  placeholder?: string;
  className?: string;
  autoFocusSelect?: boolean;
  label: string;
  /** Short explanation shown as a tooltip on hover / focus. */
  hint?: string;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (autoFocusSelect && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocusSelect]);
  return (
    <Hint text={hint}>
    <input
      ref={ref}
      id={id}
      aria-label={label}
      className={`field ${className}`}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
    </Hint>
  );
}

/** Multiline text that grows with its content and saves on blur. */
export function EditableArea({
  id,
  value,
  onCommit,
  placeholder,
  label,
  hint,
}: {
  id: string;
  value: string;
  onCommit(v: string): void;
  placeholder?: string;
  label: string;
  hint?: string;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 4 + 'px';
  }, [v]);
  return (
    <Hint text={hint}>
    <textarea
      ref={ref}
      id={id}
      aria-label={label}
      rows={3}
      className="field resize-none py-2 text-[15px] leading-[1.62] text-ink"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v.trim())}
    />
    </Hint>
  );
}

/** "Are you sure?" built into the page: first click arms, second click confirms. */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  className = '',
  ariaLabel,
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm(): void;
  className?: string;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      aria-label={armed ? confirmLabel : ariaLabel}
      className={`${className} ${armed ? '!border-petal !bg-petal !text-card' : ''}`}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            className={`pointer-events-auto flex items-center gap-3 rounded-leaf-sm px-4 py-2 text-sm font-semibold shadow-lift ${
              t.tone === 'error' ? 'bg-petal text-card' : 'bg-moss text-card'
            }`}
          >
            {t.text}
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Drop zone wrapper: highlights while files are dragged over. */
export function DropZone({
  onFiles,
  accept,
  children,
  className = '',
  activeClass = 'ring-2 ring-fern ring-offset-2 ring-offset-paper',
}: {
  onFiles(files: File[]): void;
  accept: (f: File) => boolean;
  children: ReactNode;
  className?: string;
  activeClass?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${className} ${over ? activeClass : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = [...e.dataTransfer.files].filter(accept);
        if (files.length) onFiles(files);
      }}
    >
      {children}
    </div>
  );
}
