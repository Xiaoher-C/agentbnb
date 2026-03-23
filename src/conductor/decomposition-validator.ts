import type { SubTask } from './types.js';

/**
 * Recognized role values for task decomposition routing hints.
 * Roles are NOT authorization boundaries — they are routing hints only.
 */
export type Role = 'researcher' | 'executor' | 'validator' | 'coordinator';

/**
 * Raw external subtask input — may contain unknown/invalid fields.
 */
export interface RawSubTask {
  id?: unknown;
  description?: unknown;
  required_capability?: unknown;
  depends_on?: unknown;
  role?: unknown;
  estimated_credits?: unknown;
  params?: unknown;
  [key: string]: unknown;
}

/**
 * Result of validateAndNormalizeSubtasks — never throws.
 */
export interface ValidationResult {
  /** Normalized SubTask[] if valid (empty on error). */
  valid: SubTask[];
  /** Error messages; non-empty means validation failed. */
  errors: string[];
}

/**
 * Validates and normalizes raw external decomposition output into typed SubTask[].
 *
 * Validation rules (collected — does not short-circuit per item):
 *   1. raw is an array
 *   2. Each item has: id (string), description (string), required_capability (non-empty string)
 *   3. Subtask IDs are unique within the array
 *   4. depends_on references only IDs present in the array
 *   5. No circular dependencies (Kahn's algorithm topological sort)
 *   6. role (if present) is one of context.available_roles
 *   7. estimated_credits (if present) is a positive number and <= max_credits
 *
 * @param raw - Untrusted external response (unknown shape).
 * @param context - Validation context: available_roles list + max credit ceiling.
 * @returns { valid: SubTask[], errors: string[] } — never throws.
 */
export function validateAndNormalizeSubtasks(
  raw: unknown,
  context: { available_roles: Role[]; max_credits: number },
): ValidationResult {
  try {
    return _validate(raw, context);
  } catch {
    return { valid: [], errors: ['internal validation error'] };
  }
}

function _validate(
  raw: unknown,
  context: { available_roles: Role[]; max_credits: number },
): ValidationResult {
  // Step 1 — Array check
  if (!Array.isArray(raw)) {
    return { valid: [], errors: ['decomposition output must be an array'] };
  }

  // Vacuously valid empty array
  if (raw.length === 0) {
    return { valid: [], errors: [] };
  }

  const errors: string[] = [];
  const validItems: Array<Record<string, unknown>> = [];
  const validIds: string[] = [];

  // Step 2 — Per-item field validation
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`subtask[${i}]: must be an object`);
      continue;
    }

    const obj = item as Record<string, unknown>;
    let itemValid = true;

    // Validate id
    const id = obj['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`subtask[${i}]: id must be a non-empty string`);
      itemValid = false;
    }

    // Validate description
    const description = obj['description'];
    if (typeof description !== 'string' || description.length === 0) {
      errors.push(`subtask[${i}]: description must be a non-empty string`);
      itemValid = false;
    }

    // Validate required_capability
    const required_capability = obj['required_capability'];
    if (typeof required_capability !== 'string' || required_capability.length === 0) {
      errors.push(`subtask[${i}]: required_capability must be a non-empty string`);
      itemValid = false;
    }

    // Validate role (if present)
    const role = obj['role'];
    if (role !== undefined) {
      if (!context.available_roles.includes(role as Role)) {
        errors.push(
          `subtask[${i}]: role '${String(role)}' is not valid (must be one of: ${context.available_roles.join(', ')})`
        );
        itemValid = false;
      }
    }

    // Validate estimated_credits (if present)
    const estimated_credits = obj['estimated_credits'];
    if (estimated_credits !== undefined) {
      if (typeof estimated_credits !== 'number' || estimated_credits <= 0) {
        errors.push(`subtask[${i}]: estimated_credits must be a positive number`);
        itemValid = false;
      } else if (estimated_credits > context.max_credits) {
        errors.push(
          `subtask[${i}]: estimated_credits ${estimated_credits} exceeds max_credits ${context.max_credits}`
        );
        itemValid = false;
      }
    }

    if (itemValid) {
      validItems.push(obj);
      validIds.push(id as string);
    }
  }

  // Step 3 — Uniqueness check (only on items that passed step 2)
  const idSet = new Set<string>();
  for (const id of validIds) {
    if (idSet.has(id)) {
      errors.push(`duplicate subtask id: ${id}`);
    } else {
      idSet.add(id);
    }
  }

  // Step 4 — Referential integrity
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i]!;
    const depends_on = item['depends_on'];
    if (!Array.isArray(depends_on)) continue;

    for (const dep of depends_on) {
      if (typeof dep === 'string' && !idSet.has(dep)) {
        errors.push(`subtask[${i}]: depends_on references unknown id '${dep}'`);
      }
    }
  }

  // Step 5 — Cycle detection (Kahn's algorithm)
  if (errors.length === 0 && validItems.length > 0) {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const id of validIds) {
      inDegree.set(id, 0);
      adjList.set(id, []);
    }

    for (const item of validItems) {
      const depends_on = item['depends_on'];
      if (!Array.isArray(depends_on)) continue;
      for (const dep of depends_on) {
        if (typeof dep !== 'string' || !idSet.has(dep)) continue;
        // dep must complete before this item — dep -> item edge
        adjList.get(dep)?.push(item['id'] as string);
        inDegree.set(item['id'] as string, (inDegree.get(item['id'] as string) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      processed++;
      for (const neighbor of adjList.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (processed < validItems.length) {
      // Find the first node with remaining in-degree (cycle participant)
      for (const [id, deg] of inDegree) {
        if (deg > 0) {
          errors.push(`circular dependency detected involving subtask id: ${id}`);
          break;
        }
      }
    }
  }

  // Step 6 — If errors, return empty valid
  if (errors.length > 0) {
    return { valid: [], errors };
  }

  // Step 7 — Normalize to SubTask[]
  const normalized: SubTask[] = validItems.map((item) => {
    const depends_on = Array.isArray(item['depends_on'])
      ? (item['depends_on'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    const params =
      typeof item['params'] === 'object' &&
      item['params'] !== null &&
      !Array.isArray(item['params'])
        ? (item['params'] as Record<string, unknown>)
        : {};

    const estimated_credits =
      typeof item['estimated_credits'] === 'number' ? (item['estimated_credits'] as number) : 0;

    return {
      id: item['id'] as string,
      description: item['description'] as string,
      required_capability: item['required_capability'] as string,
      params,
      depends_on,
      estimated_credits,
    };
  });

  return { valid: normalized, errors: [] };
}
