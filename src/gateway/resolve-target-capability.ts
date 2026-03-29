import type Database from 'better-sqlite3';
import { getCard, listCards } from '../registry/store.js';
import { searchCards } from '../registry/matcher.js';
import { fetchRemoteCards } from '../cli/remote-registry.js';
import type { CapabilityCard } from '../types/index.js';
import { resolveCanonicalIdentity } from '../identity/agent-identity.js';

/**
 * Unified capability routing result used by request/query/batch flows.
 */
export interface ResolvedTargetCapability {
  cardId: string;
  skillId?: string;
  owner: string;
  agent_id?: string;
  gateway_url: string;
  via_relay: boolean;
  credits_per_call: number;
  source: 'local' | 'remote' | 'relay';
}

/**
 * Resolution options for local/remote/relay capability lookup.
 */
export interface ResolveTargetCapabilityOptions {
  registryDb?: Database.Database;
  registryUrl?: string;
  onlineOnly?: boolean;
}

interface SkillShape {
  id: string;
  name: string;
  description: string;
  pricing: { credits_per_call: number };
}

interface CardShape extends CapabilityCard {
  gateway_url?: string;
  skills?: SkillShape[];
}

function canQueryLocalDb(db: Database.Database | undefined): db is Database.Database {
  return Boolean(db) && typeof (db as unknown as { prepare?: unknown }).prepare === 'function';
}

function getGatewayUrl(card: CardShape): string {
  if (typeof card.gateway_url === 'string' && card.gateway_url.length > 0) {
    return card.gateway_url;
  }
  const internal = card._internal as Record<string, unknown> | undefined;
  const internalGateway = internal?.['gateway_url'];
  return typeof internalGateway === 'string' ? internalGateway : '';
}

function isOnline(card: CardShape): boolean {
  return card.availability?.online !== false;
}

function scoreSkill(skill: SkillShape, query: string): number {
  const q = query.toLowerCase();
  if (skill.id.toLowerCase() === q) return 100;
  let score = 0;
  if (skill.id.toLowerCase().includes(q)) score += 40;
  if (skill.name.toLowerCase().includes(q)) score += 20;
  if (skill.description.toLowerCase().includes(q)) score += 10;
  return score;
}

function pickSkill(card: CardShape, queryOrId: string): SkillShape | undefined {
  const skills = Array.isArray(card.skills) ? card.skills : [];
  if (skills.length === 0) return undefined;

  const exact = skills.find((s) => s.id === queryOrId);
  if (exact) return exact;

  const scored = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, queryOrId) }))
    .sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) > 0) return scored[0]?.skill;

  return skills[0];
}

function resolveCardAgentId(
  card: CardShape,
  registryDb: Database.Database | undefined,
): string | undefined {
  if (typeof card.agent_id === 'string' && card.agent_id.length > 0) {
    return card.agent_id;
  }

  if (!canQueryLocalDb(registryDb)) return undefined;

  const resolved = resolveCanonicalIdentity(registryDb, card.owner);
  return resolved.resolved ? resolved.agent_id : undefined;
}

function toResolved(
  card: CardShape,
  queryOrId: string,
  source: 'local' | 'remote' | 'relay',
  registryDb: Database.Database | undefined,
): ResolvedTargetCapability {
  const skill = pickSkill(card, queryOrId);
  const gatewayUrl = getGatewayUrl(card);
  const viaRelay = source === 'local' ? false : gatewayUrl.length === 0;
  const resolvedSource = viaRelay ? 'relay' : source;
  const agentId = resolveCardAgentId(card, registryDb);

  return {
    cardId: card.id,
    skillId: skill?.id,
    owner: card.owner,
    ...(agentId ? { agent_id: agentId } : {}),
    gateway_url: gatewayUrl,
    via_relay: viaRelay,
    credits_per_call: skill?.pricing.credits_per_call ?? card.pricing.credits_per_call,
    source: resolvedSource,
  };
}

function findLocalBySkillId(
  db: Database.Database,
  skillId: string,
  onlineOnly: boolean,
): CardShape | null {
  const rows = db
    .prepare('SELECT data FROM capability_cards')
    .all() as Array<{ data: string }>;

  for (const row of rows) {
    const card = JSON.parse(row.data) as CardShape;
    if (onlineOnly && !isOnline(card)) continue;
    const skills = Array.isArray(card.skills) ? card.skills : [];
    if (skills.some((s) => s.id === skillId)) {
      return card;
    }
  }
  return null;
}

