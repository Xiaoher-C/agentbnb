/**
 * Thesis generation via Gemini Flash.
 * Uses genesis-bot's existing GOOGLE_API_KEY.
 * Input: pre-computed CompositeSignal + raw data → structured thesis JSON.
 * LLM interprets numbers — does NOT recalculate anything.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ValuationScore } from '../analysis/valuation.js';
import type { TechnicalScore } from '../analysis/technicals.js';
import type { FinancialHealth } from '../analysis/financial-health.js';
import type { SentimentScore } from '../analysis/sentiment.js';
import type { CompositeSignal } from '../analysis/signal.js';
import type { AVOverview } from '../api/types.js';

export interface InvestmentThesis {
  bull_case: string;
  bear_case: string;
  catalysts: string[];
  risks: string[];
  time_horizon: 'short_term' | 'medium_term' | 'long_term';
  entry_strategy: string;
}

const FALLBACK_THESIS: InvestmentThesis = {
  bull_case: 'Quantitative metrics indicate favorable risk/reward. See scores for details.',
  bear_case: 'Monitor red flags and technical weakness signals before committing capital.',
  catalysts: ['Earnings surprise', 'Sector rotation', 'Macro tailwinds'],
  risks: ['Market volatility', 'Rate sensitivity', 'Execution risk'],
  time_horizon: 'medium_term',
  entry_strategy: 'Consider scaling in near support levels identified in technical analysis.',
};

export async function generateThesis(
  ticker: string,
  overview: AVOverview,
  composite: CompositeSignal,
  valuation: ValuationScore,
  technicals: TechnicalScore,
  financials: FinancialHealth,
  sentiment: SentimentScore,
): Promise<InvestmentThesis> {
  const apiKey = process.env['GOOGLE_API_KEY'];
  if (!apiKey) {
    console.error('[thesis] GOOGLE_API_KEY not set — returning fallback thesis');
    return FALLBACK_THESIS;
  }

  const prompt = `You are a senior equity analyst. Based on the pre-computed analysis below, write a concise investment thesis. CRITICAL: Do NOT recalculate any numbers. All numbers have been verified. Your job is to INTERPRET, not COMPUTE.

Ticker: ${ticker}
Company: ${overview.Name ?? ticker}
Sector: ${overview.Sector ?? 'N/A'}
Industry: ${overview.Industry ?? 'N/A'}

Signal: ${composite.signal} (confidence: ${(composite.confidence * 100).toFixed(0)}%)
Composite Score: ${composite.composite_score}/100

Valuation: ${valuation.verdict} (score: ${valuation.composite.toFixed(0)}/100)
- P/E: ${overview.PERatio}, PEG: ${overview.PEGRatio}
- FCF Yield score: ${valuation.fcf_yield_score.toFixed(0)}/100

Technical Regime: ${technicals.regime}
- Trend: ${technicals.trend_score.toFixed(0)}/100, Momentum: ${technicals.momentum_score.toFixed(0)}/100
- Active Signals: ${JSON.stringify(technicals.signals.map((s) => s.name))}

Financial Health: ${financials.composite.toFixed(0)}/100
- Growth score: ${financials.growth_score.toFixed(0)}/100, Revenue growth: ${financials.raw.revenueGrowthPct.toFixed(1)}% YoY
- Red Flags: ${JSON.stringify(financials.red_flags)}
- Green Flags: ${JSON.stringify(financials.green_flags)}

Sentiment: ${sentiment.composite.toFixed(0)}/100 (${sentiment.news_volume} articles, ${(sentiment.bullish_ratio * 100).toFixed(0)}% bullish)

Support: ${composite.support_levels.join(', ')}
Resistance: ${composite.resistance_levels.join(', ')}

Respond ONLY with valid JSON (no markdown fences):
{
  "bull_case": "3-4 sentences with specific numbers only from the data above",
  "bear_case": "3-4 sentences with specific numbers only from the data above",
  "catalysts": ["upcoming event or condition 1", "event 2", "event 3"],
  "risks": ["risk 1", "risk 2", "risk 3"],
  "time_horizon": "short_term | medium_term | long_term",
  "entry_strategy": "Specific entry approach given support/resistance levels above"
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown fences if present
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean) as InvestmentThesis;
    return parsed;
  } catch (err) {
    console.error('[thesis] Gemini call failed:', err);
    return FALLBACK_THESIS;
  }
}
