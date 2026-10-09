import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { engine } from './engine/Engine';
import { useUI } from './state/store';
import { trackPresence } from './engine/presence';

// ?debug exposes the engine for automated checks and tinkering in the console.
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { aeloria: { engine, useUI } });

trackPresence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
