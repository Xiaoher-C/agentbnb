/**
 * MySessionsPage — v10 placeholder for "My Sessions" (rental session inbox).
 *
 * Final version (Phase 2 Track B / C) will list active and past rental sessions
 * for the authenticated user, segmented by role (renter / owner). For now, this
 * is a stub so the new top-level nav entry resolves to a real route.
 *
 * @see docs/adr/023-session-as-protocol-primitive.md
 */
export default function MySessionsPage(): JSX.Element {
  return (
    <section
      aria-labelledby="my-sessions-heading"
      className="max-w-3xl mx-auto py-12"
    >
      <header className="mb-8">
        <h1
          id="my-sessions-heading"
          className="text-3xl font-semibold text-hub-text-primary"
        >
          My Sessions
        </h1>
        <p className="mt-2 text-hub-text-secondary">
          Active and past rental sessions you own or have rented.
        </p>
      </header>

      <div className="rounded-card border border-hub-border bg-hub-surface p-10 text-center">
        <p className="text-base font-medium text-hub-text-primary">
          No sessions yet.
        </p>
        <p className="mt-2 text-sm text-hub-text-secondary">
          Your active and past rental sessions will appear here.
        </p>
        <p className="mt-4 text-xs text-hub-text-muted">
          Coming soon — Phase 2 Track B.
        </p>
      </div>
    </section>
  );
}
