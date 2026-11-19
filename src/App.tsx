import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { TreeCanvas, type TreeCanvasHandle } from './canvas/TreeCanvas';
import { requestPersistence } from './data/db';
import { useStore } from './data/store';
import { ProfileDrawer } from './drawer/ProfileDrawer';
import { Toasts } from './ui/bits';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { EmptyTree } from './ui/EmptyTree';
import { confirmDeleteMedia, confirmDeletePerson } from './data/deletes';
import { TopBar } from './ui/TopBar';
import { personMatches } from './core/dates';
import { sharedRepo } from './sync/config';
import { loadSession, startSync, useSync } from './sync/engine';

export function App() {
  const ready = useStore((s) => s.ready);
  const load = useStore((s) => s.load);
  const selectedId = useStore((s) => s.selectedId);
  const person = useStore((s) => (s.selectedId ? s.graph.people[s.selectedId] : undefined));
  const select = useStore((s) => s.select);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const canvas = useRef<TreeCanvasHandle>(null);

  useEffect(() => {
    load()
      .then(() => {
        // Network trouble isn't fatal: the cached copy stays usable and the status says why.
        const connect = sharedRepo ? startSync(() => useStore.getState().reload()) : loadSession();
        connect.catch((e: Error) => useSync.setState({ status: navigator.onLine ? 'error' : 'offline', problem: e.message, firstLoad: false }));
      })
      .catch((e: Error) => setError(e.message));
    void requestPersistence();
  }, [load]);

  // Delete / Backspace removes what has focus (a photo or voice memory in the drawer, or a card
  // on the tree), otherwise the open profile. Always asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.defaultPrevented || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      const s = useStore.getState();
      if (s.asking) return;
      const focus = document.activeElement as HTMLElement | null;
      const mediaId = focus?.closest<HTMLElement>('[data-media-id]')?.dataset.mediaId;
      const personId = focus?.closest<HTMLElement>('[data-person-id]')?.dataset.personId ?? s.selectedId;
      if (mediaId) {
        e.preventDefault();
        void confirmDeleteMedia(mediaId);
      } else if (personId && s.graph.people[personId]) {
        e.preventDefault();
        void confirmDeletePerson(personId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Inside a text field the
  // browser's own text undo applies instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      const s = useStore.getState();
      if (k === 'y' || e.shiftKey) void s.redo();
      else void s.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const empty = useStore((s) => Object.keys(s.graph.people).length === 0);
  const canEdit = useSync((s) => s.canEdit);
  const firstLoad = useSync((s) => s.firstLoad);
  const missing = useSync((s) => s.status === 'missing');
  const signin = useSync((s) => s.status === 'signin');

  // Opening someone from the drawer's family list should bring them into view.
  useEffect(() => {
    if (selectedId) canvas.current?.focusPerson(selectedId);
  }, [selectedId]);

  if (error)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="font-display text-2xl">The archive couldn’t be opened</h1>
          <p className="mt-2 text-ink-soft">
            The browser refused access to local storage ({error}). Private windows and some privacy settings block it. Open the app in a normal window.
          </p>
        </div>
      </div>
    );

  if (!ready)
    return (
      <div className="canvas-bg grid h-full place-items-center">
        <p className="label-caps animate-pulse">Opening the archive…</p>
      </div>
    );

  return (
    <div className="relative h-full overflow-hidden" data-readonly={canEdit ? undefined : ''}>
      <TreeCanvas ref={canvas} query={query} drawerOpen={!!person} />
      {empty && firstLoad && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="label-caps animate-pulse">Opening the shared tree…</p>
        </div>
      )}
      {empty && !firstLoad &&
        (signin ? (
          <SharedNotice text="This family tree is private. Use the Sign in button at the top right to sign in with your GitHub account." />
        ) : missing ? (
          <SharedNotice text="Your GitHub account can’t open this tree yet. Ask whoever sent the link to add your GitHub username, then accept the invitation GitHub emails you." />
        ) : canEdit ? (
          <EmptyTree />
        ) : (
          <SharedNotice text="This shared tree is empty so far." />
        ))}
      <TopBar
        drawerOpen={!!person}
        query={query}
        onQuery={(q) => {
          setQuery(q);
          if (!q.trim()) return;
          const s = useStore.getState();
          const hit = Object.values(s.graph.people).find((p) => personMatches(p, q));
          if (hit) canvas.current?.focusPerson(hit.id);
        }}
      />
      <AnimatePresence>{person && <ProfileDrawer key="drawer" person={person} onClose={() => select(null)} />}</AnimatePresence>
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}

function SharedNotice({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
      <p className="max-w-sm rounded-leaf-md border border-rule bg-card/95 p-5 text-center text-[14px] leading-relaxed shadow-specimen">{text}</p>
    </div>
  );
}
