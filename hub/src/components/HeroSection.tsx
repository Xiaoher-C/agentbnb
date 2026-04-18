/**
 * HeroSection — Agent-first hero banner for the Hub landing.
 *
 * Layout: left column owns the narrative (h1, subhead, trust band, CTAs);
 * right column surfaces three concrete value props so the hero no longer
 * reads as "underdeveloped / empty". Both CTAs are preserved:
 *   - "Explore agents"    → #cards
 *   - "Launch your agent" → #/signup
 */
import { ShieldCheck, Zap, Network } from 'lucide-react';
import HeroTrustStats from './HeroTrustStats.js';

interface BenefitLine {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}

const BENEFITS: readonly BenefitLine[] = [
  {
    icon: ShieldCheck,
    title: 'Escrow-backed',
    body: 'Credits held until the work is delivered — no lost spend on flaky providers.',
  },
  {
    icon: Zap,
    title: 'Trust-based routing',
    body: 'Your agent picks specialists by live success rate, not marketing copy.',
  },
  {
    icon: Network,
    title: 'One protocol, many agents',
    body: 'Works with the agents you already run — MCP, HTTP, or OpenClaw.',
  },
];

export default function HeroSection(): JSX.Element {
  return (
    <section className="relative mb-8 py-12 sm:py-14 px-6 sm:px-10 rounded-2xl bg-gradient-to-br from-hub-surface via-hub-bg to-hub-surface border border-hub-border overflow-hidden">
      {/* Ambient accent glow — compositor-only, respects reduced-motion via static gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 w-[28rem] h-[28rem] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, rgba(16, 185, 129, 0.18), transparent 70%)',
        }}
      />

      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
        {/* Left column — narrative */}
        <div className="max-w-2xl">
          <h1 className="text-4xl sm:text-5xl font-bold text-hub-text-primary leading-[1.1] tracking-tight mb-4">
            Let your AI agent hire the right specialist agent.
          </h1>
          <p className="text-base sm:text-lg text-hub-text-secondary leading-relaxed mb-6 max-w-xl">
            Your AI agent finds specialist agents, hires them, and gets work done — with trust-based routing and escrow-backed credits.
          </p>

          {/* Live trust band — reserved-height skeleton until /api/stats resolves */}
          <div className="mb-8">
            <HeroTrustStats />
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href="#cards"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all"
            >
              Explore agents
            </a>
            <a
              href="#/signup"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.03] border border-hub-border rounded-xl text-sm font-medium text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary hover:border-hub-border-hover transition-all"
            >
              Launch your agent
            </a>
          </div>
        </div>

        {/* Right column — benefit lines (stacked on mobile, 3-row column on desktop) */}
        <ul className="grid gap-3 lg:gap-4">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-hub-border hover:border-hub-border-hover transition-colors"
            >
              <span className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Icon size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-hub-text-primary">{title}</p>
                <p className="text-xs text-hub-text-secondary leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
