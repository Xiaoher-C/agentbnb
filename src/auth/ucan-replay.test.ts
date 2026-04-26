import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkAndRecordJti,
  clearReplayCache,
  replayCacheSize,
  MAX_CACHE_SIZE,
} from './ucan-replay.js';

describe('UCAN Replay Cache', () => {
  beforeEach(() => {
    clearReplayCache();
  });

  describe('checkAndRecordJti', () => {
    it('records a fresh jti and returns true', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      expect(checkAndRecordJti('jti-1', exp)).toBe(true);
      expect(replayCacheSize()).toBe(1);
    });

    it('rejects a duplicate jti (replay)', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      expect(checkAndRecordJti('jti-2', exp)).toBe(true);
      expect(checkAndRecordJti('jti-2', exp)).toBe(false);
      expect(replayCacheSize()).toBe(1);
    });

    it('treats different jtis independently', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      expect(checkAndRecordJti('jti-a', exp)).toBe(true);
      expect(checkAndRecordJti('jti-b', exp)).toBe(true);
      expect(replayCacheSize()).toBe(2);
    });
  });

  describe('clearReplayCache', () => {
    it('empties the cache', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      checkAndRecordJti('jti-c', exp);
      expect(replayCacheSize()).toBe(1);
      clearReplayCache();
      expect(replayCacheSize()).toBe(0);
    });
  });

  describe('cache eviction', () => {
    it('evicts expired entries when MAX_CACHE_SIZE is reached', () => {
      // Fill the cache with already-expired entries.
      const past = Math.floor(Date.now() / 1000) - 1;
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        checkAndRecordJti(`expired-${i}`, past);
      }
      expect(replayCacheSize()).toBe(MAX_CACHE_SIZE);

      // The next insert should trigger eviction of every expired entry.
      const future = Math.floor(Date.now() / 1000) + 3600;
      expect(checkAndRecordJti('fresh-0', future)).toBe(true);
      // After eviction the cache should hold only the fresh entry.
      expect(replayCacheSize()).toBe(1);
    });

    it('drops the oldest entry when no expirable entries exist and the cache is full', () => {
      // Fill the cache with future-dated entries so eviction-by-expiry cannot help.
      const future = Math.floor(Date.now() / 1000) + 3600;
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        checkAndRecordJti(`future-${i}`, future);
      }
      expect(replayCacheSize()).toBe(MAX_CACHE_SIZE);

      // The next insert evicts the oldest non-expirable entry (insertion order).
      expect(checkAndRecordJti('newest', future)).toBe(true);
      expect(replayCacheSize()).toBe(MAX_CACHE_SIZE);
      // The first-inserted jti should now be gone (so re-inserting it succeeds).
      expect(checkAndRecordJti('future-0', future)).toBe(true);
    });
  });
});
