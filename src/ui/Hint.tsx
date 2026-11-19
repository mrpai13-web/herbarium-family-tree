import { AnimatePresence, motion } from 'framer-motion';
import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

type Handler<E> = ((e: E) => void) | undefined;
interface HintableProps {
  onPointerEnter?: Handler<React.PointerEvent<HTMLElement>>;
  onPointerLeave?: Handler<React.PointerEvent<HTMLElement>>;
  onFocus?: Handler<React.FocusEvent<HTMLElement>>;
  onBlur?: Handler<React.FocusEvent<HTMLElement>>;
  onKeyDown?: Handler<React.KeyboardEvent<HTMLElement>>;
  onPointerDown?: Handler<React.PointerEvent<HTMLElement>>;
  'aria-describedby'?: string;
}

/**
 * Explanation bubble for a single control. Shows after a short hover, or straight
 * away on keyboard / click focus, and hides as soon as you start typing.
 * Rendered in a portal so the drawer's scroll area can't clip it. The text is
 * also linked with aria-describedby so screen readers read it with the field.
 */
export function Hint({ text, children, delay = 450 }: { text?: string; children: ReactElement<HintableProps>; delay?: number }) {
  const id = useId();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<number>();

  const hide = () => {
    window.clearTimeout(timer.current);
    setRect(null);
  };
  const show = (el: HTMLElement, wait: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRect(el.getBoundingClientRect()), wait);
  };

  // A scroll or resize would leave the bubble pointing at nothing.
  useEffect(() => {
    if (!rect) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [rect]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!text) return children;
  const p = children.props;
  const chain =
    <E,>(own: Handler<E>, mine: (e: E) => void) =>
    (e: E) => {
      mine(e);
      own?.(e);
    };

  const below = rect ? rect.top < 72 : false;
  const cx = rect ? Math.min(Math.max(rect.left + rect.width / 2, 136), window.innerWidth - 136) : 0;

  return (
    <>
      {cloneElement(children, {
        'aria-describedby': [p['aria-describedby'], id].filter(Boolean).join(' '),
        onPointerEnter: chain(p.onPointerEnter, (e) => e.pointerType === 'mouse' && show(e.currentTarget, delay)),
        onPointerLeave: chain(p.onPointerLeave, hide),
        onPointerDown: chain(p.onPointerDown, hide),
        onFocus: chain(p.onFocus, (e) => {
          if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, 120);
        }),
        onBlur: chain(p.onBlur, hide),
        onKeyDown: chain(p.onKeyDown, (e) => {
          if (e.key !== 'Tab' && e.key !== 'Shift') hide();
        }),
      })}
      <span id={id} hidden>
        {text}
      </span>
      {createPortal(
        <AnimatePresence>
          {rect && (
            <motion.div
              key="hint"
              role="presentation"
              aria-hidden="true"
              initial={{ opacity: 0, y: below ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.14 }}
              className="pointer-events-none fixed z-[70] w-max max-w-[248px] rounded-[12px_4px_12px_4px] bg-ink px-3 py-2 text-[12px] font-medium leading-snug text-card shadow-lift"
              style={{
                left: cx,
                top: below ? rect.bottom + 8 : rect.top - 8,
                translateX: '-50%',
                translateY: below ? '0%' : '-100%',
              }}
            >
              {text}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
