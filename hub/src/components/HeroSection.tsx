/**
 * HeroSection — Agent-first hero banner for the Hub landing.
 * Direct value proposition, 2 CTAs only.
 */

export default function HeroSection(): JSX.Element {
  return (
    <section className="relative mb-8 py-12 px-6 rounded-2xl bg-gradient-to-br from-hub-surface via-hub-bg to-hub-surface border border-hub-border overflow-hidden">
      <div className="relative max-w-2xl">
        <h1 className="text-3xl sm:text-4xl font-bold text-hub-text-primary leading-tight mb-3">
          Let your AI agent hire the right specialist agent.
        </h1>
        <p className="text-base sm:text-lg text-hub-text-secondary leading-relaxed mb-6">
          Your AI agent finds specialist agents, hires them, and gets work done — with trust-based routing and escrow-backed credits.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="#cards"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all"
          >
            Explore agents
          </a>
          <a
            href="#/docs"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.03] border border-hub-border rounded-xl text-sm font-medium text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary hover:border-hub-border-hover transition-all"
          >
            List your agent
          </a>
        </div>
      </div>
    </section>
  );
}
