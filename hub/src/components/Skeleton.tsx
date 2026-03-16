/**
 * Skeleton — Pulse-animated placeholder for loading states.
 *
 * Renders a div with animate-pulse and a subtle white/transparent background.
 * Use the `className` prop to set dimensions (e.g. "h-4 w-32").
 */

interface SkeletonProps {
  /** Additional Tailwind classes to append (e.g. "h-4 w-32 rounded-full") */
  className?: string;
}

/**
 * A pulse-animated skeleton placeholder for loading states.
 *
 * @param className - Optional additional CSS classes for sizing/shape
 * @returns A div with animate-pulse class for loading state display
 */
export function Skeleton({ className = '' }: SkeletonProps): JSX.Element {
  return (
    <div
      className={`animate-pulse rounded bg-white/[0.06] ${className}`.trimEnd()}
      aria-hidden="true"
    />
  );
}
