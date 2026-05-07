/**
 * Avatar — canonical agent avatar for the Hub.
 *
 * v10 Agent Maturity Rental cleanup: every agent avatar in the Hub renders
 * through this component so the visual treatment stays consistent. We picked
 * the `marble` variant from `boring-avatars` as the canonical shape — it reads
 * as a polished identicon that pairs cleanly with the dark SaaS surface.
 * `beam` looks more cartoonish in our context and is reserved for the network
 * map (`WorkNetwork.tsx`) where colour-coded silhouettes carry different
 * semantics.
 *
 * Props:
 *   - `agentId` (required) — used as the seed so the avatar is stable across
 *     sessions. Pass the canonical `agent_id` (post-G1 PR #78) when available,
 *     otherwise the owner DID is acceptable.
 *   - `size` (default 48) — pixel size. Pick from the standard tiers
 *     (24 / 32 / 48 / 64 / 96) so stacks line up.
 *   - `name` — accessible label rendered as `aria-label`. Defaults to "Agent
 *     {agentId}".
 *   - `variant` — falls back to `marble`; pass `beam` only for surfaces that
 *     intentionally key off the older silhouette (network map, status bubbles).
 *   - `colors` — palette override. Defaults to the v10 emerald palette so all
 *     unbranded agents share the same identity tone. Pass a role palette for
 *     renter/owner role-coded surfaces (see `RENTER_AVATAR_PALETTE` /
 *     `OWNER_AVATAR_PALETTE`).
 *   - `src` — optional image URL. When provided, renders `<img>` instead of
 *     the procedural avatar so future avatar uploads can drop in without
 *     touching the call sites.
 *   - `className` — extra classes for the wrapper element.
 */
import BoringAvatar from 'boring-avatars';

/** Canonical avatar variant. `marble` is the v10 default. */
export type AvatarVariant = 'marble' | 'beam';

/**
 * Default palette for unbranded agents — derived from the v10 emerald accent
 * (`hub-accent` = `#10B981`). Five stops give boring-avatars enough contrast
 * to render without looking flat.
 */
export const DEFAULT_AGENT_PALETTE = [
  '#10B981', // emerald 500 (hub-accent)
  '#34D399', // emerald 400
  '#0F766E', // teal 700 (depth anchor)
  '#A7F3D0', // emerald 200 (highlight)
  '#064E3B', // emerald 900 (shadow)
] as const;

/**
 * Role palette for the renter side of a session (renter human / renter agent).
 * Same emerald hue family but with brighter highlights so role-coded panels
 * still read at a glance.
 */
export const RENTER_AVATAR_PALETTE = [
  '#10B981',
  '#34D399',
  '#6EE7B7',
  '#A7F3D0',
  '#D1FAE5',
] as const;

/**
 * Role palette for the rented agent (owner side of a session). Violet anchor
 * keeps it visually distinct from the renter while still feeling premium.
 */
export const OWNER_AVATAR_PALETTE = [
  '#8B5CF6',
  '#A78BFA',
  '#C4B5FD',
  '#DDD6FE',
  '#EDE9FE',
] as const;

interface AvatarProps {
  /** Stable seed for the procedural avatar. Required. */
  agentId: string;
  /** Pixel size. Defaults to 48. Use the standard tiers (24/32/48/64/96). */
  size?: number;
  /** Accessible label. Defaults to "Agent {agentId}". */
  name?: string;
  /** Visual variant. Defaults to `marble` (v10 canonical). */
  variant?: AvatarVariant;
  /** Optional palette override (5 colours). Defaults to {@link DEFAULT_AGENT_PALETTE}. */
  colors?: readonly string[];
  /**
   * Optional image source. When provided, renders an `<img>` instead of the
   * procedural avatar so callers can drop in real uploads later without
   * changing the surrounding markup.
   */
  src?: string;
  /** Extra classes for the wrapper element. */
  className?: string;
}

/**
 * Render a stable agent avatar. Falls through to a procedural identicon when
 * `src` is omitted, otherwise renders the supplied image.
 */
export default function Avatar({
  agentId,
  size = 48,
  name,
  variant = 'marble',
  colors = DEFAULT_AGENT_PALETTE,
  src,
  className,
}: AvatarProps): JSX.Element {
  const label = name ?? `Agent ${agentId}`;

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className ?? ''}`}
      />
    );
  }

  // boring-avatars types `colors` as a mutable `string[]`, so spread the
  // palette to satisfy the signature without giving up the readonly source.
  return (
    <span className={`inline-flex shrink-0 ${className ?? ''}`} aria-label={label} role="img">
      <BoringAvatar size={size} name={agentId} variant={variant} colors={[...colors]} />
    </span>
  );
}
