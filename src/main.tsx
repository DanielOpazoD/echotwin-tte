import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useHudStore, useSimStore } from './app/store';
import './app/styles.css';
import { compareBackends, compareImageChain } from '@/app/debugCompare';
import { frameBus } from '@/app/frameBus';

// Test/debug hook (used by Playwright E2E and the dev console). Contains no patient data.
(window as unknown as { __echotwin?: unknown }).__echotwin = {
  useSimStore,
  useHudStore,
  compareBackends,
  compareImageChain,
  frameBus,
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
