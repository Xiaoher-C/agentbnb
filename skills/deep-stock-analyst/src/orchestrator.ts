/**
 * Orchestrator: ties together all 5 analysis modules.
 * Pure computation — no LLM. Returns structured JSON for the calling agent to interpret.
 */

import { fetchAllData } from './api/alpha-vantage.js';
import { calculateValuation } from './analysis/valuation.js';
import { analyzeTechnicals } from './analysis/technicals.js';
import { analyzeFinancialHealth } from './analysis/financial-health.js';
import { analyzeSentiment } from './analysis/sentiment.js';
import { generateCompositeSignal } from './analysis/signal.js';
import type { InvestmentStyle } from './analysis/signal.js';

export interface AnalysisOptions {
  ticker: string;
  depth?: 'quick' | 'standard' | 'deep';
  style?: InvestmentStyle;
  apiKey: string;
}

export interface AnalysisResult {
  ticker: string;
  analyzed_at: string;
  depth: string;
  style: string;

  // Top-level verdict
  signal: string;
  confidence: number;
  composite_score: number;

  // Module results
  valuation: {
    verdict: string;
    composite: number;
    pe_score: number;
    peg_score: number;
    fcf_yield_score: number;
    ev_ebitda_score: number;
    ps_score: number;
    raw: Record<string, number>;
  };
  technicals: {
    regime: string;
    composite: number;
    trend_score: number;
    momentum_score: number;
    volatility_score: number;
    strength_score: number;
    signals: Array<{ type: string; name: string; strength: number; description: string }>;
    raw: Record<string, number>;
  };
  financials: {
    composite: number;
    profitability_score: number;
    growth_score: number;
    leverage_score: number;
    efficiency_score: number;
    red_flags: string[];
    green_flags: string[];
    raw: Record<string, number>;
  };
  sentiment: {
    composite: number;
    news_sentiment: number;
    news_volume: number;
    bullish_ratio: number;
    key_headlines: string[];
    topic_breakdown: Record<string, number>;
  };

  // Price levels
  support_levels: number[];
  resistance_levels: number[];
  key_factors: string[];
  risk_factors: string[];
  data_completeness: number;

  // Company metadata
  company: {
    name: string;
    sector: string;
    industry: string;
    market_cap: string;
    price: number;
    analyst_target: number;
  };
}

