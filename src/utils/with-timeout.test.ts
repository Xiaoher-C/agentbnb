import { describe, it, expect, vi } from 'vitest';
import { withTimeout, TimeoutError } from './with-timeout';

describe('withTimeout', () => {
  it('resolves with the value when promise settles before timeout', async () => {
    const result = await withTimeout(Promise.resolve('hello'), 1000);
    expect(result).toBe('hello');
  });

  it('rejects with TimeoutError when promise takes too long', async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 500);
    });

    await expect(withTimeout(slow, 50)).rejects.toThrow(TimeoutError);
  });

  it('TimeoutError has correct message including the timeout duration', () => {
    const error = new TimeoutError(3000);
    expect(error.message).toBe('Operation timed out after 3000ms');
    expect(error.name).toBe('TimeoutError');
  });

  it('TimeoutError is an instanceof Error', () => {
    const error = new TimeoutError(100);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('clears the timer on successful resolution (no hanging timers)', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const result = withTimeout(Promise.resolve(42), 5000);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(42);

    expect(clearSpy).toHaveBeenCalled();

    clearSpy.mockRestore();
    vi.useRealTimers();
  });

  it('rejects with the original error if promise rejects before timeout', async () => {
    const originalError = new Error('upstream failure');
    const failing = Promise.reject(originalError);

    await expect(withTimeout(failing, 1000)).rejects.toThrow('upstream failure');
    await expect(withTimeout(Promise.reject(originalError), 1000)).rejects.toBe(originalError);
  });

  it('works with zero-delay promises', async () => {
    const instant = new Promise<string>((resolve) => {
      setTimeout(() => resolve('instant'), 0);
    });

    const result = await withTimeout(instant, 1000);
    expect(result).toBe('instant');
  });
});
