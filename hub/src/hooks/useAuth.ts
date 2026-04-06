/**
 * useAuth — unified Hub authentication hook.
 *
 * Supports two modes:
 * - 'bearer': legacy CLI flow — API key stored in localStorage, sent as
 *   Authorization: Bearer <key> on requests
 * - 'did': new Hub flow — Ed25519 keypair + session stored via authHeaders.ts,
 *   requests signed per-call via authedFetch
 *
 * Session survives page refresh.
 */
import { useState } from 'react';
import { loadSession, clearSession } from '../lib/authHeaders.js';

const STORAGE_KEY = 'agentbnb_api_key';
/** Sentinel value placed in apiKey to indicate DID auth is active. */
const DID_SENTINEL = '__did__';

export type AuthMode = 'bearer' | 'did' | null;

export interface UseAuthResult {
  /**
   * For legacy Bearer mode: the API key string.
   * For DID mode: the sentinel '__did__' (use authedFetch from lib/authHeaders.ts).
   * null when not authenticated.
   */
  apiKey: string | null;
  /** Current auth mode, or null if not authenticated. */
  mode: AuthMode;
  /**
   * Store the given key. Pass a real API key for Bearer mode, or null for DID mode
   * (assumes session was already saved via saveSession() before calling).
   */
  login: (key: string | null) => void;
  /** Clear all auth state (both Bearer key and DID session). */
  logout: () => void;
  /** True when any auth mode is active. */
  isAuthenticated: boolean;
}

function initialState(): string | null {
  // Prefer Bearer mode if a real key exists
  const key = localStorage.getItem(STORAGE_KEY);
  if (key && key !== DID_SENTINEL) return key;
  // Otherwise check for DID session
  if (loadSession()) return DID_SENTINEL;
  return null;
}

export function useAuth(): UseAuthResult {
  const [apiKey, setApiKey] = useState<string | null>(initialState);

  const login = (key: string | null): void => {
    if (key === null) {
      // DID mode — session was saved by HubAuthForm before this call
      localStorage.setItem(STORAGE_KEY, DID_SENTINEL);
      setApiKey(DID_SENTINEL);
    } else {
      // Bearer mode
      localStorage.setItem(STORAGE_KEY, key);
      setApiKey(key);
    }
  };

  const logout = (): void => {
    localStorage.removeItem(STORAGE_KEY);
    clearSession();
    setApiKey(null);
  };

  const mode: AuthMode = apiKey === null ? null : apiKey === DID_SENTINEL ? 'did' : 'bearer';

  return {
    apiKey,
    mode,
    login,
    logout,
    isAuthenticated: apiKey !== null,
  };
}
