/**
 * Interactive template picker for smart onboarding fallback.
 *
 * Shown when no capabilities are auto-detected. User picks from a numbered
 * menu of common capability templates.
 */
import { createInterface } from 'node:readline';
import { INTERACTIVE_TEMPLATES } from './capability-templates.js';
import type { DetectedCapability } from './capability-templates.js';

/**
 * Prompts the user with a numbered template menu and returns selected capabilities.
 *
 * Only works in TTY environments. Prints the menu to stdout and reads
 * comma-separated numbers from stdin.
 *
 * @returns Array of selected capabilities (may be empty if user enters nothing)
 */
export async function interactiveTemplateMenu(): Promise<DetectedCapability[]> {
  console.log('\nNo capabilities auto-detected.\n');
  console.log('What can your agent do? Pick from templates:\n');

  for (let i = 0; i < INTERACTIVE_TEMPLATES.length; i++) {
    console.log(`  ${i + 1}. ${INTERACTIVE_TEMPLATES[i]!.name}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('\nSelect [1-8, comma-separated]: ', (ans) => {
      rl.close();
      resolve(ans);
    });
  });

  return parseSelection(answer);
}

/**
 * Parses a comma-separated string of numbers into selected capabilities.
 * Invalid numbers or out-of-range values are silently skipped.
 *
 * @param input - User input, e.g. "1,3,5"
 * @returns Array of selected capabilities
 */
export function parseSelection(input: string): DetectedCapability[] {
  if (!input || input.trim().length === 0) {
    return [];
  }

  const selected: DetectedCapability[] = [];
  const seen = new Set<string>();
  const parts = input.split(',').map((s) => s.trim());

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 1 || num > INTERACTIVE_TEMPLATES.length) {
      continue;
    }
    const template = INTERACTIVE_TEMPLATES[num - 1]!;
    if (!seen.has(template.key)) {
      seen.add(template.key);
      selected.push({ ...template });
    }
  }

  return selected;
}
