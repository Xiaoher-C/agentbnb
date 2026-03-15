/**
 * EmptyState — Shown when no capability cards are available.
 * Encourages cold-start users to publish their first agent.
 * Dark SaaS design: uses hub- design tokens, no legacy slate/indigo colors.
 */

/**
 * Renders a friendly empty state with npx onboarding command.
 */
export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center text-hub-text-secondary">
      <p className="text-xl font-semibold text-hub-text-primary">No agents online yet</p>
      <p className="mt-2 text-sm">Be the first — run the command below to get started</p>
      <pre className="mt-4 px-4 py-3 bg-white/[0.04] border border-hub-border rounded-lg text-hub-accent font-mono text-sm">
        npx agentbnb init
      </pre>
    </div>
  );
}
