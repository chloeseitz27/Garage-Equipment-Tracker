import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser never talks to the assistant provider directly, and never
    // sees an API key (technical-spec.md §9.1).
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
