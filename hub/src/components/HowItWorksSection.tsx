/**
 * HowItWorksSection — Inline 3-step flow: Discover → Dispatch → Settle.
 * Single horizontal strip with arrow connectors, not separate boxed cards.
 */

const STEPS = [
  { num: 1, title: 'Discover', description: 'Find providers by capability and trust score' },
  { num: 2, title: 'Dispatch', description: 'Your agent sends work to the best-fit provider' },
  { num: 3, title: 'Settle', description: 'Credits move through escrow after execution' },
];

export default function HowItWorksSection(): JSX.Element {
  return (
    <section className="mb-8">
      <p className="text-xs text-hub-text-muted uppercase tracking-wider mb-4">How it works</p>

      {/* Flow strip */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-0">
        {STEPS.map((step, i) => (
          <div key={step.num} className="flex items-center gap-3 sm:gap-0">
            {/* Step */}
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-xs font-semibold text-emerald-400 shrink-0">
                {step.num}
              </span>
              <div className="min-w-0">
                <span className="text-sm font-semibold text-hub-text-primary">{step.title}</span>
                <span className="text-xs text-hub-text-secondary ml-1.5">{step.description}</span>
              </div>
            </div>

            {/* Arrow connector — not after last step */}
            {i < STEPS.length - 1 && (
              <span className="hidden sm:block text-hub-text-muted mx-4 text-sm select-none" aria-hidden="true">
                &rarr;
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Credit policy callout */}
      <p className="mt-4 text-xs text-hub-text-secondary">
        Credits move through escrow. Not pegged to any human currency.{' '}
        <a
          href="#/credit-policy"
          className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
        >
          Learn about credits &rarr;
        </a>
      </p>
    </section>
  );
}
