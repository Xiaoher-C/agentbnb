/**
 * GetStartedCTA — Call-to-action button for unauthenticated visitors.
 *
 * Shows "Get Started — 50 free credits" button that opens a tooltip/popover
 * with the CLI command to get started. Includes a copy button.
 * Closes when clicking outside.
 */
import { useState, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';

const CLI_COMMAND = 'npx agentbnb init';

/**
 * CTA button for unauthenticated visitors. Shows a popover with
 * the agentbnb init command and a copy button on click.
 */
export default function GetStartedCTA(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on click outside
  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1500);
    } catch {
      // Clipboard API unavailable — no-op
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen((prev) => !prev); }}
        className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-400 transition-colors"
      >
        Get Started — 50 free credits
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 bg-hub-surface border border-white/[0.08] rounded-lg px-4 py-3 z-50 min-w-[260px] shadow-lg">
          <p className="text-xs text-hub-text-muted mb-2">Run this command to get started:</p>
          <div className="flex items-center gap-2 bg-black/[0.3] rounded-md px-3 py-2">
            <code className="text-sm font-mono text-emerald-400 flex-1 select-all">{CLI_COMMAND}</code>
            <button
              onClick={() => { void handleCopy(); }}
              className="text-hub-text-muted hover:text-hub-text-primary transition-colors shrink-0"
              title="Copy command"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
