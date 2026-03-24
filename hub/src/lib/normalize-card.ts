/**
 * normalizeCard — Flattens a raw API card into HubCard[].
 *
 * v2.0 cards have a nested skills[] array — each skill becomes its own HubCard.
 * v1.0 cards pass through unchanged.
 *
 * Shared between useCards (Discover grid) and useAgents (Profile skills list)
 * so both display the same flat shape.
 */
import type { HubCard } from '../types.js';

export function normalizeCard(raw: Record<string, unknown>, usesMap?: Record<string, number>): HubCard[] {
  // v2.0 card with skills[] array — one HubCard per skill
  if (raw.skills && Array.isArray(raw.skills) && raw.skills.length > 0) {
    return (raw.skills as Record<string, unknown>[]).map((skill) => {
      const skillId = (skill.id as string) || (raw.id as string);
      return {
        id: skillId,
        owner: raw.owner as string,
        name: (skill.name as string) || (raw.name as string) || 'Unknown',
        description: (skill.description as string) || '',
        level: (skill.level as 1 | 2 | 3) || 1,
        inputs: (skill.inputs as HubCard['inputs']) || [],
        outputs: (skill.outputs as HubCard['outputs']) || [],
        pricing: (skill.pricing as HubCard['pricing']) || { credits_per_call: 0 },
        availability:
          (skill.availability as HubCard['availability']) ||
          (raw.availability as HubCard['availability']) ||
          { online: false },
        powered_by:
          (skill.powered_by as HubCard['powered_by']) ||
          (raw.powered_by as HubCard['powered_by']),
        metadata:
          (skill.metadata as HubCard['metadata']) ||
          (raw.metadata as HubCard['metadata']),
        uses_this_week: usesMap?.[skillId] ?? usesMap?.[raw.id as string] ?? undefined,
        // Pass through owner-level trust summary injected by /cards API
        performance_tier: raw.performance_tier as HubCard['performance_tier'],
        authority_source: raw.authority_source as HubCard['authority_source'],
        capability_types: skill.capability_types as HubCard['capability_types'],
        requires_capabilities: skill.requires_capabilities as HubCard['requires_capabilities'],
      };
    });
  }
  // v1.0 card — already in HubCard shape
  const card = raw as unknown as HubCard;
  return [{
    ...card,
    uses_this_week: usesMap?.[card.id] ?? undefined,
    performance_tier: (raw.performance_tier as HubCard['performance_tier']) ?? card.performance_tier,
    authority_source: (raw.authority_source as HubCard['authority_source']) ?? card.authority_source,
  }];
}
