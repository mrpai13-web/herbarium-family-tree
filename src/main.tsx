import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './index.css';

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
  void Promise.all([import('./data/store'), import('./data/archive')]).then(([s, a]) => {
    Object.assign(window, { __store: s.useStore, __archive: a });
  });
}
