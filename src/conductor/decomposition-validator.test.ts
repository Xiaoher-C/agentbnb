import { describe, it, expect } from 'vitest';
import { validateAndNormalizeSubtasks } from './decomposition-validator.js';
import type { Role } from './decomposition-validator.js';

const ALL_ROLES: Role[] = ['researcher', 'executor', 'validator', 'coordinator'];
const defaultCtx = { available_roles: ALL_ROLES, max_credits: 100 };

describe('validateAndNormalizeSubtasks', () => {
  it('Test 1: Non-array input returns error', () => {
    const result = validateAndNormalizeSubtasks('not an array', defaultCtx);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toContain('decomposition output must be an array');
  });

  it('Test 2: Item missing id returns error', () => {
    const raw = [{ description: 'do something', required_capability: 'text_gen' }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes('subtask[0]: id must be a non-empty string'))).toBe(true);
  });

  it('Test 3: Item missing description returns error', () => {
    const raw = [{ id: 'step-1', required_capability: 'text_gen' }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes('subtask[0]: description must be a non-empty string'))).toBe(true);
  });

  it('Test 4: Item with empty required_capability returns error', () => {
    const raw = [{ id: 'step-1', description: 'do something', required_capability: '' }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes('subtask[0]: required_capability must be a non-empty string'))).toBe(true);
  });

  it('Test 5: Duplicate IDs returns error', () => {
    const raw = [
      { id: 'step-1', description: 'first', required_capability: 'text_gen' },
      { id: 'step-1', description: 'second', required_capability: 'text_gen' },
    ];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes('duplicate subtask id: step-1'))).toBe(true);
  });

  it('Test 6: depends_on references unknown ID returns error', () => {
    const raw = [
      { id: 'step-1', description: 'first', required_capability: 'text_gen' },
      { id: 'step-2', description: 'second', required_capability: 'text_gen', depends_on: ['nonexistent'] },
    ];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes("subtask[1]: depends_on references unknown id 'nonexistent'"))).toBe(true);
  });

  it('Test 7: Circular dependency (A -> B -> A) returns error', () => {
    const raw = [
      { id: 'A', description: 'first', required_capability: 'text_gen', depends_on: ['B'] },
      { id: 'B', description: 'second', required_capability: 'text_gen', depends_on: ['A'] },
    ];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes('circular dependency detected involving subtask id:'))).toBe(true);
  });

  it('Test 8: Invalid role value returns error', () => {
    const raw = [{ id: 'step-1', description: 'do something', required_capability: 'text_gen', role: 'wizard' }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(
      result.errors.some((e) =>
        e.includes("subtask[0]: role 'wizard' is not valid (must be one of: researcher, executor, validator, coordinator)")
      )
    ).toBe(true);
  });

  it('Test 9: estimated_credits = 0 returns error', () => {
    const raw = [{ id: 'step-1', description: 'do something', required_capability: 'text_gen', estimated_credits: 0 }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors.some((e) => e.includes('subtask[0]: estimated_credits must be a positive number'))).toBe(true);
  });

  it('Test 10: estimated_credits > max_credits returns error', () => {
    const raw = [{ id: 'step-1', description: 'do something', required_capability: 'text_gen', estimated_credits: 500 }];
    const result = validateAndNormalizeSubtasks(raw, { available_roles: ALL_ROLES, max_credits: 100 });
    expect(result.errors.some((e) => e.includes('subtask[0]: estimated_credits 500 exceeds max_credits 100'))).toBe(true);
  });

  it('Test 11: Valid minimal array returns normalized SubTask[] with no errors', () => {
    const raw = [
      { id: 'step-1', description: 'do something', required_capability: 'text_gen' },
    ];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      id: 'step-1',
      description: 'do something',
      required_capability: 'text_gen',
      params: {},
      depends_on: [],
      estimated_credits: 0,
    });
  });

  it('Test 12: Valid array with role and estimated_credits within bounds — role passed through', () => {
    const raw = [
      {
        id: 'step-1',
        description: 'do something',
        required_capability: 'text_gen',
        role: 'executor',
        estimated_credits: 5,
      },
    ];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
    const task = result.valid[0]!;
    expect(task.estimated_credits).toBe(5);
    // role field IS passed through to SubTask (routing hint for team formation)
    expect(task.role).toBe('executor');
  });

  it('Test 13: Diamond DAG (A->B, A->C, B->C) is valid — not a cycle', () => {
    const raw = [
      { id: 'A', description: 'root', required_capability: 'text_gen', depends_on: [] },
      { id: 'B', description: 'branch-1', required_capability: 'text_gen', depends_on: ['A'] },
      { id: 'C', description: 'branch-2', required_capability: 'text_gen', depends_on: ['A'] },
      { id: 'D', description: 'merge', required_capability: 'text_gen', depends_on: ['B', 'C'] },
    ];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(4);
  });

  it('Test 14: Empty array is vacuously valid', () => {
    const result = validateAndNormalizeSubtasks([], defaultCtx);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(0);
  });

  it('Test 15: params field missing on item — normalized SubTask.params defaults to {}', () => {
    const raw = [{ id: 'step-1', description: 'do something', required_capability: 'text_gen' }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.valid[0]?.params).toEqual({});
  });

  it('Test 16: depends_on missing on item — normalized SubTask.depends_on defaults to []', () => {
    const raw = [{ id: 'step-1', description: 'do something', required_capability: 'text_gen' }];
    const result = validateAndNormalizeSubtasks(raw, defaultCtx);
    expect(result.valid[0]?.depends_on).toEqual([]);
  });
});
