/**
 * OverlayToggle — switches the canvas between three decoration modes.
 *
 * The overlays are intentionally *switchable*, not stackable: mixing risk
 * badges with provenance tints on the same surface muddies both signals.
 * The plan treats Risk and Provenance as independent layers because they
 * answer different questions ("is the author making a claim we can't trust"
 * vs. "do we know where this skill came from"), so we keep them separated.
 */
import type { OverlayMode } from './nodes/BaseNode.js';

interface OverlayToggleProps {
  value: OverlayMode;
  onChange: (mode: OverlayMode) => void;
}

const OPTIONS: Array<{ value: OverlayMode; label: string; hint: string }> = [
  { value: 'none', label: 'Flow', hint: 'Just the node graph' },
  { value: 'risk', label: 'Risk', hint: 'Heuristic risk findings per node' },
  { value: 'provenance', label: 'Provenance', hint: 'Where this skill came from' },
];

export default function OverlayToggle({ value, onChange }: OverlayToggleProps): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Overlay layer"
      className="inline-flex rounded-lg border border-hub-border bg-hub-surface p-0.5 text-xs"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => { onChange(opt.value); }}
            title={opt.hint}
            className={[
              'rounded-md px-3 py-1 font-medium transition-colors',
              active
                ? 'bg-hub-accent/20 text-hub-accent'
                : 'text-hub-text-secondary hover:text-hub-text-primary',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
