/**
 * Dismissal persistence for Skill Inspector risk warnings.
 *
 * Keys are `${skillId}:${ruleId}:${nodeId}` and values are the ISO timestamp
 * of the dismiss. Dismissals live entirely in localStorage — they NEVER get
 * written back to the SKILL.md on disk. That separation is deliberate: the
 * inspector is read-only in v0.1, and an author who wants to silence a rule
 * permanently should edit the skill, not ask the viewer to hide the warning.
 */

const STORAGE_KEY = 'agentbnb_skill_inspector_dismissals_v1';

type DismissMap = Record<string, string>;

function load(): DismissMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as DismissMap;
  } catch {
    return {};
  }
}

function save(map: DismissMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded — best-effort, fall through.
  }
}

function composeKey(skillId: string, ruleId: string, nodeId: string): string {
  return `${skillId}:${ruleId}:${nodeId}`;
}

export function isDismissed(
  skillId: string,
  ruleId: string,
  nodeId: string,
): boolean {
  const map = load();
  return Object.prototype.hasOwnProperty.call(map, composeKey(skillId, ruleId, nodeId));
}

export function dismiss(
  skillId: string,
  ruleId: string,
  nodeId: string,
): void {
  const map = load();
  map[composeKey(skillId, ruleId, nodeId)] = new Date().toISOString();
  save(map);
}

export function undismiss(
  skillId: string,
  ruleId: string,
  nodeId: string,
): void {
  const map = load();
  delete map[composeKey(skillId, ruleId, nodeId)];
  save(map);
}

export function listDismissedForSkill(skillId: string): string[] {
  const map = load();
  const prefix = `${skillId}:`;
  return Object.keys(map).filter((k) => k.startsWith(prefix));
}
