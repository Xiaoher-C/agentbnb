/**
 * useEscrowBalance — v10 rental hook for fetching the renter's spendable
 * credit balance.
 *
 * The Hub backend exposes the authenticated renter's balance at `GET /me`
 * (returning `{ owner, balance }`, verified by the merged G1/G2 work).
 * Client-side gating is layered on top — the backend remains the source of
 * truth and may still reject the rental with HTTP 402 in a race.
 *
 * Refetches on:
 * - mount
 * - window `focus` (user returns from another tab)
 * - the custom `agentbnb:balance-changed` window event so any flow that just
 *   spent or earned credits can ask for an immediate refresh
 *
 * No long-poll interval — rental flows live for at most a few minutes and
 * a focus refetch is sufficient.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authedFetch, loadSession } from '../lib/authHeaders.js';

/** Window event name other components can dispatch after mutating credits. */
export const BALANCE_CHANGED_EVENT = 'agentbnb:balance-changed';

/** Currency unit label rendered next to balance figures. */
export type EscrowCurrency = 'credits';

export interface UseEscrowBalanceResult {
  /** Latest balance returned by `/me`, or `null` until the first fetch resolves. */
  balance: number | null;
  /** Always `'credits'` for v10 — kept for forward compat. */
  currency: EscrowCurrency;
  /** True until the very first fetch resolves; false thereafter. */
  loading: boolean;
  /** Last error message, or null when the latest fetch succeeded. */
  error: string | null;
  /** Imperatively refetch the balance. Returns the resolved promise for callers that want to await. */
  refetch: () => Promise<void>;
}

interface MeResponse {
  owner: string;
  balance: number;
}

/**
 * Subscribe to the renter's spendable balance.
 *
 * Returns `balance: null` when no Hub session is active — callers should
 * treat this as "unknown" (the modal renders a "請先登入" prompt in that
 * branch rather than gating on insufficient funds).
 */
export function useEscrowBalance(): UseEscrowBalanceResult {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(() => loadSession() !== null);
  const [error, setError] = useState<string | null>(null);
  const isFirstFetch = useRef(true);

  const fetchBalance = useCallback(async (): Promise<void> => {
    const session = loadSession();
    if (!session) {
      // No auth — surface "unknown" balance, leave loading false.
      setBalance(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const res = await authedFetch('/me');
      if (res.status === 401) {
        setBalance(null);
        setError('Sign in expired — please log in again.');
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as Partial<MeResponse>;
      if (typeof data.balance !== 'number') {
        throw new Error('Malformed /me payload');
      }
      setBalance(data.balance);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Balance unreachable: ${msg}`);
    } finally {
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isFirstFetch.current = true;
    setLoading(loadSession() !== null);
    void fetchBalance();
  }, [fetchBalance]);

  // Refetch on focus + custom event.
  useEffect(() => {
    const onFocus = (): void => {
      void fetchBalance();
    };
    const onChanged = (): void => {
      void fetchBalance();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(BALANCE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(BALANCE_CHANGED_EVENT, onChanged);
    };
  }, [fetchBalance]);

  return { balance, currency: 'credits', loading, error, refetch: fetchBalance };
}
