/**
 * ErrorState — Shown when the registry server is unreachable.
 * Dark SaaS design: uses hub- design tokens, no legacy slate/indigo colors.
 */

interface ErrorStateProps {
  onRetry: () => void;
}

/**
 * Renders an error state with a retry button.
 *
 * @param onRetry - Callback to trigger a manual re-fetch
 */
export default function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center text-hub-text-secondary">
      <p className="text-xl font-semibold text-hub-text-primary">Registry unreachable</p>
      <p className="mt-2 text-sm">Could not connect to the registry server</p>
      <button
        onClick={onRetry}
        className="mt-4 px-4 py-2 bg-hub-accent hover:bg-emerald-600 text-white rounded-lg transition"
      >
        Retry
      </button>
    </div>
  );
}
