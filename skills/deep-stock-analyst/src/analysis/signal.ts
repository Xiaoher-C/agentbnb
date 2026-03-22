import type { AVDailyPrice } from '../api/types.js';
import type { ValuationScore } from './valuation.js';
import type { TechnicalScore } from './technicals.js';
import type { FinancialHealth } from './financial-health.js';
import type { SentimentScore } from './sentiment.js';
import { sp } from './utils.js';

export type InvestmentStyle = 'growth' | 'value' | 'momentum' | 'hybrid';
export type SignalVerdict = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';

interface StyleWeights {
  valuation: number;
  technicals: number;
  financials: number;
  sentiment: number;
}

function getStyleWeights(style: InvestmentStyle): StyleWeights {
  const presets: Record<InvestmentStyle, StyleWeights> = {
    growth: { valuation: 0.15, technicals: 0.25, financials: 0.40, sentiment: 0.20 },
    value: { valuation: 0.40, technicals: 0.15, financials: 0.30, sentiment: 0.15 },
    momentum: { valuation: 0.10, technicals: 0.45, financials: 0.15, sentiment: 0.30 },
    hybrid: { valuation: 0.25, technicals: 0.30, financials: 0.25, sentiment: 0.20 },
  };
  return presets[style];
}

/** Find local support levels from price data */
function findSupportLevels(daily: AVDailyPrice[], count: number): number[] {
  const prices = daily.slice(0, 90).map((d) => sp(d.low));
  const levels: number[] = [];

  for (let i = 2; i < prices.length - 2; i++) {
    const p = prices[i] ?? 0;
    if (
      p <= (prices[i - 1] ?? 0) &&
      p <= (prices[i - 2] ?? 0) &&
      p <= (prices[i + 1] ?? 0) &&
      p <= (prices[i + 2] ?? 0)
    ) {
      levels.push(parseFloat(p.toFixed(2)));
    }
  }

  // Cluster nearby levels (within 1%)
  const clustered: number[] = [];
  for (const lvl of levels.sort((a, b) => b - a)) {
    const isDuplicate = clustered.some((c) => Math.abs(c - lvl) / lvl < 0.01);
    if (!isDuplicate) clustered.push(lvl);
    if (clustered.length >= count) break;
  }
  return clustered;
}

/** Find local resistance levels from price data */
function findResistanceLevels(daily: AVDailyPrice[], count: number): number[] {
  const prices = daily.slice(0, 90).map((d) => sp(d.high));
  const levels: number[] = [];

  for (let i = 2; i < prices.length - 2; i++) {
    const p = prices[i] ?? 0;
    if (
      p >= (prices[i - 1] ?? 0) &&
      p >= (prices[i - 2] ?? 0) &&
      p >= (prices[i + 1] ?? 0) &&
      p >= (prices[i + 2] ?? 0)
    ) {
      levels.push(parseFloat(p.toFixed(2)));
    }
  }

  const clustered: number[] = [];
  for (const lvl of levels.sort((a, b) => b - a)) {
    const isDuplicate = clustered.some((c) => Math.abs(c - lvl) / lvl < 0.01);
    if (!isDuplicate) clustered.push(lvl);
    if (clustered.length >= count) break;
  }
  return clustered;
}

/** How much do the four sub-scores agree? 0–1 */
function calculateAgreement(
  valuation: ValuationScore,
  technicals: TechnicalScore,
  financials: FinancialHealth,
  sentiment: SentimentScore,
): number {
  const scores = [
    valuation.composite,
    technicals.composite,
    financials.composite,
    sentiment.composite,
  ];
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  // Low stdDev = high agreement → high confidence
  return Math.max(0, 1 - stdDev / 30);
}

/** Data completeness: 0–1 based on whether modules have real data */
function calculateCompleteness(
  valuation: ValuationScore,
  technicals: TechnicalScore,
  financials: FinancialHealth,
  sentiment: SentimentScore,
): number {
  let score = 0;
  if (valuation.raw.pe > 0) score += 0.25;
  if (technicals.raw.price > 0) score += 0.25;
  if (financials.raw.revenueGrowthPct !== 0) score += 0.25;
  if (sentiment.news_volume > 3) score += 0.25;
  return score;
}

export interface CompositeSignal {
  signal: SignalVerdict;
  confidence: number; // 0–1
  composite_score: number; // 0–100
  support_levels: number[];
  resistance_levels: number[];
  key_factors: string[];
  risk_factors: string[];
  data_completeness: number; // 0–1
}

export function generateCompositeSignal(
  valuation: ValuationScore,
  technicals: TechnicalScore,
  financials: FinancialHealth,
  sentiment: SentimentScore,
  daily: AVDailyPrice[],
  style: InvestmentStyle,
): CompositeSignal {
  const w = getStyleWeights(style);

  const composite_score =
    valuation.composite * w.valuation +
    technicals.composite * w.technicals +
    financials.composite * w.financials +
    sentiment.composite * w.sentiment;

  const signal: SignalVerdict =
    composite_score > 80 ? 'strong_buy'
      : composite_score > 62 ? 'buy'
        : composite_score > 42 ? 'hold'
          : composite_score > 25 ? 'sell'
            : 'strong_sell';

  const agreementScore = calculateAgreement(valuation, technicals, financials, sentiment);
  const data_completeness = calculateCompleteness(valuation, technicals, financials, sentiment);
  const confidence = parseFloat((agreementScore * 0.6 + data_completeness * 0.4).toFixed(2));

  const support_levels = findSupportLevels(daily, 3);
  const resistance_levels = findResistanceLevels(daily, 3);

  // Key positive factors
  const key_factors: string[] = [];
  if (valuation.verdict === 'undervalued') key_factors.push(`Undervalued: composite valuation ${valuation.composite.toFixed(0)}/100`);
  if (financials.growth_score > 70) key_factors.push(`Strong growth: revenue +${financials.raw.revenueGrowthPct.toFixed(1)}% YoY`);
  if (technicals.signals.some((s) => s.type === 'bullish' && s.strength >= 4)) {
    const sig = technicals.signals.find((s) => s.type === 'bullish' && s.strength >= 4);
    if (sig) key_factors.push(`Technical: ${sig.name}`);
  }
  if (sentiment.bullish_ratio > 0.7) key_factors.push(`Bullish sentiment: ${(sentiment.bullish_ratio * 100).toFixed(0)}% positive coverage`);
  for (const flag of financials.green_flags.slice(0, 2)) key_factors.push(flag);

  // Key risk factors
  const risk_factors: string[] = [];
  if (valuation.verdict === 'expensive') risk_factors.push(`Expensive valuation: composite ${valuation.composite.toFixed(0)}/100`);
  if (technicals.signals.some((s) => s.type === 'bearish' && s.strength >= 4)) {
    const sig = technicals.signals.find((s) => s.type === 'bearish' && s.strength >= 4);
    if (sig) risk_factors.push(`Technical: ${sig.name}`);
  }
  for (const flag of financials.red_flags.slice(0, 2)) risk_factors.push(flag);
  if (sentiment.bullish_ratio < 0.3) risk_factors.push(`Negative sentiment: only ${(sentiment.bullish_ratio * 100).toFixed(0)}% positive coverage`);

  return {
    signal,
    confidence,
    composite_score: parseFloat(composite_score.toFixed(1)),
    support_levels,
    resistance_levels,
    key_factors: key_factors.slice(0, 3),
    risk_factors: risk_factors.slice(0, 3),
    data_completeness,
  };
}
