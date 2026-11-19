import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './index.css';
import { guardEdits, useStore } from './data/store';
import { sharedTreeId } from './sync/config';
import { canEditNow } from './sync/engine';

// A shared tree: only invited, signed-in people may change it.
if (sharedTreeId) {
  let last = 0;
  guardEdits(canEditNow, (what) => {
    if (Date.now() - last < 1500) return;
    last = Date.now();
    useStore.getState().toast(
      what === 'replace'
        ? 'A shared tree can’t be replaced or reset here. Open your private tree for that.'
        : 'This tree is view only for you. Use the Share button to sign in with an invited email.',
      'error',
    );
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Errors outside rendering (event handlers, promises) don't trigger the error screen;
// show them as a toast so a problem is visible instead of silent.
const report = (msg: string) => {
  console.error('Herbarium error:', msg);
  void import('./data/store').then(({ useStore }) => useStore.getState().toast(`Something went wrong: ${msg}`, 'error'));
};
window.addEventListener('error', (e) => report(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => report(e.reason instanceof Error ? e.reason.message : String(e.reason)));

// Dev builds expose the store and backup helpers for automated checks.
if (import.meta.env.DEV) {
  void Promise.all([import('./data/store'), import('./data/archive'), import('./sync/engine')]).then(([s, a, sync]) => {
    Object.assign(window, { __store: s.useStore, __archive: a, __sync: sync });
  });
}
