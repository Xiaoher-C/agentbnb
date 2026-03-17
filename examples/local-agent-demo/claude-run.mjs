#!/usr/bin/env node
/**
 * claude-run.mjs — Runs claude -p in a clean environment.
 *
 * Usage: node claude-run.mjs "your prompt here"
 *
 * Strips Claude Code session env vars and spawns claude -p
 * with proper stdio handling for subprocess contexts.
 */

import { spawn } from 'node:child_process';

const prompt = process.argv[2];
if (!prompt) {
  process.stderr.write('Usage: node claude-run.mjs "prompt"\n');
  process.exit(1);
}

// Clean environment: remove all Claude Code session vars
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;
delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;
delete cleanEnv.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING;
delete cleanEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;

const child = spawn('claude', ['-p', prompt], {
  env: cleanEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

child.on('close', (code) => {
  if (code === 0) {
    process.stdout.write(stdout);
  } else {
    process.stderr.write(stderr || `claude exited with code ${code}\n`);
    process.exit(code ?? 1);
  }
});
