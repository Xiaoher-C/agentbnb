import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  test: {
    exclude: ['hub/**', 'node_modules/**', '**/node_modules/**', '.claude/**', 'packages/**'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['./test/setup-env.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/types/**', '**/hub/**'],
    },
  },
  define: {
    AGENTBNB_VERSION: JSON.stringify(pkg.version),
  },
});
