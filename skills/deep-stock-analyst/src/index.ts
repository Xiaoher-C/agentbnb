#!/usr/bin/env node
/**
 * CLI entry point for deep-stock-analyst.
 * Usage: node dist/index.js --ticker IBM --depth standard --style hybrid
 * Output: JSON to stdout (genesis-bot reads this)
 *
 * Exit codes:
 *   0 = success, JSON on stdout
 *   1 = invalid args or API error
 *   2 = rate limit / daily limit reached
 */

import { runAnalysis } from './orchestrator.js';
import type { InvestmentStyle } from './analysis/signal.js';

function parseArgs(): { ticker: string; depth: string; style: InvestmentStyle } | null {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const ticker = get('--ticker');
  const depth = get('--depth') ?? 'standard';
  const style = (get('--style') ?? 'hybrid') as InvestmentStyle;

  if (!ticker) {
    console.error('Usage: node dist/index.js --ticker <TICKER> [--depth quick|standard|deep] [--style growth|value|momentum|hybrid]');
    return null;
  }

  const validDepths = ['quick', 'standard', 'deep'];
  const validStyles = ['growth', 'value', 'momentum', 'hybrid'];

  if (!validDepths.includes(depth)) {
    console.error(`Invalid depth: ${depth}. Must be one of: ${validDepths.join(', ')}`);
    return null;
  }
  if (!validStyles.includes(style)) {
    console.error(`Invalid style: ${style}. Must be one of: ${validStyles.join(', ')}`);
    return null;
  }

  return { ticker, depth, style };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args) {
    process.exit(1);
  }

  const apiKey = process.env['ALPHA_VANTAGE_API_KEY'];
  if (!apiKey) {
    console.error('Missing ALPHA_VANTAGE_API_KEY environment variable');
    process.exit(1);
  }

  try {
    const result = await runAnalysis({
      ticker: args.ticker,
      depth: args.depth as 'quick' | 'standard' | 'deep',
      style: args.style,
      apiKey,
    });

    // Output clean JSON to stdout (genesis-bot reads this)
    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
    process.exit(0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('rate limit')) {
      console.error(`[rate-limit] ${msg}`);
      process.exit(2);
    }

    console.error(`[error] ${msg}`);
    process.exit(1);
  }
}

main();
