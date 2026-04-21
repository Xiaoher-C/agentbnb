import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  parseSkill,
  scoreRisks,
  lookupProvenance,
  applyProvenance,
  extractFrontmatter,
  listRules,
  type SkillGraph,
  type SkillMetadata,
  type ProvenanceState,
} from '@agentbnb/skill-inspector';
import { scanAgents, getOpenClawWorkspaceDir } from '../workspace/scanner.js';

/** Options for skillRoutesPlugin — read-only inspector needs registry DB only as the canonical handle. */
export interface SkillRoutesOptions {
  registryDb: Database.Database;
}

interface DiscoverySource {
  kind: 'agent' | 'workspace' | 'claude-global';
  label: string;
  skillsRoot: string;
}

interface ListedSkill {
  skillId: string;
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  source: 'skill_md';
  provenanceState: ProvenanceState;
  gitSha?: string;
  version?: string;
  installSource?: string;
  loadedBy: string[];
}

/** Stable opaque id derived from canonical path — doubles as the traversal guard. */
function skillIdFor(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 16);
}

function collectSources(): DiscoverySource[] {
  const sources: DiscoverySource[] = [];
  for (const agent of scanAgents()) {
    if (!agent.brainDir) continue;
    sources.push({
      kind: 'agent',
      label: `agent:${agent.name}`,
      skillsRoot: join(agent.brainDir, 'skills'),
    });
  }
  const wsDir = getOpenClawWorkspaceDir();
  const wsSkills = join(wsDir, 'skills');
  if (existsSync(wsSkills)) {
    sources.push({ kind: 'workspace', label: 'workspace', skillsRoot: wsSkills });
  }
  const claudeSkills = join(homedir(), '.claude', 'skills');
  if (existsSync(claudeSkills)) {
    sources.push({ kind: 'claude-global', label: 'claude-global', skillsRoot: claudeSkills });
  }
  return sources;
}

/** Returns absolute path to a SKILL.md inside a skill directory, or null if missing. */
function resolveSkillMd(skillsRoot: string, dirName: string): string | null {
  const candidate = join(skillsRoot, dirName, 'SKILL.md');
  if (existsSync(candidate)) return candidate;
  return null;
}

