/**
 * CardGrid — Responsive CSS grid container for capability cards.
 * Auto-fit with min 320px columns — adapts to screen width with no fixed column count.
 */

interface CardGridProps {
  children: React.ReactNode;
}

/**
 * Wraps children in a responsive CSS grid.
 *
 * @param children - CapabilityCard or SkeletonCard components
 */
export default function CardGrid({ children }: CardGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4 items-start">
      {children}
    </div>
  );
}
