/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/hub/',
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/cards': 'http://localhost:7777',
      '/health': 'http://localhost:7777',
      '/me': 'http://localhost:7777',
      '/requests': 'http://localhost:7777',
      '/draft': 'http://localhost:7777',
      '/api': 'http://localhost:7777',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
