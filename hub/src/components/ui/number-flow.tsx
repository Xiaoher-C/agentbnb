import NumberFlow, { type Format } from '@number-flow/react';
import { cn } from '../../lib/cn.js';

export interface NumberFlowCellProps {
  /** The numeric value to animate to */
  value: number;
  /** Optional CSS class name for custom styling */
  className?: string;
  /** Number formatting options (subset of Intl.NumberFormatOptions) */
  format?: Format;
}

/**
 * Animated number transition component.
 * Wraps @number-flow/react with Hub-compatible styling defaults.
 * Numbers smoothly animate between values with a 700ms ease-out transition.
 */
export function NumberFlowCell({
  value,
  className,
  format,
}: NumberFlowCellProps): JSX.Element {
  return (
    <NumberFlow
      value={value}
      className={cn('font-mono tabular-nums', className)}
      transformTiming={{ duration: 700, easing: 'ease-out' }}
      format={format ?? { useGrouping: true, minimumIntegerDigits: 1 }}
    />
  );
}
