import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useStore } from '../data/store';

/**
 * The app's "are you sure?" dialog, driven by `useStore().ask()`.
 * Cancel has focus, so Enter or Space on a stray keypress never deletes anything.
 */
export function ConfirmDialog() {
  const asking = useStore((s) => s.asking);
  const cancel = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!asking) return;
    restore.current = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    // While open, keys belong to the dialog: Escape cancels, nothing reaches the canvas.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        asking.resolve(false);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') e.preventDefault();
      if (e.key === 'Tab') {
        const box = document.getElementById('confirm-dialog');
        const items = box ? [...box.querySelectorAll<HTMLElement>('button')] : [];
        if (items.length) {
          const i = items.indexOf(document.activeElement as HTMLElement);
          e.preventDefault();
          items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const el = restore.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [asking]);

  return (
    <AnimatePresence>
      {asking && (
        <motion.div
          key="ask"
          className="fixed inset-0 z-[80] grid place-items-center bg-ink/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => e.target === e.currentTarget && asking.resolve(false)}
          data-no-pan
        >
          <motion.div
            id="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            aria-describedby="ask-body"
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            className="w-full max-w-md rounded-leaf border border-rule bg-card p-6 shadow-lift"
          >
            <div className="flex items-start gap-3">
              {asking.danger && (
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-petal/15 text-petal" aria-hidden="true">
                  <TriangleAlert size={18} />
                </span>
              )}
              <div className="min-w-0">
                <h2 id="ask-title" className="font-display text-[20px] leading-snug">
                  {asking.title}
                </h2>
                <p id="ask-body" className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                  {asking.body}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button ref={cancel} type="button" className="btn" onClick={() => asking.resolve(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={asking.danger ? 'btn-solid !bg-petal hover:!bg-[#8A3B4E]' : 'btn-solid'}
                onClick={() => asking.resolve(true)}
              >
                {asking.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
