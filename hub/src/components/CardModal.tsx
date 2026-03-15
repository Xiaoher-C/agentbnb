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
 * - Body scroll is locked while the modal is open
 * - Animates in (scale 0.96→1, opacity 0→1, 200ms ease-out)
 * - Animates out (scale 1→0.96, opacity 1→0, 150ms ease-in)
 */
import { useEffect, useState } from 'react';
import Avatar from 'boring-avatars';
import { inferCategories } from '../lib/categories.js';
import { formatCredits } from '../lib/utils.js';
import type { HubCard } from '../types.js';
import CategoryChip from './CategoryChip.js';
import StatusDot from './StatusDot.js';

interface CardModalProps {
  card: HubCard | null;
  onClose: () => void;
}

/**
 * Renders a centered 520px modal overlay with backdrop blur and scale animation.
 * When card is null, renders nothing.
 *
 * @param card - The card to display, or null to render nothing
 * @param onClose - Callback invoked when the modal should close
 */
export default function CardModal({ card, onClose }: CardModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Body scroll lock
  useEffect(() => {
    if (card) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
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

  const { categories } = inferCategories(card.metadata);
  const online = card.availability.online;
  const successRate = card.metadata?.success_rate;
  const latency = card.metadata?.avg_latency_ms;
  const cliCommand = `agentbnb request ${card.id}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard write failed — silently ignore
    }
  }

  return (
    /* Backdrop overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
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
      {/* Modal panel */}
      <div
        className="max-w-[520px] w-full mx-4 rounded-modal p-8 overflow-y-auto"
        style={{
          backgroundColor: '#111117',
          border: '1px solid rgba(255,255,255,0.08)',
          maxHeight: '85vh',
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
        {/* Close button (top-right X) */}
        <div className="flex justify-end mb-4">
          <button
            onClick={handleClose}
            className="text-hub-text-tertiary hover:text-hub-text-primary transition-colors text-lg leading-none"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Header: 48px identicon + name/owner/status */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <Avatar size={48} name={card.id} variant="beam" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[18px] font-semibold text-hub-text-primary leading-tight">
              {card.name}
            </h2>
            <p className="text-[14px] text-hub-text-tertiary mt-0.5">
              @{card.owner}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs text-hub-text-secondary">
                <StatusDot online={online} />
                {online ? 'Online' : 'Offline'}
              </span>
              <div className="flex flex-wrap gap-1">
                {categories.map((cat) => (
                  <CategoryChip key={cat.id} category={cat} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-[14px] text-hub-text-secondary mt-5 leading-relaxed">
          {card.description}
        </p>

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

        {/* CLI code block */}
        <div className="mt-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-hub-text-muted mb-2">
            Request via CLI
          </p>
          <div
            className="flex items-center justify-between gap-3 rounded-lg px-4 py-3"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <code className="font-mono text-sm text-hub-text-secondary break-all">
              {cliCommand}
            </code>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 text-xs text-hub-text-tertiary hover:text-hub-text-primary transition-colors px-2 py-1 rounded border border-transparent hover:border-hub-border"
              aria-label="Copy CLI command"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
