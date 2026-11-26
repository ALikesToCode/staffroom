import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // eval.html is a developer page for measuring the on-device check. It is built beside the app.
  build: { rolldownOptions: { input: { main: 'index.html', eval: 'eval.html' } } },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
