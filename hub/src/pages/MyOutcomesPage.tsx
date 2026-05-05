/**
 * MyOutcomesPage — v10 placeholder for "My Outcomes" (rental outcome portfolio).
 *
 * Final version (Phase 2 Track B / C) will list shareable Outcome Pages
 * (`/o/:share_token`) generated from completed rental sessions, plus public
 * portfolio controls. For now, this is a stub so the new top-level nav entry
 * resolves to a real route.
 *
 * @see docs/adr/022-agent-maturity-rental.md
 */
export default function MyOutcomesPage(): JSX.Element {
  return (
    <section
      aria-labelledby="my-outcomes-heading"
      className="max-w-3xl mx-auto py-12"
    >
      <header className="mb-8">
        <h1
          id="my-outcomes-heading"
          className="text-3xl font-semibold text-hub-text-primary"
        >
          My Outcomes
        </h1>
        <p className="mt-2 text-hub-text-secondary">
          Shareable artifacts from your completed rental sessions.
        </p>
      </header>

      <div className="rounded-card border border-hub-border bg-hub-surface p-10 text-center">
        <p className="text-base font-medium text-hub-text-primary">
          No outcomes yet.
        </p>
        <p className="mt-2 text-sm text-hub-text-secondary">
          Once a rental session ends, the auto-generated Outcome Page will show up here.
        </p>
        <p className="mt-4 text-xs text-hub-text-muted">
          Coming soon — Phase 2 Track B.
        </p>
      </div>
    </section>
  );
}
