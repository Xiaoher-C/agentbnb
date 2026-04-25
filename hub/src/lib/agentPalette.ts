/**
 * Per-agent colour palette for boring-avatars `beam` variant.
 *
 * Each agent gets a stable 5-colour palette drawn from the semantic system
 * (live / pinned / team / warn / danger / mute + extensions). The palette is
 * used as the `colors` prop on `<Avatar variant="beam" />` — same shape, per-
 * agent hue, so agents are visually distinguishable at a glance.
 *
 * Anchor colour (index 0) is the agent's "identity hue" and also what the
 * presence-dot / hover glow keys off.
 */

export type Palette = readonly [string, string, string, string, string];

/** Known-agent palettes. Keyed by AgentId (see WorkNetwork.tsx for the union). */
const PALETTES: Record<string, Palette> = {
  atlas: ['#0EA5E9', '#7DD3FC', '#0369A1', '#FFFFFF', '#082F49'], // sky
  finch: ['#F59E0B', '#FCD34D', '#B45309', '#FEF3C7', '#78350F'], // amber
  kona: ['#10B981', '#6EE7B7', '#047857', '#A7F3D0', '#064E3B'], // emerald
  juno: ['#8B5CF6', '#C4B5FD', '#6D28D9', '#EDE9FE', '#4C1D95'], // violet
  rhea: ['#F43F5E', '#FDA4AF', '#BE123C', '#FFE4E6', '#881337'], // rose
  vega: ['#06B6D4', '#67E8F9', '#0E7490', '#CFFAFE', '#164E63'], // cyan
  ori: ['#64748B', '#CBD5E1', '#334155', '#F1F5F9', '#1E293B'], // slate
  piper: ['#F97316', '#FDBA74', '#C2410C', '#FFEDD5', '#7C2D12'], // orange
  sable: ['#9333EA', '#C084FC', '#6B21A8', '#F3E8FF', '#3B0764'], // plum
  koda: ['#14B8A6', '#5EEAD4', '#0F766E', '#CCFBF1', '#134E4A'], // teal
};

const FALLBACK_KEYS = Object.keys(PALETTES);

/** Deterministic FNV-1a-ish hash so unknown agents still get a stable palette. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Return the palette for a known agent, or a stable rotation for unknowns. */
export function getAgentPalette(agentId: string): Palette {
  const known = PALETTES[agentId];
  if (known) return known;
  const fallbackKey = FALLBACK_KEYS[hash(agentId) % FALLBACK_KEYS.length] as string;
  return PALETTES[fallbackKey];
}

/** Anchor hue for presence dots, hover glows, and accent bars tied to an agent. */
export function getAgentAnchor(agentId: string): string {
  return getAgentPalette(agentId)[0];
}