export async function runAnalysis(options: AnalysisOptions): Promise<AnalysisResult> {
  const { ticker, depth = 'standard', style = 'hybrid', apiKey } = options;

  // Step 1: Fetch all API data (12 calls, serialized)
  const data = await fetchAllData(ticker, apiKey);

  // Step 2: Compute all modules (pure math, no LLM)
  const valuation = calculateValuation(data.overview);
  const technicals = analyzeTechnicals(
    data.daily, data.rsi, data.macd, data.bbands, data.stoch, data.adx,
  );
  const financials = analyzeFinancialHealth(
    data.overview, data.income, data.balance, data.cashflow, data.earnings,
  );
  const sentiment = analyzeSentiment(data.news, ticker);
  const composite = generateCompositeSignal(
    valuation, technicals, financials, sentiment, data.daily, style,
  );

  // Step 3: Assemble result
  const price = parseFloat(data.daily[0]?.adjustedClose ?? data.daily[0]?.close ?? '0');
  const analystTarget = parseFloat(data.overview.AnalystTargetPrice ?? '0');
  const marketCap = parseFloat(data.overview.MarketCapitalization ?? '0');
  const mcStr =
    marketCap >= 1e12 ? `$${(marketCap / 1e12).toFixed(2)}T`
      : marketCap >= 1e9 ? `$${(marketCap / 1e9).toFixed(2)}B`
        : marketCap >= 1e6 ? `$${(marketCap / 1e6).toFixed(2)}M`
          : `$${marketCap.toFixed(0)}`;

  return {
    ticker: ticker.toUpperCase(),
    analyzed_at: new Date().toISOString(),
    depth,
    style,

    signal: composite.signal,
    confidence: composite.confidence,
    composite_score: composite.composite_score,

    valuation: {
      verdict: valuation.verdict,
      composite: parseFloat(valuation.composite.toFixed(1)),
      pe_score: parseFloat(valuation.pe_score.toFixed(1)),
      peg_score: parseFloat(valuation.peg_score.toFixed(1)),
      fcf_yield_score: parseFloat(valuation.fcf_yield_score.toFixed(1)),
      ev_ebitda_score: parseFloat(valuation.ev_ebitda_score.toFixed(1)),
      ps_score: parseFloat(valuation.ps_score.toFixed(1)),
      raw: {
        pe: valuation.raw.pe,
        peg: valuation.raw.peg,
        ps: valuation.raw.ps,
        fcf_yield_pct: parseFloat(valuation.raw.fcfYieldPct.toFixed(2)),
      },
    },

    technicals: {
      regime: technicals.regime,
      composite: parseFloat(technicals.composite.toFixed(1)),
      trend_score: parseFloat(technicals.trend_score.toFixed(1)),
      momentum_score: parseFloat(technicals.momentum_score.toFixed(1)),
      volatility_score: parseFloat(technicals.volatility_score.toFixed(1)),
      strength_score: parseFloat(technicals.strength_score.toFixed(1)),
      signals: technicals.signals,
      raw: {
        rsi: parseFloat(technicals.raw.rsi.toFixed(1)),
        macd_hist: parseFloat(technicals.raw.macdHist.toFixed(4)),
        adx: parseFloat(technicals.raw.adx.toFixed(1)),
        bb_position: parseFloat(technicals.raw.bbPosition.toFixed(2)),
        price,
        sma20: parseFloat(technicals.raw.sma20.toFixed(2)),
        sma50: parseFloat(technicals.raw.sma50.toFixed(2)),
        sma200: parseFloat(technicals.raw.sma200.toFixed(2)),
      },
    },

    financials: {
      composite: parseFloat(financials.composite.toFixed(1)),
      profitability_score: parseFloat(financials.profitability_score.toFixed(1)),
      growth_score: parseFloat(financials.growth_score.toFixed(1)),
      leverage_score: parseFloat(financials.leverage_score.toFixed(1)),
      efficiency_score: parseFloat(financials.efficiency_score.toFixed(1)),
      red_flags: financials.red_flags,
      green_flags: financials.green_flags,
      raw: {
        gross_margin_pct: parseFloat(financials.raw.grossMarginPct.toFixed(1)),
        operating_margin_pct: parseFloat(financials.raw.operatingMarginPct.toFixed(1)),
        net_margin_pct: parseFloat(financials.raw.netMarginPct.toFixed(1)),
        roe: parseFloat(financials.raw.roe.toFixed(1)),
        debt_to_equity: parseFloat(financials.raw.debtToEquity.toFixed(2)),
        current_ratio: parseFloat(financials.raw.currentRatio.toFixed(2)),
        revenue_growth_pct: parseFloat(financials.raw.revenueGrowthPct.toFixed(1)),
        earnings_growth_pct: parseFloat(financials.raw.earningsGrowthPct.toFixed(1)),
        consecutive_beats: financials.raw.consecutiveBeats,
      },
    },

    sentiment: {
      composite: parseFloat(sentiment.composite.toFixed(1)),
      news_sentiment: parseFloat(sentiment.news_sentiment.toFixed(3)),
      news_volume: sentiment.news_volume,
      bullish_ratio: parseFloat(sentiment.bullish_ratio.toFixed(2)),
      key_headlines: sentiment.key_headlines,
      topic_breakdown: sentiment.topic_breakdown,
    },

    support_levels: composite.support_levels,
    resistance_levels: composite.resistance_levels,
    key_factors: composite.key_factors,
    risk_factors: composite.risk_factors,
    data_completeness: composite.data_completeness,

    company: {
      name: data.overview.Name ?? ticker,
      sector: data.overview.Sector ?? 'N/A',
      industry: data.overview.Industry ?? 'N/A',
      market_cap: mcStr,
      price,
      analyst_target: analystTarget,
    },
  };
}
