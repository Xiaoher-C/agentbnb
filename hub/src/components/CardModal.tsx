/**
 * CardModal — Detail overlay modal for AgentBnB Hub capability cards.
 *
 * Opens when a capability card is clicked. Shows full card information:
 * identicon, name, owner, description, inputs, outputs, stats, and a CLI
 * code block with a one-click copy button.
 *
 * Behavior:
 * - Backdrop click closes the modal
 * - ESC key closes the modal
 * - Body scroll is locked while the modal is open (iOS-safe position-fixed)
 * - Owner name navigates to /agents/:owner and closes the modal
 * - On mobile, renders as a bottom sheet with drag handle and 44px tap targets
 * - Animates in (scale 0.96→1, opacity 0→1, 200ms ease-out)
 * - Animates out (scale 1→0.96, opacity 1→0, 150ms ease-in)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { inferCategories } from '../lib/categories.js';
import { formatCredits } from '../lib/utils.js';
import type { HubCard, RawSkill } from '../types.js';
import Avatar from './Avatar.js';
import CategoryChip from './CategoryChip.js';
import StatusDot from './StatusDot.js';
import CopyButton from './CopyButton.js';

interface CardModalProps {
  card: HubCard | null;
  onClose: () => void;
}

/**
 * Lock body scroll using the iOS-safe position-fixed technique.
 * Saves current scroll position so it can be restored on unlock.
 */
function lockScroll(): void {
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.dataset.scrollY = String(scrollY);
}

/**
 * Restore body scroll after unlocking.
 * Restores the saved scroll position to prevent jump.
 */
function unlockScroll(): void {
  const scrollY = parseInt(document.body.dataset.scrollY ?? '0', 10);
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  delete document.body.dataset.scrollY;
  window.scrollTo(0, scrollY);
}

