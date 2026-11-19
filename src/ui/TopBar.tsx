import { AnimatePresence, motion } from 'framer-motion';
import { Archive, ChevronDown, Download, FileJson, FolderOpen, Menu, Redo2, RotateCcw, Search, Sprout, Undo2, UserPlus } from 'lucide-react';
import { coreGroup, familyTitle } from '../core/groups';
import { GroupsPanel } from './GroupsPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeLayout } from '../core/layout';
import { exportArchive, importArchive, saveFile, type ImportedArchive } from '../data/archive';
import { useStore } from '../data/store';
import { Hint } from './Hint';

export function TopBar({ query, onQuery, drawerOpen = false }: { query: string; onQuery(q: string): void; drawerOpen?: boolean }) {
  const graph = useStore((s) => s.graph);
  const media = useStore((s) => s.media);
  const toast = useStore((s) => s.toast);
  const replaceAll = useStore((s) => s.replaceAll);
  const startBlank = useStore((s) => s.startBlank);
  const restoreSample = useStore((s) => s.restoreSample);
  const addPerson = useStore((s) => s.addPerson);
  const undoLabel = useStore((s) => s.past.at(-1)?.label);
  const redoLabel = useStore((s) => s.future.at(-1)?.label);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const [menu, setMenu] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const core = coreGroup(graph);
  const [pending, setPending] = useState<{ kind: 'import'; data: ImportedArchive; name: string } | { kind: 'blank' | 'sample' } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const people = Object.values(graph.people).filter((p) => !p.placeholder).length;
  const gens = useMemo(() => {
    const L = computeLayout(graph);
    return Object.keys(L.gen).length ? Math.max(...Object.values(L.gen)) + 1 : 0;
  }, [graph]);
  const memories = Object.values(media).filter((m) => m.kind === 'audio').length;

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  async function doExport(kind: 'zip' | 'json') {
    setMenu(false);
    setBusy(true);
    try {
      const blob = await exportArchive(graph, kind);
      const d = new Date().toISOString().slice(0, 10);
      const name = `${familyTitle(graph).replace(/^The /, '').replace(/\s+/g, '-').toLowerCase()}-archive-${d}.${kind}`;
      const r = await saveFile(blob, name);
      if (r === 'saved') toast(`Backup saved: ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
    } catch (e) {
      toast(`Backup failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onImportFile(f: File) {
    setBusy(true);
    try {
      const data = await importArchive(f);
      setPending({ kind: 'import', data, name: f.name });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'import') {
        await replaceAll(pending.data.graph, pending.data.media);
        toast(`Restored ${Object.keys(pending.data.graph.people).length} people from ${pending.name}.`);
      } else if (pending.kind === 'blank') {
        await startBlank();
        toast('New tree started. Add the first person to begin.');
      } else {
        await restoreSample();
        toast('Sample family restored.');
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const item = 'flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm hover:bg-mist';

  return (
    <>
      <header data-no-pan className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto relative flex min-w-0 max-w-[min(100%,380px)] flex-1 flex-col gap-2 rounded-leaf-md border border-rule bg-card/95 p-3 shadow-specimen">
          <div className="flex items-start gap-2.5">
            <Sprout size={20} className="mt-0.5 shrink-0 text-moss" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Hint text={core ? 'Title comes from the main family group. Click to manage groups.' : 'Click to make family groups; the main group’s name becomes this title.'}>
                <button
                  type="button"
                  data-groups-toggle
                  className="group/t -mx-1 flex max-w-full items-center gap-1 rounded-leaf-sm px-1 text-left hover:bg-mist"
                  aria-expanded={groupsOpen}
                  aria-haspopup="dialog"
                  onClick={() => setGroupsOpen((o) => !o)}
                >
                  <h1 className="truncate font-display text-[18px] leading-tight">{familyTitle(graph)}</h1>
                  <ChevronDown size={15} className={`shrink-0 text-ink-muted transition-transform ${groupsOpen ? 'rotate-180' : ''}`} />
                </button>
              </Hint>
              <p className="font-label text-[11px] text-ink-muted">
                {core ? `${core.memberIds.length} in the family · ` : ''}
                {gens} generation{gens === 1 ? '' : 's'} · {people} {people === 1 ? 'person' : 'people'} · {memories} voice memor{memories === 1 ? 'y' : 'ies'}
              </p>
            </div>
          </div>
          <AnimatePresence>{groupsOpen && <GroupsPanel onClose={() => setGroupsOpen(false)} />}</AnimatePresence>
          <label className="flex h-9 items-center gap-2 rounded-leaf-sm bg-mist px-2.5 text-ink-muted">
            <Search size={15} aria-hidden="true" />
            <Hint text="Matches names, nicknames, birth surnames and birthplaces. Other cards fade.">
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Find a relative or place"
              aria-label="Find a relative or place"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-muted/80 focus:outline-none"
            />
            </Hint>
          </label>
        </div>

        <div ref={menuRef} className={`pointer-events-auto relative ml-auto flex items-start gap-2 transition-[margin] duration-300 ${drawerOpen ? 'sm:mr-[440px]' : ''}`}>
          {(undoLabel || redoLabel) && (
            <div className="flex overflow-hidden rounded-leaf-md border border-rule bg-card shadow-specimen">
              <Hint text={undoLabel ? `Undo “${undoLabel}” (Ctrl+Z)` : 'Nothing to undo'}>
                <button
                  type="button"
                  className="grid h-[42px] w-10 place-items-center text-moss-deep transition-colors hover:bg-mist disabled:text-ink-muted/40"
                  onClick={() => void undo()}
                  disabled={!undoLabel}
                  aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
                  aria-keyshortcuts="Control+Z"
                >
                  <Undo2 size={17} />
                </button>
              </Hint>
              <Hint text={redoLabel ? `Redo “${redoLabel}” (Ctrl+Shift+Z)` : 'Nothing to redo'}>
                <button
                  type="button"
                  className="grid h-[42px] w-10 place-items-center border-l border-rule text-moss-deep transition-colors hover:bg-mist disabled:text-ink-muted/40"
                  onClick={() => void redo()}
                  disabled={!redoLabel}
                  aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
                  aria-keyshortcuts="Control+Shift+Z"
                >
                  <Redo2 size={17} />
                </button>
              </Hint>
            </div>
          )}
          {people + Object.values(graph.people).filter((p) => p.placeholder).length > 0 && (
            <Hint text="Adds someone who isn't connected yet. Connect them by dragging the vine handle on their card onto someone else's card.">
              <button type="button" className="btn-solid !rounded-leaf-md !py-2.5 shadow-specimen" onClick={() => void addPerson()}>
                <UserPlus size={16} />
                <span className="hidden sm:inline">Add person</span>
                <span className="sr-only sm:hidden">Add person</span>
              </button>
            </Hint>
          )}
          <button
            type="button"
            className="btn !rounded-leaf-md !py-2.5 shadow-specimen"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            aria-haspopup="menu"
            disabled={busy}
          >
            {busy ? <Archive size={16} className="animate-pulse" /> : <Menu size={16} />}
            <span className="hidden sm:inline">{busy ? 'Working…' : 'Archive'}</span>
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-[calc(100%+8px)] w-[272px] origin-top-right rounded-leaf-md border border-rule bg-card p-1.5 shadow-lift"
              >
                <p className="label-caps px-3 pb-1 pt-2 !text-[10px]">Back up</p>
                <button role="menuitem" type="button" className={item} onClick={() => doExport('zip')}>
                  <Download size={15} className="text-moss" />
                  <span>
                    Export archive (.zip)
                    <small className="block text-[11px] text-ink-muted">Everything, photos and audio included</small>
                  </span>
                </button>
                <button role="menuitem" type="button" className={item} onClick={() => doExport('json')}>
                  <FileJson size={15} className="text-moss" />
                  <span>
                    Export as one .json file
                    <small className="block text-[11px] text-ink-muted">Same content, larger file</small>
                  </span>
                </button>
                <button
                  role="menuitem"
                  type="button"
                  className={item}
                  onClick={() => {
                    setMenu(false);
                    fileInput.current?.click();
                  }}
                >
                  <FolderOpen size={15} className="text-moss" />
                  <span>
                    Import archive…
                    <small className="block text-[11px] text-ink-muted">Restore a .zip or .json backup</small>
                  </span>
                </button>
                <div className="my-1.5 h-px bg-rule" />
                <p className="label-caps px-3 pb-1 pt-1 !text-[10px]">Start over</p>
                <button role="menuitem" type="button" className={item} onClick={() => (setMenu(false), setPending({ kind: 'blank' }))}>
                  <Sprout size={15} className="text-moss" /> Start a new tree
                </button>
                <button role="menuitem" type="button" className={item} onClick={() => (setMenu(false), setPending({ kind: 'sample' }))}>
                  <RotateCcw size={15} className="text-moss" /> Restore the sample family
                </button>
                <p className="px-3 pb-2 pt-2 text-[11px] leading-snug text-ink-muted">
                  Your tree is stored only in this browser on this computer. Export a backup now and then.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImportFile(f);
            }}
          />
        </div>
      </header>

      <AnimatePresence>
        {pending && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-md rounded-leaf border border-rule bg-card p-6 shadow-lift"
            >
              <h2 id="confirm-title" className="font-display text-[20px]">
                {pending.kind === 'import' ? 'Replace this tree with the backup?' : pending.kind === 'blank' ? 'Start a new, empty tree?' : 'Restore the sample family?'}
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                {pending.kind === 'import'
                  ? `${pending.name} holds ${Object.keys(pending.data.graph.people).length} people and ${pending.data.media.length} photos and recordings${
                      pending.data.exportedAt ? `, saved ${new Date(pending.data.exportedAt).toLocaleDateString()}` : ''
                    }. `
                  : ''}
                Everything currently in this browser’s tree ({people} people) will be replaced. Export a backup first if you want to keep it.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" className="btn" onClick={() => setPending(null)} autoFocus>
                  Cancel
                </button>
                <button type="button" className="btn" onClick={() => doExport('zip')}>
                  <Download size={14} /> Back up first
                </button>
                <button type="button" className="btn-solid !bg-petal hover:!bg-[#8A3B4E]" onClick={confirmPending} disabled={busy}>
                  {pending.kind === 'import' ? 'Replace with backup' : pending.kind === 'blank' ? 'Start new tree' : 'Restore sample'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
