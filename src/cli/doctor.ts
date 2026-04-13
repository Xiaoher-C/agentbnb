/**
 * agentbnb doctor — Provider readiness check.
 *
 * Validates that a provider's setup is coherent, live, discoverable,
 * and ready to receive hire requests. Outputs honest, actionable
 * pass/warn/fail results for each check.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, getConfigDir } from './config.js';
import { loadKeyPair } from '../credit/signing.js';
import { ensureIdentity } from '../identity/identity.js';
import { parseSkillsFile, type SkillConfig } from '../skills/skill-config.js';
import { ProcessGuard, type PidFileContent } from '../runtime/process-guard.js';
import { openDatabase, listCards } from '../registry/store.js';
import { openCreditDb, getBalance } from '../credit/ledger.js';
import { probeRegistry } from '../utils/network-probe.js';
import { requestViaTemporaryRelay } from '../gateway/relay-dispatch.js';
import type { AgentBnBConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  json?: boolean;
  testHire?: boolean;
  skill?: string;
}

type CheckStatus = 'pass' | 'fail' | 'warn';

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  /** Why this matters (shown on fail/warn). */
  context?: string;
  /** Concrete next command to fix (shown on fail/warn). */
  fix?: string;
}

interface TestHireResult {
  success: boolean;
  skillId: string;
  selectionReason: string;
  creditsSpent: number;
  latency_ms: number;
  error?: string;
}