function findRemoteBySkillId(cards: CardShape[], skillId: string): CardShape | null {
  for (const card of cards) {
    const skills = Array.isArray(card.skills) ? card.skills : [];
    if (skills.some((s) => s.id === skillId)) return card;
  }
  return null;
}

function looksLikeCardId(value: string): boolean {
  return value.startsWith('card-') ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve a target capability from local registry first, then remote registry,
 * then relay-connected providers via online remote-card fallback.
 */
export async function resolveTargetCapability(
  queryOrId: string,
  options: ResolveTargetCapabilityOptions,
): Promise<ResolvedTargetCapability | null> {
  const { registryDb, registryUrl, onlineOnly = true } = options;
  const needle = queryOrId.trim();
  if (needle.length === 0) return null;

  // 1) Local exact card id
  if (canQueryLocalDb(registryDb)) {
    const byCardId = getCard(registryDb, needle) as CardShape | null;
    if (byCardId && (!onlineOnly || isOnline(byCardId))) {
      return toResolved(byCardId, needle, 'local', registryDb);
    }

    // 1b) Local exact skill id
    const bySkillId = findLocalBySkillId(registryDb, needle, onlineOnly);
    if (bySkillId) {
      return toResolved(bySkillId, needle, 'local', registryDb);
    }

    // 1c) Local text search
    const localMatches = searchCards(registryDb, needle, { online: onlineOnly ? true : undefined });
    if (localMatches.length > 0) {
      return toResolved(localMatches[0] as CardShape, needle, 'local', registryDb);
    }
  }

  if (!registryUrl) return null;

  // 2) Remote exact card id (only for UUID-like IDs).
  if (looksLikeCardId(needle)) {
    try {
      const cardResp = await fetch(`${registryUrl.replace(/\/$/, '')}/cards/${encodeURIComponent(needle)}`);
      if (cardResp.ok) {
        const remoteCard = (await cardResp.json()) as CardShape;
        if (!onlineOnly || isOnline(remoteCard)) {
          return toResolved(remoteCard, needle, 'remote', registryDb);
        }
      }
    } catch {
      // continue to remote search
    }
  }

  // 2b) Remote query search
  try {
    const remoteMatches = (await fetchRemoteCards(registryUrl, {
      q: needle,
      ...(onlineOnly ? { online: true } : {}),
    })) as CardShape[];

    if (remoteMatches.length > 0) {
      const exactSkill = findRemoteBySkillId(remoteMatches, needle);
      if (exactSkill) return toResolved(exactSkill, needle, 'remote', registryDb);
      return toResolved(remoteMatches[0] as CardShape, needle, 'remote', registryDb);
    }
  } catch {
    // continue to relay fallback
  }

  // 3) Relay-connected provider fallback:
  // remote online browse without query catches cases where query indexing misses.
  try {
    const onlineCards = (await fetchRemoteCards(registryUrl, {
      ...(onlineOnly ? { online: true } : {}),
    })) as CardShape[];

    const exactSkill = findRemoteBySkillId(onlineCards, needle);
    if (exactSkill) return toResolved(exactSkill, needle, 'relay', registryDb);

    const tokens = needle
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const fuzzy = onlineCards.find((card) => {
      const text = [
        card.name,
        card.description,
        ...(Array.isArray(card.skills) ? card.skills.map((s) => `${s.id} ${s.name} ${s.description}`) : []),
      ]
        .join(' ')
        .toLowerCase();
      return tokens.some((token) => text.includes(token));
    });
    if (fuzzy) return toResolved(fuzzy, needle, 'relay', registryDb);
  } catch {
    // final miss
  }

  return null;
}

/**
 * Resolve a local card by skill ID using raw DB scan.
 * Exported for tests and batch exact skill matching.
 */
export function resolveLocalCardBySkillId(
  db: Database.Database,
  skillId: string,
  onlineOnly = true,
): CapabilityCard | null {
  if (!canQueryLocalDb(db)) return null;
  return findLocalBySkillId(db, skillId, onlineOnly);
}

/**
 * Lists local cards for resolver diagnostics/tests.
 */
export function resolveLocalCards(
  db: Database.Database,
  onlineOnly = true,
): CapabilityCard[] {
  if (!canQueryLocalDb(db)) return [];
  const cards = listCards(db);
  return onlineOnly ? cards.filter((c) => c.availability?.online !== false) : cards;
}
