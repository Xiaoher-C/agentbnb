/**
 * CategoryChip — Icon + label chip for a single capability category.
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
 *
 * @param category - The category to display
 * @param overflowCount - If provided, renders an overflow "+N more" chip instead
 */
export default function CategoryChip({ category, overflowCount }: CategoryChipProps) {
  if (overflowCount !== undefined && overflowCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700 text-xs text-slate-400">
        +{overflowCount} more
      </span>
    );
  }

  const IconComponent = ICON_COMPONENTS[category.iconName] ?? Puzzle;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700 text-xs text-slate-300">
      <IconComponent size={12} />
      {category.label}
    </span>
  );
}
