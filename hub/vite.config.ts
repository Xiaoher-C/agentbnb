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
      '/cards': 'http://localhost:7701',
      '/health': 'http://localhost:7701',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
