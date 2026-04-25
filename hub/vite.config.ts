/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/hub/',
  // Force a single React copy at dev/build time. Adding reactflow to the hub
  // workspace pulled a duplicate react into root/node_modules/.pnpm because its
  // peer-deps are satisfied from the root graph; without this dedupe, vite
  // loads both copies and every hook throws "Cannot read properties of null".
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
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
