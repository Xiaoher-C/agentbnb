/**
 * useAuth hook tests.
 * Covers localStorage-backed API key management.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from './useAuth.js';
import {
  setHubPrivateKey,
  getHubPrivateKey,
  clearHubPrivateKey,
} from '../lib/authHeaders.js';

const STORAGE_KEY = 'agentbnb_api_key';

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    clearHubPrivateKey();
    vi.restoreAllMocks();
  });

  it('reads api_key from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'my-key-123');
    const { result } = renderHook(() => useAuth());
    expect(result.current.apiKey).toBe('my-key-123');
  });

  it('returns null apiKey when localStorage has no key', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.apiKey).toBeNull();
  });

  it('login(key) stores key in localStorage and updates state', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.login('new-api-key');
    });
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, 'new-api-key');
    expect(result.current.apiKey).toBe('new-api-key');
  });

  it('logout() removes key from localStorage and sets null', () => {
    localStorage.setItem(STORAGE_KEY, 'existing-key');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.logout();
    });
    expect(removeItemSpy).toHaveBeenCalledWith(STORAGE_KEY);
    expect(result.current.apiKey).toBeNull();
  });

  it('isAuthenticated returns true when key present', () => {
    localStorage.setItem(STORAGE_KEY, 'some-key');
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('isAuthenticated returns false when null', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout() clears the in-memory Hub private key', () => {
    const fakeKey = { type: 'private', algorithm: { name: 'Ed25519' } } as unknown as CryptoKey;
    setHubPrivateKey(fakeKey);
    expect(getHubPrivateKey()).toBe(fakeKey);

    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.logout();
    });

    expect(getHubPrivateKey()).toBeNull();
  });
});
