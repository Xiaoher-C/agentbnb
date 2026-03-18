/**
 * CardGrid — Responsive CSS grid container for capability cards.
 * Auto-fill with min 280px columns — adapts to screen width with no fixed column count.
 * Uses align-items: start to prevent row height stretching.
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
      {children}
    </div>
  );
}
