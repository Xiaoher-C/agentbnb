/**
 * useAuth — localStorage-backed API key authentication hook.
 *
 * Stores the API key under a fixed localStorage key and exposes login/logout
 * helpers. Initial state is read from localStorage on mount so the session
 * survives page refreshes.
 */
import { useState } from 'react';

const STORAGE_KEY = 'agentbnb_api_key';

export interface UseAuthResult {
  /** The current API key, or null if not authenticated. */
  apiKey: string | null;
  /** Store the given key in localStorage and update state. */
  login: (key: string) => void;
  /** Remove the key from localStorage and reset state to null. */
  logout: () => void;
  /** True when apiKey is a non-null string. */
  isAuthenticated: boolean;
}

/**
 * Manages AgentBnB owner authentication via a stored API key.
 *
 * @returns Auth state and helpers for logging in/out.
 */
export function useAuth(): UseAuthResult {
  const [apiKey, setApiKey] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });

  const login = (key: string): void => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  };

  const logout = (): void => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
  };

  return {
    apiKey,
    login,
    logout,
    isAuthenticated: apiKey !== null,
  };
}
