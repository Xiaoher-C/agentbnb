import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../registry/store.js';
import { openCreditDb, bootstrapAgent } from '../credit/ledger.js';
import { getOpenClawStatus } from './skill.js';
import type { AgentBnBConfig } from '../cli/config.js';
import type Database from 'better-sqlite3';

const mockConfig: AgentBnBConfig = {
  owner: 'test-owner',
  gateway_url: 'http://localhost:7700',
  gateway_port: 7700,
  db_path: ':memory:',
  credit_db_path: ':memory:',
  token: 'test-token',
  autonomy: { tier1_max_credits: 10, tier2_max_credits: 50 },
  budget: { reserve_credits: 20 },
};

describe('getOpenClawStatus', () => {
  let db: Database.Database;
  let creditDb: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    creditDb = openCreditDb(':memory:');
  });

  it('returns installed=true with owner and gateway_url', () => {
    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.installed).toBe(true);
    expect(status.owner).toBe('test-owner');
    expect(status.gateway_url).toBe('http://localhost:7700');
  });

  it('returns tier config from config.autonomy', () => {
    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.tier.tier1_max_credits).toBe(10);
    expect(status.tier.tier2_max_credits).toBe(50);
  });

  it('returns default tier config when autonomy not configured', () => {
    const configNoAutonomy: AgentBnBConfig = { ...mockConfig, autonomy: undefined };
    const status = getOpenClawStatus(configNoAutonomy, db, creditDb);
    expect(status.tier.tier1_max_credits).toBe(0);
    expect(status.tier.tier2_max_credits).toBe(0);
  });

  it('returns balance from credit db', () => {
    bootstrapAgent(creditDb, 'test-owner', 100);
    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.balance).toBe(100);
  });

  it('returns 0 balance when agent has no credits', () => {
    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.balance).toBe(0);
  });

  it('returns reserve from config.budget', () => {
    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.reserve).toBe(20);
  });

  it('returns default reserve when budget not configured', () => {
    const configNoBudget: AgentBnBConfig = { ...mockConfig, budget: undefined };
    const status = getOpenClawStatus(configNoBudget, db, creditDb);
    expect(status.reserve).toBe(20); // DEFAULT_BUDGET_CONFIG.reserve_credits
  });

  it('returns empty skills array when no v2.0 cards', () => {
    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.skills).toEqual([]);
  });

  it('returns skills from v2.0 cards', () => {
    // Insert a v2.0 card directly
    const now = new Date().toISOString();
    const card = {
      spec_version: '2.0',
      id: 'test-card-id',
      owner: 'test-owner',
      agent_name: 'Test Agent',
      skills: [
        {
          id: 'tts',
          name: 'TTS',
          description: 'Text to speech',
          level: 2,
          inputs: [{ name: 'input', type: 'text', required: true }],
          outputs: [{ name: 'output', type: 'audio', required: true }],
          pricing: { credits_per_call: 10 },
          availability: { online: true },
          _internal: { idle_rate: 0.75 },
        },
      ],
      availability: { online: true },
    };
    db.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      card.id,
      card.owner,
      JSON.stringify(card),
      now,
      now,
    );

    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.skills).toHaveLength(1);
    expect(status.skills[0]!.id).toBe('tts');
    expect(status.skills[0]!.name).toBe('TTS');
    expect(status.skills[0]!.idle_rate).toBe(0.75);
    expect(status.skills[0]!.online).toBe(true);
  });

  it('defaults idle_rate to null when not set in _internal', () => {
    const now = new Date().toISOString();
    const card = {
      spec_version: '2.0',
      id: 'test-card-id-2',
      owner: 'test-owner',
      agent_name: 'Test Agent',
      skills: [
        {
          id: 'ocr',
          name: 'OCR',
          description: 'Optical recognition',
          level: 2,
          inputs: [{ name: 'input', type: 'image', required: true }],
          outputs: [{ name: 'output', type: 'text', required: true }],
          pricing: { credits_per_call: 5 },
          // No _internal.idle_rate
        },
      ],
      availability: { online: true },
    };
    db.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      card.id,
      card.owner,
      JSON.stringify(card),
      now,
      now,
    );

    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.skills).toHaveLength(1);
    expect(status.skills[0]!.idle_rate).toBeNull();
  });

  it('does not include v1.0 cards in skills output', () => {
    // Insert a v1.0 card
    const now = new Date().toISOString();
    const v1Card = {
      spec_version: '1.0',
      id: 'v1-card-id',
      owner: 'test-owner',
      name: 'V1 Card',
      description: 'Old card',
      level: 2,
      inputs: [{ name: 'input', type: 'text', required: true }],
      outputs: [{ name: 'output', type: 'text', required: true }],
      pricing: { credits_per_call: 5 },
      availability: { online: true },
      metadata: {},
    };
    db.prepare('INSERT INTO capability_cards (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      v1Card.id,
      v1Card.owner,
      JSON.stringify(v1Card),
      now,
      now,
    );

    const status = getOpenClawStatus(mockConfig, db, creditDb);
    expect(status.skills).toEqual([]);
  });
});
