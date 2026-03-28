import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  test: {
    exclude: ['hub/**', 'node_modules/**'],
  },
  define: {
    AGENTBNB_VERSION: JSON.stringify(pkg.version),
  },
});
