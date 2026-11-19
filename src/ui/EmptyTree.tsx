import { motion } from 'framer-motion';
import { FolderOpen, RotateCcw, UserPlus } from 'lucide-react';
import { useRef } from 'react';
import { importArchive } from '../data/archive';
import { useStore } from '../data/store';

/** What an empty sheet shows: one clear way to start, plus the sample and backup routes. */
export function EmptyTree() {
  const addPerson = useStore((s) => s.addPerson);
  const restoreSample = useStore((s) => s.restoreSample);
  const replaceAll = useStore((s) => s.replaceAll);
  const toast = useStore((s) => s.toast);
  const file = useRef<HTMLInputElement>(null);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-4" data-no-pan>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        className="pointer-events-auto relative w-full max-w-[400px] rounded-leaf border border-rule bg-card px-7 pb-7 pt-9 text-center shadow-lift"
      >
        <span className="tape" />
        <svg viewBox="0 0 120 70" className="mx-auto h-[70px] w-[120px]" aria-hidden="true">
          <path d="M60 68C60 50 60 40 60 22" stroke="#3E6B48" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M60 40C48 36 40 26 38 14C50 16 58 26 60 40Z" fill="#7FA36B" />
          <path d="M60 30C72 26 80 16 82 6C70 8 62 16 60 30Z" fill="#3E6B48" opacity=".85" />
          <path d="M30 68H90" stroke="#CBD3BE" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h2 className="mt-3 font-display text-[24px] leading-tight">Start your tree</h2>
        <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-ink-soft">
          Begin with one person, often yourself or the eldest relative you know. Then drag the vine handle on a card to empty space to add
          a relative, or onto another card to connect two people.
        </p>
        <button type="button" className="btn-solid mt-5 !px-5 !py-2.5 !text-[15px]" onClick={() => void addPerson()} autoFocus>
          <UserPlus size={17} /> Add the first person
        </button>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-rule pt-4 text-[12.5px]">
          <button type="button" className="flex items-center gap-1.5 font-semibold text-moss-deep hover:underline" onClick={() => file.current?.click()}>
            <FolderOpen size={14} /> Open a backup
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 font-semibold text-moss-deep hover:underline"
            onClick={async () => {
              await restoreSample();
              toast('Sample family loaded. Archive → Start a new tree clears it again.');
            }}
          >
            <RotateCcw size={14} /> Explore a sample family
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const data = await importArchive(f);
              await replaceAll(data.graph, data.media);
              toast(`Opened ${Object.keys(data.graph.people).length} people from ${f.name}.`);
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
        />
      </motion.div>
    </div>
  );
}
