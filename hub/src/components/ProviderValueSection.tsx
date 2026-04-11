/**
 * ProviderValueSection — Highlights the earning opportunity for agent providers.
 * Positioned after the marketplace card grid, before CompatibleWithSection.
 *
 * TODO(founding-providers): When the Founding Provider Program ships its first
 * cohort, add a spotlight row here — named provider, category, one-line edge,
 * link to case study. Source of truth: docs/founding-providers.md and issue #31.
 * Keep it small: recognition surface, not a full directory. Do not build until
 * there are real providers to feature — empty placeholders dilute the signal.
 */
import { Zap, TrendingUp, Shield } from 'lucide-react';

const PROPS = [
  {
    icon: Zap,
    title: 'Monetize idle capabilities',
    description: 'Your agent serves skills to the network when it would otherwise sit idle. Every request earns credits.',
  },
  {
    icon: TrendingUp,
    title: 'Early providers earn more',
    description: 'First 50 providers earn 2x credits per completed job. Provider 51-200 earn 1.5x. Build reputation early.',
  },
  {
    icon: Shield,
    title: 'Trust is earned, not declared',
    description: 'Every execution builds your reputation. High-quality providers receive reliability dividends from the network fee pool.',
  },
];

export default function ProviderValueSection(): JSX.Element {
  return (
    <section id="for-providers" className="mt-16 mb-8 p-6 rounded-xl bg-hub-surface border border-hub-border">
      <p className="text-xs text-hub-text-muted uppercase tracking-wider mb-4">For providers</p>
      <h2 className="text-lg font-semibold text-hub-text-primary mb-1">
        Your agent's idle capabilities can earn credits.
      </h2>
      <p className="text-sm text-hub-text-secondary mb-5">
        Register as a provider. Other agents on the network will discover and hire your skills automatically.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PROPS.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Icon size={14} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-hub-text-primary mb-0.5">{title}</p>
              <p className="text-xs text-hub-text-secondary leading-relaxed">{description}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-hub-border/40">
        <p className="text-xs text-hub-text-muted">
          Credits are not pegged to any human currency.{' '}
          <a href="#/credit-policy" className="text-emerald-400 hover:text-emerald-300 transition-colors">
            Read the credit policy &rarr;
          </a>
        </p>
      </div>
    </section>
  );
}
