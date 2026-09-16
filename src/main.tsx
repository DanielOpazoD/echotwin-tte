import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useHudStore, useSimStore } from './app/store';
import './app/styles.css';
import type { compareBackends, compareImageChain } from '@/app/debugCompare';
import { frameBus } from '@/app/frameBus';

// Test/debug hook (used by Playwright E2E and the dev console). Contains no patient data. The backend
// comparison pulls the CPU tracer, the WebGL2 port and its shaders onto the main thread, which the app never
// needs: it loads on first call (page.evaluate awaits the promise), keeping them out of the entry chunk.
(window as unknown as { __echotwin?: unknown }).__echotwin = {
  useSimStore,
  useHudStore,
  compareBackends: (...args: Parameters<typeof compareBackends>) =>
    import('@/app/debugCompare').then((m) => m.compareBackends(...args)),
  compareImageChain: (...args: Parameters<typeof compareImageChain>) =>
    import('@/app/debugCompare').then((m) => m.compareImageChain(...args)),
  frameBus,
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
