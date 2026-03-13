import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs the CLI via tsx with a temp AGENTBNB_DIR.
 * Returns stdout, stderr, and exit code.
 */
function runCli(args: string, agentbnbDir: string): { stdout: string; stderr: string; status: number } {
  const cliPath = join(import.meta.dirname ?? __dirname, 'index.ts');
  try {
    const result = execSync(`npx tsx ${cliPath} ${args}`, {
      env: { ...process.env, AGENTBNB_DIR: agentbnbDir },
      encoding: 'utf-8',
      timeout: 15000,
    });
    return { stdout: result as unknown as string, stderr: '', status: 0 };
  } catch (err) {
    const e = err as SpawnSyncReturns<string>;
    return {
      stdout: (e.stdout as string | null) ?? '',
      stderr: (e.stderr as string | null) ?? '',
      status: (e.status as number | null) ?? 1,
    };
  }
}

/** Creates a minimal valid CapabilityCard JSON for testing. */
function makeCardJson(id: string, name: string): string {
  return JSON.stringify({
    id,
    owner: 'test-agent',
    name,
    description: 'A test capability card for unit tests',
    level: 1,
    inputs: [{ name: 'text', type: 'text', required: true }],
    outputs: [{ name: 'result', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: {},
  });
}

describe('CLI: init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates config.json with agent identity', () => {
    const { status, stdout } = runCli('init --owner test-agent', tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('AgentBnB initialized');
    expect(stdout).toContain('test-agent');

    const configPath = join(tmpDir, 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    expect(config.owner).toBe('test-agent');
    expect(typeof config.token).toBe('string');
    expect((config.token as string).length).toBeGreaterThan(0);
  });

  it('creates credit DB and bootstraps with 100 credits (visible in status)', () => {
    const { status } = runCli('init --owner credit-agent', tmpDir);
    expect(status).toBe(0);

    const creditDbPath = join(tmpDir, 'credit.db');
    expect(existsSync(creditDbPath)).toBe(true);

    // Check balance via status command (same dir)
    const { stdout: statusOut, status: statusCode } = runCli('status', tmpDir);
    expect(statusCode).toBe(0);
    expect(statusOut).toContain('100');
  });

  it('outputs JSON with --json flag', () => {
    const { status, stdout } = runCli('init --owner json-agent --json', tmpDir);
    expect(status).toBe(0);

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.owner).toBe('json-agent');
    expect(typeof parsed.token).toBe('string');
  });
});

describe('CLI: publish', () => {
  let tmpDir: string;
  let cardPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    // Initialize first
    runCli('init --owner pub-agent', tmpDir);
    // Write a valid card
    cardPath = join(tmpDir, 'card.json');
    writeFileSync(cardPath, makeCardJson('00000000-0000-0000-0000-000000000001', 'Test Card'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('publishes a valid card and confirms success', () => {
    const { status, stdout } = runCli(`publish ${cardPath}`, tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('Published');
    expect(stdout).toContain('Test Card');
  });

  it('shows published card in discover results', () => {
    runCli(`publish ${cardPath}`, tmpDir);

    const { status, stdout } = runCli('discover', tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('Test Card');
  });

  it('exits with error for invalid JSON card file', () => {
    const badPath = join(tmpDir, 'bad.json');
    writeFileSync(badPath, '{ not valid json }');

    const { status, stderr } = runCli(`publish ${badPath}`, tmpDir);
    expect(status).toBe(1);
    expect(stderr).toContain('invalid JSON');
  });

  it('exits with error for card failing schema validation', () => {
    const invalidCard = join(tmpDir, 'invalid.json');
    writeFileSync(invalidCard, JSON.stringify({ id: 'not-a-uuid', name: '' }));

    const { status, stderr } = runCli(`publish ${invalidCard}`, tmpDir);
    expect(status).toBe(1);
    expect(stderr).toContain('validation failed');
  });

  it('outputs JSON with --json flag on success', () => {
    const { status, stdout } = runCli(`publish ${cardPath} --json`, tmpDir);
    expect(status).toBe(0);

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.id).toBe('00000000-0000-0000-0000-000000000001');
  });
});

describe('CLI: discover', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    runCli('init --owner discover-agent', tmpDir);

    // Publish two cards
    const cardA = join(tmpDir, 'cardA.json');
    const cardB = join(tmpDir, 'cardB.json');
    writeFileSync(cardA, makeCardJson('00000000-0000-0000-0000-000000000010', 'Alpha TTS'));
    writeFileSync(cardB, makeCardJson('00000000-0000-0000-0000-000000000020', 'Beta Translate'));
    runCli(`publish ${cardA}`, tmpDir);
    runCli(`publish ${cardB}`, tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists all cards with no query', () => {
    const { status, stdout } = runCli('discover', tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('Alpha TTS');
    expect(stdout).toContain('Beta Translate');
  });

  it('searches by query', () => {
    const { status, stdout } = runCli('discover Alpha', tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('Alpha TTS');
  });

  it('returns JSON with --json flag', () => {
    const { status, stdout } = runCli('discover --json', tmpDir);
    expect(status).toBe(0);

    const cards = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(2);
  });
});

describe('CLI: status', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
    runCli('init --owner status-agent', tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows balance after init', () => {
    const { status, stdout } = runCli('status', tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('status-agent');
    expect(stdout).toContain('100');
  });

  it('shows zero escrows on fresh init', () => {
    const { status, stdout } = runCli('status', tmpDir);
    expect(status).toBe(0);
    expect(stdout).toContain('none');
  });

  it('returns JSON with --json flag', () => {
    const { status, stdout } = runCli('status --json', tmpDir);
    expect(status).toBe(0);

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.owner).toBe('status-agent');
    expect(parsed.balance).toBe(100);
  });
});

describe('CLI: request', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits with error when config missing', () => {
    const { status, stderr } = runCli('request some-card-id', tmpDir);
    expect(status).toBe(1);
    expect(stderr).toContain('not initialized');
  });

  it('exits with error for invalid --params JSON', () => {
    runCli('init --owner req-agent', tmpDir);
    const { status, stderr } = runCli('request some-card-id --params "not-json"', tmpDir);
    expect(status).toBe(1);
    expect(stderr).toContain('valid JSON');
  });
});

describe('CLI: --help', () => {
  it('all commands have --help registered in program', async () => {
    // Import program to verify commands are registered
    const expectedCommands = ['init', 'publish', 'discover', 'request', 'status', 'serve'];
    for (const cmd of expectedCommands) {
      const tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-help-'));
      try {
        const { stdout, status } = runCli(`${cmd} --help`, tmpDir);
        // --help exits with 0 and includes 'Usage:'
        expect(status, `${cmd} --help should exit 0`).toBe(0);
        expect(stdout, `${cmd} --help should show Usage`).toContain('Usage:');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
});
