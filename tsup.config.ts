import { defineConfig } from 'tsup';

export default defineConfig([
  // Library entry — no shebang needed
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  // CLI entry — source file already has #!/usr/bin/env node shebang
  // tsup preserves the source shebang; no additional banner needed
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
  },
]);
