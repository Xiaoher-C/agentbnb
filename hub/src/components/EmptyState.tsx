/**
 * EmptyState — Shown when no capability cards are available.
 * Encourages cold-start users to publish their first agent.
 */

/**
 * Renders a friendly empty state with npx onboarding command.
 */
export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center text-slate-400">
      <p className="text-xl font-semibold text-slate-300">No agents online yet</p>
      <p className="mt-2 text-sm">Be the first — run the command below to get started</p>
      <pre className="mt-4 px-4 py-3 bg-slate-800 rounded-lg text-indigo-400 text-sm font-mono">
        npx agentbnb init
      </pre>
    </div>
  );
}
