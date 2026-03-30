/**
 * GEP-lite initializer — creates the minimal evolution asset directory.
 *
 * GEP (Genetic Evolution Protocol) tracks capability evolution in:
 *   brainDir/gep/genes.json      — earned capability traits
 *   brainDir/gep/capsules.json   — packaged skill bundles
 *   brainDir/gep/events.jsonl    — append-only evolution event log
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Initializes the GEP directory skeleton inside a brain directory.
 * No-op if the directory already exists.
 *
 * @param brainDir - Path to ~/.openclaw/workspace/brains/<agent>
 */
export function initGepDir(brainDir: string): void {
  const gepDir = join(brainDir, 'gep');
  if (existsSync(gepDir)) return;

  mkdirSync(gepDir, { recursive: true });

  writeFileSync(join(gepDir, 'genes.json'), '[]\n', 'utf-8');
  writeFileSync(join(gepDir, 'capsules.json'), '[]\n', 'utf-8');
  writeFileSync(join(gepDir, 'events.jsonl'), '', 'utf-8');
}
