import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // The installable app. The service worker holds the page and its assets, so the app can start with no
    // network. It answers nothing else: there is no runtime caching, so a call to Firebase, Google APIs or
    // reCAPTCHA is never stored and never answered from a cache.
    VitePWA({
      // A newer version waits until the teacher presses Reload: a run in progress is never reloaded away.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Staffroom',
        short_name: 'Staffroom',
        description: 'Turn private class notes into a plan or messages home. The cloud writes without the secrets; your device checks what comes back.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#f4efe4',
        background_color: '#f4efe4',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell, eval.html and its script, the icons, and the recorded run when there is one.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        navigateFallback: '/index.html',
        // eval.html is its own page, and Firebase's reserved paths are never the app.
        navigateFallbackDenylist: [/^\/eval\.html/, /^\/__/],
        // A page keeps its place in the cache whatever its query: eval.html?set=rules is eval.html.
        ignoreURLParametersMatching: [/./],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // eval.html is a developer page for measuring the on-device check. It is built beside the app.
  build: { rolldownOptions: { input: { main: 'index.html', eval: 'eval.html' } } },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
