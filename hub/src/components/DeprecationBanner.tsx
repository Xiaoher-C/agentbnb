/**
 * DeprecationBanner — Amber banner shown atop legacy v10 hub pages.
 *
 * v10 reframed AgentBnB from "skill marketplace" to Agent Maturity Rental
 * (ADR-022 / ADR-023). Several pre-v10 surfaces remain accessible by direct
 * URL but should announce themselves as legacy and point at the v10
 * replacement. Use this component for that.
 *
 * The shape mirrors the inline banner originally introduced on
 * `routes/SkillsInspector.tsx` (PR #73) — extracted here so multiple
 * legacy pages stay visually consistent.
 */
import type { ReactNode } from 'react';

export interface DeprecationBannerProps {
  /**
   * Lead-in label rendered in semibold amber. Defaults to "Deprecated as of v10."
   */
  label?: string;
  /**
   * Body copy describing what the page used to be and what replaces it.
   * Free-form — may contain JSX (links, inline emphasis).
   */
  message: ReactNode;
  /**
   * Optional href for an inline "go to replacement" link rendered after the
   * message. Defaults to the v10 Discover surface.
   */
  replacementHref?: string;
  /**
   * Label for the replacement link. Required when `replacementHref` is set.
   */
  replacementLabel?: string;
}

/**
 * Amber notice rendered at the top of legacy hub pages. Marks the surface as
 * v10-deprecated and (optionally) links to the replacement page.
 */
export default function DeprecationBanner({
  label = 'Deprecated as of v10.',
  message,
  replacementHref,
  replacementLabel,
}: DeprecationBannerProps): JSX.Element {
  return (
    <div
      role="status"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] text-amber-100"
    >
      <strong className="font-semibold text-amber-50">{label}</strong>{' '}
      {message}
      {replacementHref && replacementLabel ? (
        <>
          {' '}
          <a
            className="underline decoration-dotted underline-offset-2"
            href={replacementHref}
          >
            {replacementLabel}
          </a>
        </>
      ) : null}
    </div>
  );
}
