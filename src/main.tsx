import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { announceUpdate } from './ui/pwa';
import './styles.css';

// The service worker keeps the page and its assets, so the app can start offline. A newer version is
// fetched in the background and waits: the page says "Update available" and reloads only on a click.
const update = registerSW({
  onNeedRefresh() {
    announceUpdate(() => void update(true));
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