interface DoctorReport {
  checks: CheckResult[];
  testHire?: TestHireResult;
  passed: number;
  warnings: number;
  failed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkIdentity(configDir: string, config: AgentBnBConfig): CheckResult {
  try {
    loadKeyPair(configDir);
  } catch {
    return {
      name: 'Identity',
      status: 'fail',
      message: 'keypair not found',
      context: 'Without an identity, your agent cannot sign requests or publish cards.',
      fix: 'Run `agentbnb init`',
    };
  }

  let did = '';
  try {
    const identityPath = join(configDir, 'identity.json');
    if (existsSync(identityPath)) {
      const raw = JSON.parse(readFileSync(identityPath, 'utf-8'));
      did = raw.did ?? `did:agentbnb:${raw.agent_id ?? 'unknown'}`;
    }
  } catch { /* non-fatal */ }

  const label = did ? `${config.owner} (${did})` : config.owner;
  return { name: 'Identity', status: 'pass', message: label };
}

function checkSkills(configDir: string): CheckResult {
  const skillsPath = join(configDir, 'skills.yaml');
  if (!existsSync(skillsPath)) {
    return {
      name: 'Skills',
      status: 'fail',
      message: 'skills.yaml not found',
      context: 'Skills define what your agent can do for hire.',
      fix: 'Run `agentbnb quickstart` to generate default skills',
    };
  }

  let skills: SkillConfig[];
  try {
    const content = readFileSync(skillsPath, 'utf-8');
    skills = parseSkillsFile(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Check for env var expansion errors specifically
    if (msg.includes('environment variable') || msg.includes('env var')) {
      return {
        name: 'Skills',
        status: 'warn',
        message: `skills.yaml has unresolved environment variables`,
        context: 'Skills exist but may not execute until env vars are set.',
        fix: `Check missing env vars: ${msg}`,
      };
    }
    return {
      name: 'Skills',
      status: 'fail',
      message: `skills.yaml parse error: ${msg}`,
      context: 'Malformed skills.yaml prevents your agent from executing any skill.',
      fix: 'Fix syntax errors in ~/.agentbnb/skills.yaml',
    };
  }

  if (skills.length === 0) {
    return {
      name: 'Skills',
      status: 'fail',
      message: 'skills.yaml is empty (0 skills)',
      context: 'Without skills, there is nothing for other agents to hire.',
      fix: 'Add at least one skill to ~/.agentbnb/skills.yaml',
    };
  }

  return { name: 'Skills', status: 'pass', message: `${skills.length} skills in ~/.agentbnb/skills.yaml` };
}

async function checkGateway(configDir: string): Promise<{ result: CheckResult; meta: PidFileContent | null }> {
  const guard = new ProcessGuard(join(configDir, '.pid'));
  const meta = guard.getRunningMeta();

  if (!meta) {
    return {
      result: {
        name: 'Gateway',
        status: 'fail',
        message: 'not running',
        context: 'Your skills cannot receive requests without the daemon.',
        fix: 'Run `agentbnb serve`',
      },
      meta: null,
    };
  }

  // Probe the health endpoint directly
  const healthy = await probeGatewayHealth(meta.port);
  if (!healthy) {
    return {
      result: {
        name: 'Gateway',
        status: 'warn',
        message: `pid ${meta.pid} exists but /health is not responding on port ${meta.port}`,
        context: 'The daemon process is running but may not be accepting requests.',
        fix: 'Restart with `agentbnb serve --restart` or check logs',
      },
      meta,
    };
  }

  return {
    result: {
      name: 'Gateway',
      status: 'pass',
      message: `running on port ${meta.port} (pid ${meta.pid})`,
    },
    meta,
  };
}

function checkCards(config: AgentBnBConfig): { result: CheckResult; localCount: number } {
  let localCount = 0;
  try {
    const db = openDatabase(config.db_path);
    try {
      const cards = listCards(db);
      localCount = cards.filter(c => c.owner === config.owner).length;
    } finally {
      db.close();
    }
  } catch {
    return {
      result: {
        name: 'Cards',
        status: 'fail',
        message: 'cannot read registry database',
        context: 'Capability cards make your skills discoverable to other agents.',
        fix: 'Run `agentbnb init` to recreate the database',
      },
      localCount: 0,
    };
  }

  if (localCount === 0) {
    return {
      result: {
        name: 'Cards',
        status: 'fail',
        message: 'no capability cards published',
        context: 'Without published cards, no agent can discover or hire your skills.',
        fix: 'Run `agentbnb publish-skills` or `agentbnb serve` to auto-publish',
      },
      localCount: 0,
    };
  }

  // Local cards exist — remote discoverability checked separately
  return {
    result: {
      name: 'Cards',
      status: 'pass', // upgraded or downgraded by remote check below
      message: `${localCount} cards published locally`,
    },
    localCount,
  };
}

async function checkCardsRemote(
  config: AgentBnBConfig,
  localCount: number,
): Promise<CheckResult> {
  if (!config.registry) {
    return {
      name: 'Cards',
      status: localCount > 0 ? 'warn' : 'fail',
      message: localCount > 0
        ? `${localCount} cards published locally — remote discoverability not verified (no registry configured)`
        : 'no cards published',
      context: localCount > 0
        ? 'Without a registry connection, other agents outside your network cannot discover you.'
        : 'Without published cards, no agent can discover or hire your skills.',
      fix: localCount > 0 ? undefined : 'Run `agentbnb publish-skills`',
    };
  }

  // Try remote verification
  try {
    const { fetchRemoteCards } = await import('./remote-registry.js');
    const remoteCards = await fetchRemoteCards(config.registry, { q: config.owner }, 3_000);
    const ownCards = remoteCards.filter(c => c.owner === config.owner);

    if (ownCards.length > 0) {
      const host = extractHost(config.registry);
      return {
        name: 'Cards',
        status: 'pass',
        message: `${localCount} cards published, ${ownCards.length} verified discoverable on ${host}`,
      };
    }

    return {
      name: 'Cards',
      status: 'warn',
      message: `${localCount} cards published locally — not yet discoverable on remote registry`,
      context: 'Cards are local but the relay has not propagated them yet. This may resolve after daemon restart.',
      fix: 'Restart daemon with `agentbnb serve` to push cards to registry',
    };
  } catch {
    return {
      name: 'Cards',
      status: 'warn',
      message: `${localCount} cards published locally — remote discoverability not verified (registry probe failed)`,
      context: 'Could not reach registry to verify discoverability.',
    };
  }
}

function checkCredits(config: AgentBnBConfig): CheckResult {
  let balance = 0;
  try {
    const creditDb = openCreditDb(config.credit_db_path);
    try {
      balance = getBalance(creditDb, config.owner);
    } finally {
      creditDb.close();
    }
  } catch {
    return {
      name: 'Credits',
      status: 'warn',
      message: 'cannot read credit database',
      context: 'Credit state is unknown but serving may still work.',
      fix: 'Run `agentbnb init` to recreate the database',
    };
  }

  if (balance <= 0) {
    return {
      name: 'Credits',
      status: 'warn',
      message: '0 credits — serving still works, but `--test-hire` requires credits',
      context: 'You can receive hire requests at any balance. Credits are needed to hire others or run self-tests.',
      fix: 'Credits are earned by completing jobs. Run `agentbnb credits` for details',
    };
  }

  return { name: 'Credits', status: 'pass', message: `${balance} credits available` };
}

async function checkRegistry(config: AgentBnBConfig): Promise<CheckResult> {
  if (!config.registry) {
    return {
      name: 'Registry',
      status: 'warn',
      message: 'no remote registry configured (local-only mode)',
      context: 'Without a registry, only local-network agents can discover you via mDNS.',
    };
  }

  const reachable = await probeRegistry(config.registry);
  if (!reachable) {
    const host = extractHost(config.registry);
    return {
      name: 'Registry',
      status: 'fail',
      message: `configured but unreachable (${host})`,
      context: 'Remote agents cannot discover you if the registry is down.',
      fix: 'Check network connection, or verify registry URL with `agentbnb config get registry`',
    };
  }

  const host = extractHost(config.registry);
  return { name: 'Registry', status: 'pass', message: `connected to ${host}` };
}

function checkRelay(config: AgentBnBConfig, daemonRunning: boolean): CheckResult {
  if (!daemonRunning) {
    return {
      name: 'Relay',
      status: 'fail',
      message: 'cannot connect without running daemon',
      context: 'Relay enables cross-network hiring — agents outside your LAN reach you through it.',
      fix: 'Start daemon first: `agentbnb serve`',
    };
  }

  if (!config.registry) {
    return {
      name: 'Relay',
      status: 'warn',
      message: 'no relay target configured (no registry URL)',
      context: 'Without a relay, only local-network agents can hire you.',
    };
  }

  // Relay status is inferred — daemon is running and registry is configured,
  // so the daemon likely established a WebSocket relay connection.
  // We cannot directly verify from outside the daemon process.
  return {
    name: 'Relay',
    status: 'warn',
    message: 'likely connected (inferred from daemon state — not directly verified)',
    context: 'Relay connectivity is inferred. A future update will add direct verification.',
  };
}

// ---------------------------------------------------------------------------
// Test hire
// ---------------------------------------------------------------------------

async function runTestHire(
  config: AgentBnBConfig,
  configDir: string,
  explicitSkillId?: string,
): Promise<TestHireResult> {
  // Test-hire uses the relay path — the same path a real hirer would use.
  // Direct local HTTP self-hire is blocked by the self-request guard and
  // would not exercise the real hire architecture (relay-mediated escrow).

  if (!config.registry) {
    return {
      success: false,
      skillId: '',
      selectionReason: '',
      creditsSpent: 0,
      latency_ms: 0,
      error: 'Test-hire requires a registry (relay) connection. Configure a registry URL with `agentbnb config set registry <url>`',
    };
  }

  // Verify registry is reachable before attempting
  const reachable = await probeRegistry(config.registry);
  if (!reachable) {
    return {
      success: false,
      skillId: '',
      selectionReason: '',
      creditsSpent: 0,
      latency_ms: 0,
      error: `Registry unreachable (${extractHost(config.registry)}). Test-hire needs relay connectivity`,
    };
  }

  // 1. Load cards
  let cards: Array<{ id: string; owner: string; name: string; pricing?: { credits_per_call?: number }; skills?: Array<{ id: string; name?: string; pricing?: { credits_per_call?: number } }> }>;
  try {
    const db = openDatabase(config.db_path);
    try {
      cards = listCards(db).filter(c => c.owner === config.owner) as typeof cards;
    } finally {
      db.close();
    }
  } catch {
    return { success: false, skillId: '', selectionReason: '', creditsSpent: 0, latency_ms: 0, error: 'Cannot read registry database' };
  }

  if (cards.length === 0) {
    return { success: false, skillId: '', selectionReason: '', creditsSpent: 0, latency_ms: 0, error: 'No published capability cards' };
  }

  // 2. Load skills.yaml for safety check
  let skillConfigs: SkillConfig[] = [];
  try {
    const skillsPath = join(configDir, 'skills.yaml');
    if (existsSync(skillsPath)) {
      skillConfigs = parseSkillsFile(readFileSync(skillsPath, 'utf-8'));
    }
  } catch { /* proceed without safety info */ }

  // 3. Select skill
  let selectedCard = cards[0];
  let selectedSkillId = '';
  let selectionReason = '';
  let creditsCost = 0;

  if (explicitSkillId) {
    // Explicit --skill flag
    const found = findSkillInCards(cards, explicitSkillId);
    if (!found) {
      return { success: false, skillId: explicitSkillId, selectionReason: 'explicit --skill flag', creditsSpent: 0, latency_ms: 0, error: `Skill "${explicitSkillId}" not found in published cards` };
    }
    selectedCard = found.card;
    selectedSkillId = found.skillId;
    creditsCost = found.credits;
    selectionReason = 'explicit --skill flag';
  } else {
    // Conservative selection: prefer safe command-type skills
    const safeCandidate = findSafeSkill(cards, skillConfigs);
    if (safeCandidate) {
      selectedCard = safeCandidate.card;
      selectedSkillId = safeCandidate.skillId;
      creditsCost = safeCandidate.credits;
      selectionReason = safeCandidate.reason;
    } else {
      // Fallback: cheapest skill
      const cheapest = findCheapestSkill(cards);
      selectedCard = cheapest.card;
      selectedSkillId = cheapest.skillId;
      creditsCost = cheapest.credits;
      selectionReason = 'cheapest available (no safe candidate found)';
    }
  }

  // 4. Check credit balance (relay holds escrow server-side using registry balance)
  try {
    const creditDb = openCreditDb(config.credit_db_path);
    try {
      const balance = getBalance(creditDb, config.owner);
      if (balance < creditsCost) {
        return {
          success: false,
          skillId: selectedSkillId || selectedCard.id,
          selectionReason,
          creditsSpent: 0,
          latency_ms: 0,
          error: `Insufficient credits: need ${creditsCost}, have ${balance}. Credits are earned by completing jobs`,
        };
      }
    } finally {
      creditDb.close();
    }
  } catch { /* proceed — relay will reject if balance truly insufficient */ }

  // 5. Resolve agent identity for relay
  let agentId: string | undefined;
  try {
    const identity = ensureIdentity(configDir, config.owner);
    agentId = identity.agent_id;
  } catch { /* proceed with owner fallback */ }

  // 6. Execute test-hire via relay (the real hire path)
  const start = Date.now();
  try {
    await requestViaTemporaryRelay({
      registryUrl: config.registry,
      agent_id: agentId,
      owner: config.owner,
      token: config.token,
      targetOwner: config.owner,
      targetAgentId: agentId,
      cardId: selectedCard.id,
      skillId: selectedSkillId || undefined,
      params: {
        prompt: 'Reply with exactly: DOCTOR_SMOKE_TEST_OK',
        ...(selectedSkillId ? { skill_id: selectedSkillId } : {}),
        requester: config.owner,
      },
      timeoutMs: 60_000,
    });

    return {
      success: true,
      skillId: selectedSkillId || selectedCard.name || selectedCard.id,
      selectionReason,
      creditsSpent: creditsCost,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      skillId: selectedSkillId || selectedCard.name || selectedCard.id,
      selectionReason,
      creditsSpent: 0,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function probeGatewayHealth(port: number, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = await res.json() as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface SkillCandidate {
  card: { id: string; owner: string; name: string; [key: string]: unknown };
  skillId: string;
  credits: number;
  reason: string;
}

function findSkillInCards(
  cards: Array<{ id: string; skills?: Array<{ id: string; pricing?: { credits_per_call?: number } }>; pricing?: { credits_per_call?: number } }>,
  skillId: string,
): SkillCandidate | null {
  for (const card of cards) {
    if (card.skills) {
      const skill = card.skills.find(s => s.id === skillId);
      if (skill) {
        return { card: card as SkillCandidate['card'], skillId: skill.id, credits: skill.pricing?.credits_per_call ?? 0, reason: '' };
      }
    }
    // Check if the card ID matches
    if (card.id === skillId) {
      return { card: card as SkillCandidate['card'], skillId: '', credits: (card.pricing as { credits_per_call?: number })?.credits_per_call ?? 0, reason: '' };
    }
  }
  return null;
}

function findSafeSkill(
  cards: Array<{ id: string; skills?: Array<{ id: string; name?: string; pricing?: { credits_per_call?: number } }>; [key: string]: unknown }>,
  skillConfigs: SkillConfig[],
): SkillCandidate | null {
  // Build a set of safe skill IDs from skill configs (command-type with safe commands)
  const safeSkillIds = new Set<string>();
  for (const sc of skillConfigs) {
    if (sc.type === 'command') {
      const cmd = (sc as { command?: string }).command ?? '';
      // Safe = contains "claude" or "echo" (known non-destructive)
      if (/\bclaude\b/.test(cmd) || /\becho\b/.test(cmd)) {
        safeSkillIds.add(sc.id);
      }
    }
  }

  // Find cheapest safe skill across all cards
  let best: SkillCandidate | null = null;
  for (const card of cards) {
    if (card.skills) {
      for (const skill of card.skills) {
        if (safeSkillIds.has(skill.id)) {
          const credits = skill.pricing?.credits_per_call ?? 0;
          if (!best || credits < best.credits) {
            best = { card: card as SkillCandidate['card'], skillId: skill.id, credits, reason: 'safe command-type skill' };
          }
        }
      }
    }
  }

  // Also check card-level skills by matching config IDs
  if (!best) {
    for (const sc of skillConfigs) {
      if (safeSkillIds.has(sc.id)) {
        for (const card of cards) {
          const pricing = (card as { pricing?: { credits_per_call?: number } }).pricing;
          const credits = pricing?.credits_per_call ?? 0;
          if (!best || credits < best.credits) {
            best = { card: card as SkillCandidate['card'], skillId: sc.id, credits, reason: 'safe command-type skill' };
          }
        }
      }
    }
  }

  return best;
}

function findCheapestSkill(
  cards: Array<{ id: string; name: string; skills?: Array<{ id: string; pricing?: { credits_per_call?: number } }>; pricing?: { credits_per_call?: number } }>,
): SkillCandidate {
  let best: SkillCandidate = { card: cards[0] as SkillCandidate['card'], skillId: '', credits: Infinity, reason: '' };

  for (const card of cards) {
    if (card.skills) {
      for (const skill of card.skills) {
        const credits = skill.pricing?.credits_per_call ?? 0;
        if (credits < best.credits) {
          best = { card: card as SkillCandidate['card'], skillId: skill.id, credits, reason: 'cheapest available' };
        }
      }
    }
    const cardCredits = card.pricing?.credits_per_call ?? 0;
    if (cardCredits < best.credits) {
      best = { card: card as SkillCandidate['card'], skillId: '', credits: cardCredits, reason: 'cheapest available' };
    }
  }

  if (best.credits === Infinity) best.credits = 0;
  return best;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runDoctor(opts: DoctorOptions): Promise<void> {
  const configDir = getConfigDir();
  const config = loadConfig();

  if (!config) {
    const report: DoctorReport = {
      checks: [{
        name: 'Identity',
        status: 'fail',
        message: 'not initialized',
        context: 'AgentBnB has not been set up on this machine.',
        fix: 'Run `agentbnb quickstart` to get started',
      }],
      passed: 0,
      warnings: 0,
      failed: 1,
      total: 1,
    };
    renderReport(report, opts.json ?? false);
    process.exit(1);
  }

  const checks: CheckResult[] = [];

  // 1. Identity
  checks.push(checkIdentity(configDir, config));

  // 2. Skills
  checks.push(checkSkills(configDir));

  // 3. Gateway
  const gateway = await checkGateway(configDir);
  checks.push(gateway.result);
  const daemonRunning = gateway.result.status === 'pass';

  // 4. Cards — local check first
  const cardsLocal = checkCards(config);

  // 5. Credits
  checks.push(checkCredits(config));

  // 6. Registry
  const registryResult = await checkRegistry(config);
  checks.push(registryResult);

  // 4b. Cards — remote check (depends on registry result)
  if (cardsLocal.localCount > 0 && registryResult.status === 'pass') {
    checks.splice(3, 0, await checkCardsRemote(config, cardsLocal.localCount));
  } else if (cardsLocal.localCount > 0) {
    // Registry not reachable or not configured — cards are local-only
    checks.splice(3, 0, {
      name: 'Cards',
      status: 'warn',
      message: `${cardsLocal.localCount} cards published locally — remote discoverability not verified`,
      context: 'Without remote registry verification, other agents may not find your skills.',
    });
  } else {
    checks.splice(3, 0, cardsLocal.result);
  }

  // 7. Relay
  checks.push(checkRelay(config, daemonRunning));

  // Test hire (optional)
  let testHireResult: TestHireResult | undefined;
  if (opts.testHire) {
    testHireResult = await runTestHire(config, configDir, opts.skill);
  }

  const passed = checks.filter(c => c.status === 'pass').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  const report: DoctorReport = {
    checks,
    testHire: testHireResult,
    passed,
    warnings,
    failed,
    total: checks.length,
  };

  renderReport(report, opts.json ?? false);

  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderReport(report: DoctorReport, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('\nagentbnb doctor \u2014 Provider Readiness Check\n');

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '\u2713' : check.status === 'warn' ? '\u26A0' : '\u2717';
    const pad = check.name.padEnd(12);
    console.log(`  ${icon} ${pad} ${check.message}`);
  }

  // Summary line
  const parts: string[] = [`${report.passed}/${report.total} checks passed`];
  if (report.warnings > 0) parts.push(`${report.warnings} warning${report.warnings > 1 ? 's' : ''}`);
  if (report.failed > 0) parts.push(`${report.failed} failure${report.failed > 1 ? 's' : ''}`);
  console.log(`\n  Result: ${parts.join(', ')}\n`);

  // Failures with actionable fixes
  const failures = report.checks.filter(c => c.status === 'fail');
  if (failures.length > 0) {
    console.log('  To fix:');
    for (const f of failures) {
      console.log(`    \u2717 ${f.name} \u2014 ${f.context ?? f.message}`);
      if (f.fix) console.log(`      \u2192 ${f.fix}`);
    }
    console.log('');
  }

  // Warnings
  const warns = report.checks.filter(c => c.status === 'warn' && c.context);
  if (warns.length > 0) {
    console.log('  Warnings:');
    for (const w of warns) {
      console.log(`    \u26A0 ${w.name} \u2014 ${w.context}`);
      if (w.fix) console.log(`      \u2192 ${w.fix}`);
    }
    console.log('');
  }

  // Test hire results
  if (report.testHire) {
    const th = report.testHire;
    console.log('  Test hire:');
    console.log(`    Skill:    ${th.skillId} (${th.creditsSpent} credits, selected: ${th.selectionReason})`);
    if (th.success) {
      console.log(`    Result:   \u2713 completed in ${th.latency_ms}ms`);
      console.log(`    Credits:  ${th.creditsSpent} credits spent (self-to-self)`);
      console.log('    Proof:    Your provider can execute real hire requests end-to-end.');
    } else {
      console.log(`    Result:   \u2717 failed after ${th.latency_ms}ms`);
      console.log(`    Error:    ${th.error}`);
    }
    console.log('');
  }

  // Next steps (only if no test hire and checks mostly pass)
  if (!report.testHire && report.failed === 0) {
    console.log('  Next steps:');
    console.log('    \u2192 Run `agentbnb doctor --test-hire` to prove end-to-end hiring works');
    console.log('    \u2192 Run `agentbnb discover "code review"` to see your skills as a hirer would');
    console.log('');
  }
}
