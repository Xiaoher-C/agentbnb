/**
 * SkillList — scrollable left-panel list of discovered skills.
 *
 * Provides a minimal search filter (name / description / path substring) so
 * the dogfood list of 150+ skills stays navigable. Selection drives the
 * FlowCanvas render via the callback.
 */
import { useMemo, useState } from 'react';
import type { ListedSkill } from '../../lib/skillsApi.js';
import SkillCard from './SkillCard.js';

interface SkillListProps {
  skills: ListedSkill[];
  selectedSkillId: string | null;
  onSelect: (skill: ListedSkill) => void;
  loading: boolean;
  error: string | null;
}

export default function SkillList({
  skills,
  selectedSkillId,
  onSelect,
  loading,
  error,
}: SkillListProps): JSX.Element {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.path.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const provenanceCounts = useMemo(() => {
    const counts = { tracked: 0, pinned: 0, untracked: 0 };
    for (const s of skills) counts[s.provenanceState]++;
    return counts;
  }, [skills]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-hub-border p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          placeholder={`Search ${skills.length} skill${skills.length === 1 ? '' : 's'}…`}
          className="w-full rounded-md border border-hub-border bg-hub-bg px-3 py-1.5 text-sm text-hub-text-primary placeholder:text-hub-text-muted focus:border-hub-accent/50 focus:outline-none"
        />
        <div className="mt-2 flex gap-2 text-[10px] text-hub-text-secondary">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
            tracked {provenanceCounts.tracked}
          </span>
          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-300">
            pinned {provenanceCounts.pinned}
          </span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
            untracked {provenanceCounts.untracked}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg border border-hub-border bg-hub-surface"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center text-xs text-hub-text-muted">
            {query ? 'No skills match your search.' : 'No skills discovered.'}
          </div>
        )}

        {!loading && filtered.map((skill) => (
          <SkillCard
            key={skill.skillId}
            skill={skill}
            selected={skill.skillId === selectedSkillId}
            onSelect={() => { onSelect(skill); }}
          />
        ))}
      </div>
    </div>
  );
}