/** Expandable skill row used in the agent modal's skills list. */
function SkillRow({ skill }: { skill: RawSkill }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-hub-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-hub-text-primary truncate">{skill.name}</p>
          {skill.description && (
            <p className="text-[11px] text-hub-text-muted mt-0.5 line-clamp-1">{skill.description}</p>
          )}
          {skill.capability_types && skill.capability_types.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {skill.capability_types.map((ct) => (
                <span key={ct} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300/80">
                  {ct}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          <span className="font-mono text-xs text-hub-accent">
            {skill.pricing.credits_per_call > 0
              ? `cr ${skill.pricing.credits_per_call}`
              : 'free'}
          </span>
          <span className="text-hub-text-tertiary text-[10px]">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (skill.inputs.length > 0 || skill.outputs.length > 0) && (
        <div className="px-3 pb-3 border-t border-hub-border/40 pt-2.5 space-y-2">
          {skill.inputs.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-hub-text-muted mb-1">Inputs</p>
              <ul className="space-y-0.5">
                {skill.inputs.map((input) => (
                  <li key={input.name} className="font-mono text-xs text-hub-text-secondary">
                    <span className="text-hub-text-primary">{input.name}</span>
                    <span className="text-hub-text-tertiary">: {input.type}</span>
                    {input.description && <span className="text-hub-text-muted ml-2 font-sans text-[11px]">— {input.description}</span>}
                    {input.required && <span className="text-hub-accent ml-1 text-[10px]">*</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skill.outputs.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-hub-text-muted mb-1">Outputs</p>
              <ul className="space-y-0.5">
                {skill.outputs.map((output) => (
                  <li key={output.name} className="font-mono text-xs text-hub-text-secondary">
                    <span className="text-hub-text-primary">{output.name}</span>
                    <span className="text-hub-text-tertiary">: {output.type}</span>
                    {output.description && <span className="text-hub-text-muted ml-2 font-sans text-[11px]">— {output.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a centered 520px modal overlay with backdrop blur and scale animation.
 * On mobile (< 640px), renders as a full-screen bottom sheet.
 * When card is null, renders nothing.
 *
 * @param card - The card to display, or null to render nothing
 * @param onClose - Callback invoked when the modal should close
 */
export default function CardModal({ card, onClose }: CardModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const navigate = useNavigate();

  // Sync visibility with card prop
  useEffect(() => {
    if (card) {
      setIsVisible(true);
    }
  }, [card]);

  // ESC key handler
  useEffect(() => {
    if (!card) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  // iOS-safe scroll lock using position-fixed technique
  useEffect(() => {
    if (card) {
      lockScroll();
    }
    return () => {
      unlockScroll();
    };
  }, [card]);

  if (!card) return null;

  /** Start close animation then invoke onClose after 150ms. */
  function handleClose() {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 150);
  }

  /** Navigate to owner profile after modal close animation. */
  function handleOwnerClick() {
    handleClose();
    setTimeout(() => {
      navigate(`/agents/${card!.owner}`);
    }, 160);
  }

  const { categories } = inferCategories(card.metadata);
  const online = card.availability.online;
  const successRate = card.metadata?.success_rate;
  const latency = card.metadata?.avg_latency_ms;
  const idleRate = card.metadata?.idle_rate;
  const toSlug = (s: string): string =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const shortId = card.id.slice(0, 8);
  const slug = toSlug(card.name) || 'agent';
  // Clipboard payload is the exact CLI command — no trailing comment. The
  // human-readable slug + short id is rendered separately above the copy pill.
  const cliCommand = `agentbnb request ${card.id}`;

  /** Determine idle rate text color: emerald if > 70% (highly available), yellow if < 30% (busy). */
  function idleRateClass(): string {
    if (idleRate == null) return 'text-hub-text-tertiary';
    if (idleRate > 0.7) return 'text-emerald-400';
    if (idleRate < 0.3) return 'text-yellow-400';
    return 'text-hub-text-tertiary';
  }

  return (
    /* Backdrop overlay — bottom-anchored on mobile, centered on sm+ */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{
        backgroundColor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        transition: isVisible
          ? 'opacity 200ms ease-out'
          : 'opacity 150ms ease-in',
        opacity: isVisible ? 1 : 0,
      }}
      onClick={handleClose}
    >
      {/* Modal panel — bottom sheet on mobile, centered card on sm+ */}
      <div
        className="w-full sm:max-w-[520px] sm:mx-4 rounded-t-modal sm:rounded-modal p-8 overflow-y-auto max-h-[90vh] sm:max-h-[85vh]"
        style={{
          backgroundColor: '#111117',
          border: '1px solid rgba(255,255,255,0.08)',
          transition: isVisible
            ? 'transform 200ms ease-out, opacity 200ms ease-out'
            : 'transform 150ms ease-in, opacity 150ms ease-in',
          transform: isVisible ? 'scale(1)' : 'scale(0.96)',
          opacity: isVisible ? 1 : 0,
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Drag handle — mobile only */}
        <div className="flex justify-center pt-0 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Close button (top-right X) — 44px tap target on mobile */}
        <div className="flex justify-end mb-4">
          <button
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-hub-text-tertiary hover:text-hub-text-primary transition-colors text-lg leading-none"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Header: 48px identicon + name/owner/status */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <Avatar agentId={card.id} size={48} name={card.name} />
          </div>
          <div className="flex-1 min-w-0">
            {/* Name row + tier badge */}
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[18px] font-semibold text-hub-text-primary leading-tight truncate">
                {card.name}
              </h2>
              {(() => {
                const tiers = {
                  0: { label: 'Listed',  cls: 'text-hub-text-muted border-hub-border/60' },
                  1: { label: 'Active',  cls: 'text-blue-400 border-blue-400/25' },
                  2: { label: 'Trusted', cls: 'text-emerald-400 border-emerald-400/25' },
                } as const;
                const t = tiers[card.performance_tier ?? 0];
                return (
                  <span className={`flex-shrink-0 text-[10px] font-medium border rounded px-1.5 py-0.5 ${t.cls}`}>
                    {t.label}
                  </span>
                );
              })()}
            </div>
            {/* Owner row + authority source */}
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <button
                onClick={handleOwnerClick}
                className="text-[13px] text-hub-accent hover:underline text-left"
              >
                @{card.owner}
              </button>
              <span className={`flex-shrink-0 text-[10px] ${
                card.authority_source === 'platform' ? 'text-blue-400/70' :
                card.authority_source === 'org' ? 'text-violet-400/70' :
                'text-hub-text-muted'
              }`}>
                {card.authority_source === 'platform' ? 'Platform observed' :
                 card.authority_source === 'org' ? 'Org-backed' :
                 'Self-declared'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs text-hub-text-secondary">
                <StatusDot online={online} />
                {online ? 'Online' : 'Offline'}
                {/* Idle rate — only shown when online and idle_rate is available */}
                {online && idleRate != null && (
                  <span className={`text-xs ml-1 ${idleRateClass()}`}>
                    · Idle {Math.round(idleRate * 100)}%
                  </span>
                )}
              </span>
              <div className="flex flex-wrap gap-1">
                {categories.map((cat) => (
                  <CategoryChip key={cat.id} category={cat} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Pricing badge — prominent display */}
        <div className="mt-5 flex items-center gap-3">
          <div className="inline-flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/25 rounded-lg px-4 py-2">
            <span className="text-lg font-bold font-mono text-emerald-400">
              {card.pricing.credits_per_call}
            </span>
            <span className="text-xs text-emerald-400/80">
              credits/call
            </span>
          </div>
          {card.pricing.free_tier !== undefined && card.pricing.free_tier > 0 && (
            <div className="inline-flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
              <span className="text-sm font-semibold font-mono text-blue-400">
                {card.pricing.free_tier}
              </span>
              <span className="text-xs text-blue-400/80">free/mo</span>
            </div>
          )}
        </div>

        {/* Description */}
        <p className="text-[14px] text-hub-text-secondary mt-4 leading-relaxed">
          {card.description}
        </p>

        {/* Capability Types */}
        {card.capability_types && card.capability_types.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
              Capability Types
            </p>
            <div className="flex flex-wrap gap-1.5">
              {card.capability_types.map((ct) => (
                <span
                  key={ct}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-300"
                >
                  {ct}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Depends On */}
        {card.requires_capabilities && card.requires_capabilities.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
              Depends On
            </p>
            <div className="flex flex-wrap gap-1.5">
              {card.requires_capabilities.map((rc) => (
                <span
                  key={rc}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300"
                >
                  {rc}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Agent modal: skills list (dual-layer) vs flat inputs/outputs (skill modal) */}
        {card.skills && card.skills.length > 0 ? (
          <div className="mt-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
              Skills ({card.skills.length})
            </p>
            <div className="space-y-2">
              {card.skills.map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Inputs */}
            {card.inputs.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
                  Inputs
                </p>
                <ul className="space-y-1">
                  {card.inputs.map((input) => (
                    <li key={input.name} className="font-mono text-sm text-hub-text-secondary">
                      <span className="text-hub-text-primary">{input.name}</span>
                      <span className="text-hub-text-tertiary">: {input.type}</span>
                      {input.description && (
                        <span className="text-hub-text-muted ml-2 font-sans text-xs">
                          — {input.description}
                        </span>
                      )}
                      {input.required && (
                        <span className="text-hub-accent ml-1 text-xs">*</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Outputs */}
            {card.outputs.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
                  Outputs
                </p>
                <ul className="space-y-1">
                  {card.outputs.map((output) => (
                    <li key={output.name} className="font-mono text-sm text-hub-text-secondary">
                      <span className="text-hub-text-primary">{output.name}</span>
                      <span className="text-hub-text-tertiary">: {output.type}</span>
                      {output.description && (
                        <span className="text-hub-text-muted ml-2 font-sans text-xs">
                          — {output.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Stats */}
        <div className="mt-5 flex flex-wrap gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted">
              Cost
            </p>
            <p className="font-mono text-sm text-hub-accent">
              {formatCredits(card.pricing)}
            </p>
          </div>
          {card.pricing.free_tier !== undefined && card.pricing.free_tier > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted">
                Free Tier
              </p>
              <p className="font-mono text-sm text-hub-accent">
                {card.pricing.free_tier}/mo
              </p>
            </div>
          )}
          {successRate !== undefined && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted">
                Success Rate
              </p>
              <p className="font-mono text-sm text-hub-text-secondary">
                {Math.round(successRate * 100)}%
              </p>
            </div>
          )}
          {latency !== undefined && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted">
                Avg Latency
              </p>
              <p className="font-mono text-sm text-hub-text-secondary">
                {latency}ms
              </p>
            </div>
          )}
        </div>

        {/* Request this skill — CopyButton with CLI command */}
        <div className="mt-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
            Request this skill
          </p>
          <p className="text-[11px] font-mono text-hub-text-muted mb-1">
            {slug} · <span className="opacity-80">{shortId}</span>
          </p>
          <CopyButton text={cliCommand} />
        </div>
      </div>
    </div>
  );
}
