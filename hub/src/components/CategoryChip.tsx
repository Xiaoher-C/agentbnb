/**
 * CategoryChip — Icon + label chip for a single capability category.
 * Ghost style: transparent bg, subtle border, rounded-full pill shape.
 * Also handles overflow display as "+N more" chip.
 */
import {
  Volume2, Mic, Image, Film, FileText, Code, GitPullRequest,
  Languages, BarChart3, Megaphone, Music, Scissors, Cpu, Search, Puzzle,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from '../types.js';

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Volume2, Mic, Image, Film, FileText, Code, GitPullRequest,
  Languages, BarChart3, Megaphone, Music, Scissors, Cpu, Search, Puzzle,
};

interface CategoryChipProps {
  category: Category;
  overflowCount?: number;
}

/**
 * Renders a category chip with icon and label, or an overflow "+N more" chip.
 * Uses ghost style: transparent background with border-hub-border-hover border.
 *
 * @param category - The category to display
 * @param overflowCount - If provided, renders an overflow "+N more" chip instead
 */
export default function CategoryChip({ category, overflowCount }: CategoryChipProps) {
  if (overflowCount !== undefined && overflowCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-hub-border-hover bg-transparent text-xs text-hub-text-secondary">
        +{overflowCount} more
      </span>
    );
  }

  const IconComponent = ICON_COMPONENTS[category.iconName] ?? Puzzle;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-hub-border-hover bg-transparent text-xs text-hub-text-secondary">
      <IconComponent size={12} />
      {category.label}
    </span>
  );
}
