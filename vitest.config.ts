import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['hub/**', 'node_modules/**'],
  },
});
