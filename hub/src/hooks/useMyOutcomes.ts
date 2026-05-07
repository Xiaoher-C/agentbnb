/**
 * useMyOutcomes — re-export of `useMySessions({ status: 'ended' })`.
 *
 * Lives in its own file so callers can import the outcomes hook by name
 * without leaking the implementation detail that it's a thin wrapper. Kept as
 * a re-export rather than a duplicate so the two hooks cannot drift.
 */
export { useMyOutcomes, type UseMySessionsArgs as UseMyOutcomesArgs, type UseMySessionsResult as UseMyOutcomesResult, type MySessionRow as MyOutcomeRow } from './useMySessions.js';
