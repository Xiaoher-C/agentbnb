/**
 * CopyButton — reusable copy-to-clipboard button with checkmark feedback.
 *
 * Renders a monospace code span with the text next to a copy icon button.
 * Icon swaps to a green Check for 1500ms after a successful copy.
 */
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
  /** Text to copy to clipboard */
  text: string;
  /** Optional display label (defaults to showing `text`) */
  label?: string;
}

/**
 * Inline copy-to-clipboard component. Wraps the command in a dark pill with
 * a Copy/Check icon button on the right.
 */
export default function CopyButton({ text, label }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      // Clipboard API unavailable — no-op
    }
  };

  return (
    <div className="flex items-center gap-2 bg-black/[0.3] rounded-md px-3 py-2">
      <code className="text-sm font-mono text-emerald-400 flex-1 select-all">
        {label ?? text}
      </code>
      <button
        onClick={() => {
          void handleCopy();
        }}
        className="text-hub-text-muted hover:text-hub-text-primary transition-colors shrink-0"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
