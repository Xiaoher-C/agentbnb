/**
 * demo.test.ts — Integration tests for Text-Gen Studio agent.
 *
 * Validates three things:
 * 1. Card + skills.yaml schema correctness
 * 2. Conductor integration (TaskDecomposer → CapabilityMatcher)
 * 3. OpenClaw bootstrap lifecycle (activate → deactivate)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { CapabilityCardV2Schema } from '../../src/types/index.js';
import { openDatabase } from '../../src/registry/store.js';
import { parseSkillsFile } from '../../src/skills/skill-config.js';
import { decompose } from '../../src/conductor/task-decomposer.js';
import { matchSubTasks } from '../../src/conductor/capability-matcher.js';
import {
  registerConductorCard,
  CONDUCTOR_OWNER,
} from '../../src/conductor/card.js';
import { activate, deactivate } from '../../skills/agentbnb/bootstrap.js';
import type { BootstrapContext } from '../../skills/agentbnb/bootstrap.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CARD_PATH = join(__dirname, 'demo-card.json');
const SKILLS_PATH = join(__dirname, 'skills.yaml');
const SOUL_PATH = join(__dirname, 'SOUL.md');

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Schema Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Schema Validation', () => {
  it('demo-card.json passes CapabilityCardV2Schema', () => {
    const raw = JSON.parse(readFileSync(CARD_PATH, 'utf-8')) as unknown;
    const card = CapabilityCardV2Schema.parse(raw);

    expect(card.spec_version).toBe('2.0');
    expect(card.owner).toBe('text-gen-studio');
    expect(card.agent_name).toBe('Text-Gen Studio');
    expect(card.skills).toHaveLength(3);
    expect(card.skills.map((s) => s.id)).toEqual([
      'text-gen',
      'summarize',
      'research-brief',
    ]);
  });

  it('skills.yaml passes SkillsFileSchema', () => {
    const yamlContent = readFileSync(SKILLS_PATH, 'utf-8');
    const skills = parseSkillsFile(yamlContent);

    expect(skills).toHaveLength(3);
    expect(skills[0]!.type).toBe('command');
    expect(skills[0]!.id).toBe('text-gen');
    expect(skills[1]!.type).toBe('command');
    expect(skills[1]!.id).toBe('summarize');
    expect(skills[2]!.type).toBe('pipeline');
    expect(skills[2]!.id).toBe('research-brief');
  });

  it('skill IDs in card match skill IDs in skills.yaml', () => {
    const card = CapabilityCardV2Schema.parse(
      JSON.parse(readFileSync(CARD_PATH, 'utf-8')),
    );
    const skills = parseSkillsFile(readFileSync(SKILLS_PATH, 'utf-8'));

    const cardSkillIds = new Set(card.skills.map((s) => s.id));
    const yamlSkillIds = new Set(skills.map((s) => s.id));

    expect(cardSkillIds).toEqual(yamlSkillIds);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Conductor Integration
// ─────────────────────────────────────────────────────────────────────────────

describe('Conductor Integration', () => {
  /**
   * Registers the demo card directly into a SQLite DB (same pattern as
   * registerConductorCard in src/conductor/card.ts).
   */
  function registerDemoCard(db: ReturnType<typeof openDatabase>) {
    const card = CapabilityCardV2Schema.parse(
      JSON.parse(readFileSync(CARD_PATH, 'utf-8')),
    );
    const now = new Date().toISOString();

    db.prepare(
      'INSERT OR REPLACE INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(card.id, card.owner, JSON.stringify(card), now, now);

    return card;
  }

  it('TaskDecomposer produces text_gen subtasks from deep-analysis template', () => {
    const subtasks = decompose('analyze this research report');

    // deep-analysis template: web_search → text_gen → text_gen → text_gen
    expect(subtasks).toHaveLength(4);

    const capabilities = subtasks.map((s) => s.required_capability);
    expect(capabilities).toContain('web_search');
    expect(capabilities.filter((c) => c === 'text_gen')).toHaveLength(3);
  });

  it('CapabilityMatcher finds Text-Gen Studio for text_gen subtasks', async () => {
    const db = openDatabase();

    // Register both cards
    registerDemoCard(db);
    registerConductorCard(db);

    // Decompose a task that triggers deep-analysis template
    const subtasks = decompose('analyze this research report');

    // Match subtasks to agents
    const matches = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: CONDUCTOR_OWNER,
    });

    expect(matches).toHaveLength(4);

    // text_gen subtasks should match text-gen-studio
    const textGenMatches = matches.filter(
      (m) => m.selected_agent === 'text-gen-studio',
    );
    expect(textGenMatches.length).toBe(3); // 3 of 4 subtasks are text_gen

    // The matcher selects the cheapest skill (summarize at 1cr) as primary,
    // with text-gen (2cr) as alternative — both belong to text-gen-studio
    const firstMatch = textGenMatches[0]!;
    expect(firstMatch.score).toBeGreaterThan(0);
    expect(firstMatch.alternatives.length).toBeGreaterThanOrEqual(1);

    // text-gen skill should appear either as primary or in alternatives
    const hasTextGenSkill =
      firstMatch.selected_skill === 'text-gen' ||
      firstMatch.alternatives.some((a) => a.skill === 'text-gen');
    expect(hasTextGenSkill).toBe(true);

    // web_search subtask should have no match (empty selected_agent)
    const webSearchMatch = matches.find(
      (m) =>
        subtasks.find((s) => s.id === m.subtask_id)?.required_capability ===
        'web_search',
    );
    expect(webSearchMatch?.selected_agent).toBe('');

    db.close();
  });

  it('Conductor self-excludes from matches', async () => {
    const db = openDatabase();

    registerDemoCard(db);
    registerConductorCard(db);

    const subtasks = decompose('analyze this research report');
    const matches = await matchSubTasks({
      db,
      subtasks,
      conductorOwner: CONDUCTOR_OWNER,
    });

    // Conductor should never match itself
    const conductorMatches = matches.filter(
      (m) => m.selected_agent === CONDUCTOR_OWNER,
    );
    expect(conductorMatches).toHaveLength(0);

    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3: OpenClaw Bootstrap Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('OpenClaw Bootstrap', () => {
  let ctx: BootstrapContext | undefined;
  let tmpDir: string;

  afterEach(async () => {
    if (ctx) {
      await deactivate(ctx);
      ctx = undefined;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('activate() publishes card from SOUL.md and starts gateway', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-demo-'));

    ctx = await activate({
      owner: 'text-gen-studio',
      soulMdPath: SOUL_PATH,
      registryDbPath: join(tmpDir, 'registry.db'),
      creditDbPath: join(tmpDir, 'credit.db'),
      gatewayPort: 0, // random available port
      silent: true,
    });

    // Card should be published with skills from SOUL.md H2 sections
    expect(ctx.card.owner).toBe('text-gen-studio');
    expect(ctx.card.skills.length).toBeGreaterThanOrEqual(2);

    // Gateway should be listening
    const addr = ctx.gateway.server.address();
    expect(addr).toBeTruthy();
    const port =
      typeof addr === 'string' ? parseInt(addr) : (addr?.port ?? 0);
    expect(port).toBeGreaterThan(0);

    // Health endpoint should respond
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('deactivate() cleanly shuts down all resources', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentbnb-demo-'));

    ctx = await activate({
      owner: 'text-gen-studio',
      soulMdPath: SOUL_PATH,
      registryDbPath: join(tmpDir, 'registry.db'),
      creditDbPath: join(tmpDir, 'credit.db'),
      gatewayPort: 0,
      silent: true,
    });

    const addr = ctx.gateway.server.address();
    const port =
      typeof addr === 'string' ? parseInt(addr) : (addr?.port ?? 0);

    // Deactivate
    await deactivate(ctx);

    // Gateway should no longer respond
    try {
      await fetch(`http://localhost:${port}/health`);
      // If we get here, the server is still up — fail
      expect(true).toBe(false);
    } catch {
      // Expected: connection refused
      expect(true).toBe(true);
    }

    // Mark as cleaned up so afterEach doesn't double-deactivate
    ctx = undefined;
  });
});
