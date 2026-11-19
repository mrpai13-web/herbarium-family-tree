import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ImagePlus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaMeta, Person } from '../core/types';
import { ACCEPT_IMAGE } from '../data/media';
import { useStore } from '../data/store';
import { DropZone, EditableText } from '../ui/bits';
import { confirmDeleteMedia } from '../data/deletes';
import { useMediaUrl } from '../ui/useMediaUrl';

const isImage = (f: File) => f.type.startsWith('image/');

function Thumb({ m, i, onOpen }: { m: MediaMeta; i: number; onOpen(): void }) {
  const url = useMediaUrl(m.id, 'thumb');
  return (
    <figure className="m-0 min-w-0">
      <button
        type="button"
        onClick={onOpen}
        data-media-id={m.id}
        aria-keyshortcuts="Delete"
        className="block aspect-[4/5] w-full overflow-hidden rounded-leaf-sm bg-mist shadow-[0_6px_10px_-8px_rgba(0,0,0,.5)] transition-transform hover:scale-[1.03]"
        style={{ transform: `rotate(${i % 2 ? 1.2 : -1.5}deg)` }}
        aria-label={`Open photo${m.caption ? ': ' + m.caption : ''}`}
      >
        {url && <img src={url} alt={m.caption ?? ''} className="h-full w-full object-cover" style={{ filter: 'sepia(.22) saturate(.85)' }} draggable={false} />}
      </button>
      <figcaption className="mt-1 truncate font-label text-[10.5px] leading-tight text-ink-soft">{m.caption || ' '}</figcaption>
    </figure>
  );
}

export function Gallery({ person, photos }: { person: Person; photos: MediaMeta[] }) {
  const addImages = useStore((s) => s.addImages);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const onFiles = async (files: File[]) => {
    setBusy(true);
    try {
      await addImages(person.id, files);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropZone onFiles={onFiles} accept={isImage} className="rounded-leaf-md">
      <div className="grid grid-cols-3 gap-2.5">
        {photos.map((m, i) => (
          <Thumb key={m.id} m={m} i={i} onOpen={() => setOpen(i)} />
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="grid aspect-[4/5] place-items-center rounded-leaf-sm border border-dashed border-fern bg-sheet/60 text-moss-deep transition-colors hover:bg-sheet"
        >
          <span className="flex flex-col items-center gap-1 px-1 text-center text-[11px] font-semibold">
            <ImagePlus size={18} />
            {busy ? 'Pressing…' : 'Add photos'}
          </span>
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-muted">Drop photos here. They’re resized on this computer to load instantly.</p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_IMAGE}
        multiple
        hidden
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])];
          e.target.value = '';
          if (fs.length) void onFiles(fs);
        }}
      />
      <AnimatePresence>
        {open !== null && photos[open] && (
          <Lightbox person={person} photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
        )}
      </AnimatePresence>
    </DropZone>
  );
}

function Lightbox({
  person,
  photos,
  index,
  onIndex,
  onClose,
}: {
  person: Person;
  photos: MediaMeta[];
  index: number;
  onIndex(i: number): void;
  onClose(): void;
}) {
  const m = photos[index];
  const url = useMediaUrl(m.id);
  const updateMedia = useStore((s) => s.updateMedia);
  const updatePerson = useStore((s) => s.updatePerson);
  const remove = async () => {
    const ok = await confirmDeleteMedia(m.id);
    if (!ok) return;
    if (photos.length <= 1) onClose();
    else onIndex(Math.max(0, index - 1));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input') || useStore.getState().asking) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        void remove();
      }
      if (e.key === 'Escape') {
        // Close only the photo viewer, not the profile behind it.
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos.length, onClose, onIndex, m.id]);
  const nav = 'grid h-11 w-11 place-items-center rounded-full bg-card/90 text-moss-deep shadow-specimen hover:bg-card';
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ink/80 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <button type="button" className={`${nav} absolute right-4 top-4`} onClick={onClose} aria-label="Close photo viewer">
        <X size={18} />
      </button>
      <div className="flex w-full max-w-5xl items-center justify-center gap-3">
        {photos.length > 1 && (
          <button type="button" className={nav} onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous photo">
            <ChevronLeft size={20} />
          </button>
        )}
        <motion.div
          key={m.id}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="min-w-0 flex-1 rounded-[6px] border-[10px] border-card bg-card shadow-lift"
        >
          {url && <img src={url} alt={m.caption ?? ''} className="mx-auto max-h-[68vh] w-auto object-contain" />}
        </motion.div>
        {photos.length > 1 && (
          <button type="button" className={nav} onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo">
            <ChevronRight size={20} />
          </button>
        )}
      </div>
      <div className="flex w-full max-w-xl flex-wrap items-center gap-2 rounded-leaf-md bg-card p-2.5">
        <EditableText
          id={`cap-${m.id}`}
          label="Caption"
          value={m.caption ?? ''}
          placeholder="Add a caption, e.g. Whitby, 1980"
          hint="Who, where and when. Saves when you press Enter or click away."
          className="min-w-0 flex-1 font-label text-[13px]"
          onCommit={(v) => updateMedia(m.id, { caption: v })}
        />
        <button
          type="button"
          className="btn !py-1.5 !text-[12px]"
          disabled={person.photoId === m.id}
          onClick={() => updatePerson(person.id, { photoId: m.id })}
        >
          <Star size={13} /> {person.photoId === m.id ? 'Portrait' : 'Use as portrait'}
        </button>
        <button type="button" className="btn !py-1.5 !text-[12px]" aria-keyshortcuts="Delete" onClick={() => void remove()}>
          <Trash2 size={13} /> Delete
        </button>
        <span className="w-full px-2 font-label text-[10.5px] text-ink-muted">
          {index + 1} of {photos.length}
          {m.width ? ` · ${m.width}×${m.height}` : ''}
        </span>
      </div>
    </motion.div>
  );
}
