/**
 * SearchFilter — Search input and filter controls for the hub page.
 */
import { Search } from 'lucide-react';
import type { Category } from '../types.js';

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
}

const inputClass =
  'bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

/**
 * Renders search input, level/category dropdowns, and online-only toggle.
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
}: SearchFilterProps) {
  return (
    <div className="flex flex-wrap gap-3 items-center mb-6">
      {/* Search input */}
      <div className="relative flex items-center">
        <Search size={16} className="absolute left-3 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search capabilities..."
          className={`${inputClass} pl-9 w-64`}
        />
      </div>

      {/* Level dropdown */}
      <select
        value={level ?? ''}
        onChange={(e) => {
          const val = e.target.value;
          onLevelChange(val === '' ? null : Number(val));
        }}
        className={inputClass}
      >
        <option value="">All Levels</option>
        <option value="1">L1 Atomic</option>
        <option value="2">L2 Pipeline</option>
        <option value="3">L3 Environment</option>
      </select>

      {/* Category dropdown - only shows categories with current cards */}
      <select
        value={category ?? ''}
        onChange={(e) => onCategoryChange(e.target.value === '' ? null : e.target.value)}
        className={inputClass}
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
      <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={onlineOnly}
          onChange={(e) => onOnlineOnlyChange(e.target.checked)}
          className="w-4 h-4 rounded accent-indigo-500"
        />
        Online only
      </label>
    </div>
  );
}
