import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  test: {
    exclude: ['hub/**', 'node_modules/**', '.claude/worktrees/**', 'packages/**/node_modules/**'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  define: {
    AGENTBNB_VERSION: JSON.stringify(pkg.version),
  },
});
