/**
 * SearchFilter — Search input, sort dropdown, and filter controls for the hub page.
 * Ghost style: transparent backgrounds with subtle borders and hub-* design tokens.
 */
import { Search } from 'lucide-react';
import type { Category, SortOption } from '../types.js';

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rated', label: 'Highest Rated' },
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'newest', label: 'Newest' },
];

interface SearchFilterProps {
  query: string;
  onQueryChange: (q: string) => void;
  level: number | null;
  onLevelChange: (l: number | null) => void;
  category: string | null;
  onCategoryChange: (c: string | null) => void;
  onlineOnly: boolean;
  onOnlineOnlyChange: (v: boolean) => void;
  availableCategories: Category[];
  sort: SortOption;
  onSortChange: (s: SortOption) => void;
}

/**
 * Renders ghost-style search input, sort/level/category dropdowns, and online-only toggle.
 * Full-width 48px search bar with rounded-xl ghost style.
 */
export default function SearchFilter({
  query,
  onQueryChange,
  level,
  onLevelChange,
  category,
  onCategoryChange,
  onlineOnly,
  onOnlineOnlyChange,
  availableCategories,
  sort,
  onSortChange,
}: SearchFilterProps) {
  return (
    <div className="mb-6">
      {/* Search input — full width, 48px, ghost style */}
      <div className="relative flex items-center w-full">
        <Search
          size={16}
          className="absolute left-4 text-hub-text-tertiary pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search skills, agents, or categories..."
          className="w-full bg-transparent border border-hub-border rounded-xl pl-10 pr-4 h-12 text-hub-text-primary placeholder:text-hub-text-tertiary focus:outline-none focus:border-hub-border-hover focus:ring-1 focus:ring-hub-border-hover transition-colors"
        />
      </div>

      {/* Filter row below search */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {/* Sort dropdown */}
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="bg-transparent border border-hub-border rounded-lg px-3 h-10 text-sm text-hub-text-secondary focus:outline-none focus:border-hub-border-hover focus:ring-1 focus:ring-hub-border-hover transition-colors appearance-none cursor-pointer"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Level dropdown */}
        <select
          value={level ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onLevelChange(val === '' ? null : Number(val));
          }}
          className="bg-transparent border border-hub-border rounded-lg px-3 h-10 text-sm text-hub-text-secondary focus:outline-none focus:border-hub-border-hover focus:ring-1 focus:ring-hub-border-hover transition-colors appearance-none cursor-pointer"
        >
          <option value="">All Levels</option>
          <option value="1">L1 Atomic</option>
          <option value="2">L2 Pipeline</option>
          <option value="3">L3 Environment</option>
        </select>

        {/* Category dropdown */}
        <select
          value={category ?? ''}
          onChange={(e) => onCategoryChange(e.target.value === '' ? null : e.target.value)}
          className="bg-transparent border border-hub-border rounded-lg px-3 h-10 text-sm text-hub-text-secondary focus:outline-none focus:border-hub-border-hover focus:ring-1 focus:ring-hub-border-hover transition-colors appearance-none cursor-pointer disabled:opacity-40"
          disabled={availableCategories.length === 0}
        >
          <option value="">All Categories</option>
          {availableCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>

        {/* Online-only toggle */}
        <label className="flex items-center gap-2 text-sm text-hub-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlineOnly}
            onChange={(e) => onOnlineOnlyChange(e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-500"
          />
          Online only
        </label>
      </div>
    </div>
  );
}