function readSkillDirEntries(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  try {
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function canonicalOrOriginal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Discover every SKILL.md reachable from the configured sources, deduplicated by
 * canonical (symlink-resolved) path. `loadedBy` accumulates every discoverer so
 * cross-agent shares surface as `loadedBy.length > 1`.
 */
function discoverSkills(): ListedSkill[] {
  const byCanonical = new Map<string, ListedSkill>();

  for (const source of collectSources()) {
    for (const dirName of readSkillDirEntries(source.skillsRoot)) {
      const absPath = resolveSkillMd(source.skillsRoot, dirName);
      if (!absPath) continue;
      const canonical = canonicalOrOriginal(absPath);

      let entry = byCanonical.get(canonical);
      if (!entry) {
        const body = safeReadFile(canonical);
        if (!body) continue;
        const { frontmatter } = extractFrontmatter(body);
        const prov = lookupProvenance(canonical);
        entry = {
          skillId: skillIdFor(canonical),
          name: (frontmatter.name ?? dirName).trim(),
          description: (frontmatter.description ?? '').trim(),
          path: absPath,
          canonicalPath: canonical,
          source: 'skill_md',
          provenanceState: prov.provenanceState,
          loadedBy: [],
        };
        if (frontmatter.version) entry.version = frontmatter.version;
        if (prov.gitSha) entry.gitSha = prov.gitSha;
        if (prov.installSource) entry.installSource = prov.installSource;
        byCanonical.set(canonical, entry);
      }
      if (!entry.loadedBy.includes(source.label)) {
        entry.loadedBy.push(source.label);
      }
    }
  }

  return Array.from(byCanonical.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function toSkillMetadata(entry: ListedSkill): SkillMetadata {
  const metadata: SkillMetadata = {
    name: entry.name,
    description: entry.description,
    path: entry.path,
    source: entry.source,
    provenanceState: entry.provenanceState,
    loadedBy: [...entry.loadedBy],
  };
  if (entry.version) metadata.version = entry.version;
  if (entry.gitSha) metadata.gitSha = entry.gitSha;
  if (entry.installSource) metadata.installSource = entry.installSource;
  return metadata;
}

/**
 * Fastify plugin that registers read-only Skill Inspector endpoints.
 *
 *   GET /api/skills                        — Discovered skills with full metadata
 *   GET /api/skills/rules                  — Available risk rules with defaults
 *   GET /api/skills/:skillId/inspect       — Parse + score one skill
 *   GET /api/skills/:skillId/raw           — Raw SKILL.md source (text/markdown)
 *
 * All three skill-scoped routes validate :skillId against the live discovered-skill
 * map — the map itself is the path-traversal guard; :skillId is an opaque sha256
 * prefix of the canonical path and cannot be constructed to point at an arbitrary
 * file. Unknown ids 404.
 *
 * The endpoints are intentionally public (matching sibling read-only plugins such
 * as activityRoutesPlugin). They are localhost-bound in daemon mode and the data
 * surfaced is already present on the developer's own filesystem. The expensive
 * /inspect route carries its own per-route rate limit on top of the global cap.
 */
export async function skillRoutesPlugin(
  fastify: FastifyInstance,
  _options: SkillRoutesOptions,
): Promise<void> {
  fastify.get('/api/skills', {
    schema: {
      tags: ['system'],
      summary: 'List discovered SKILL.md files with provenance and loadedBy',
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            items: { type: 'array' },
            total: { type: 'integer' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const items = discoverSkills().map(toExternalEntry);
    return reply.send({ items, total: items.length });
  });

  fastify.get('/api/skills/rules', {
    schema: {
      tags: ['system'],
      summary: 'List available risk rules and default-enabled state',
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            rules: { type: 'array' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({ rules: listRules() });
  });

  fastify.get('/api/skills/:skillId/inspect', {
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['system'],
      summary: 'Parse SKILL.md into a node graph and score risks',
      params: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId'],
      },
      querystring: {
        type: 'object',
        properties: {
          rules: {
            type: 'string',
            description: 'Comma-separated list of risk rule ids to enable (overrides defaults). Prefix a rule with "!" to disable it.',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            graph: { type: 'object', additionalProperties: true },
            risks: { type: 'object', additionalProperties: true },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { skillId } = request.params as { skillId: string };
    const entry = findDiscovered(skillId);
    if (!entry) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const body = safeReadFile(entry.canonicalPath);
    if (body === null) {
      return reply.code(500).send({ error: 'Skill source is unreadable' });
    }

    let graph: SkillGraph;
    try {
      graph = parseSkill(body, {
        path: entry.path,
        source: entry.source,
        skillId: entry.skillId,
        loadedBy: entry.loadedBy,
        provenanceState: entry.provenanceState,
        ...(entry.gitSha ? { gitSha: entry.gitSha } : {}),
        ...(entry.installSource ? { installSource: entry.installSource } : {}),
      });
    } catch (err) {
      request.log.error({ err, skillId }, 'parseSkill failed');
      return reply.code(500).send({ error: 'Skill parse failed' });
    }

    graph.metadata = applyProvenance(toSkillMetadata(entry), {
      provenanceState: entry.provenanceState,
      ...(entry.gitSha ? { gitSha: entry.gitSha } : {}),
      ...(entry.installSource ? { installSource: entry.installSource } : {}),
    });

    const enabledRules = parseRuleOverrides(request.query as Record<string, string | undefined>);
    const risks = scoreRisks(graph, enabledRules ? { enabledRules } : {});

    return reply.send({ graph, risks });
  });

  fastify.get('/api/skills/:skillId/raw', {
    schema: {
      tags: ['system'],
      summary: 'Serve raw SKILL.md source (text/markdown)',
      params: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId'],
      },
      response: {
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { skillId } = request.params as { skillId: string };
    const entry = findDiscovered(skillId);
    if (!entry) {
      return reply.code(404).send({ error: 'Skill not found' });
    }
    const body = safeReadFile(entry.canonicalPath);
    if (body === null) {
      return reply.code(500).send({ error: 'Skill source is unreadable' });
    }
    reply.type('text/markdown; charset=utf-8');
    return reply.send(body);
  });
}

/** Runs a fresh discovery pass and returns the entry matching skillId, if any. */
function findDiscovered(skillId: string): ListedSkill | undefined {
  return discoverSkills().find((entry) => entry.skillId === skillId);
}

/** Strip canonicalPath before returning to clients — the sha256 skillId is the stable handle. */
function toExternalEntry(entry: ListedSkill): Omit<ListedSkill, 'canonicalPath'> {
  const { canonicalPath: _canonicalPath, ...rest } = entry;
  void _canonicalPath;
  return rest;
}

/**
 * Parse a `rules=foo,!bar` query string into an override map suitable for scoreRisks.
 * Returns undefined when the caller did not pass a `rules` param — letting scoreRisks
 * fall back to each rule's defaultEnabled.
 */
function parseRuleOverrides(
  query: Record<string, string | undefined>,
): Record<string, boolean> | undefined {
  const raw = typeof query.rules === 'string' ? query.rules.trim() : '';
  if (!raw) return undefined;
  const overrides: Record<string, boolean> = {};
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('!')) {
      overrides[trimmed.slice(1)] = false;
    } else {
      overrides[trimmed] = true;
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
