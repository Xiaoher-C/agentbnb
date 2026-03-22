/** Shared math utilities — all pure functions, no LLM. */

export interface ScoreThresholds {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

/**
 * Score a metric where lower is better (e.g. P/E ratio, debt/equity).
 * Returns 0–100, where 100 = excellent (very cheap / low risk).
 */
export function scoreMetric(value: number, t: ScoreThresholds): number {
  if (isNaN(value) || !isFinite(value)) return 50;
  if (value <= t.excellent) return 100;
  if (value <= t.good) return mapRange(value, t.excellent, t.good, 100, 75);
  if (value <= t.fair) return mapRange(value, t.good, t.fair, 75, 50);
  if (value <= t.poor) return mapRange(value, t.fair, t.poor, 50, 25);
  return Math.max(0, 25 - ((value - t.poor) / t.poor) * 25);
}

/**
 * Score a metric where higher is better (e.g. gross margin, ROE, FCF yield).
 * Returns 0–100, where 100 = excellent (high margin / high return).
 */
export function scoreMetricInverse(value: number, t: ScoreThresholds): number {
  if (isNaN(value) || !isFinite(value)) return 50;
  if (value >= t.excellent) return 100;
  if (value >= t.good) return mapRange(value, t.good, t.excellent, 75, 100);
  if (value >= t.fair) return mapRange(value, t.fair, t.good, 50, 75);
  if (value >= t.poor) return mapRange(value, t.poor, t.fair, 25, 50);
  return Math.max(0, ((value - t.poor) / t.poor) * 25);
}

/** Weighted average: [[value, weight], ...] → number */
export function weightedAvg(pairs: [number, number][]): number {
  let totalWeight = 0;
  let totalValue = 0;
  for (const [val, w] of pairs) {
    if (!isNaN(val) && isFinite(val)) {
      totalValue += val * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? totalValue / totalWeight : 50;
}

/** Linear interpolation: map x from [inMin,inMax] to [outMin,outMax] */
export function mapRange(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return (outMin + outMax) / 2;
  const clamped = Math.max(inMin, Math.min(inMax, x));
  return outMin + ((clamped - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Simple Moving Average over the last `period` closing prices */
export function calcSMA(prices: { close: string }[], period: number): number {
  const slice = prices.slice(0, period);
  if (slice.length === 0) return 0;
  const sum = slice.reduce((acc, p) => acc + parseFloat(p.close), 0);
  return sum / slice.length;
}

/** Average volume over `period` days */
export function calcAvgVolume(prices: { volume: string }[], period: number): number {
  const slice = prices.slice(0, period);
  if (slice.length === 0) return 0;
  const sum = slice.reduce((acc, p) => acc + parseFloat(p.volume), 0);
  return sum / slice.length;
}

/** Format large numbers: 1234567 → "1.23M" */
export function formatNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

/** Safe parse: returns NaN-safe float */
export function sp(v: unknown): number {
  const n = parseFloat(String(v ?? 'NaN'));
  return isFinite(n) ? n : 0;
}

/** YoY growth rate from quarterly reports (Q0 vs Q4) */
export function calcYoYGrowth(
  reports: Array<Record<string, string>>,
  field: string,
): number {
  const current = sp(reports[0]?.[field]);
  const prior = sp(reports[4]?.[field]);
  if (prior === 0) return 0;
  return ((current - prior) / Math.abs(prior)) * 100;
}

/** Score growth rate: 0–100 */
export function scoreGrowth(pct: number): number {
  if (pct >= 30) return 100;
  if (pct >= 15) return mapRange(pct, 15, 30, 70, 100);
  if (pct >= 5) return mapRange(pct, 5, 15, 50, 70);
  if (pct >= 0) return mapRange(pct, 0, 5, 40, 50);
  if (pct >= -10) return mapRange(pct, -10, 0, 20, 40);
  return Math.max(0, 20 + pct * 2);
}

/** Score earnings surprise percentage: 0–100 */
export function scoreSurprise(pct: number): number {
  if (pct >= 10) return 100;
  if (pct >= 5) return 80;
  if (pct >= 0) return 60;
  if (pct >= -5) return 40;
  return 20;
}

/** Count consecutive earnings beats from quarterly earnings array */
export function countConsecutiveBeats(
  earnings: Array<{ surprisePercentage: string }>,
): number {
  let count = 0;
  for (const e of earnings) {
    if (sp(e.surprisePercentage) > 0) count++;
    else break;
  }
  return count;
}

/** Clamp to [0, 100] */
export function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}
