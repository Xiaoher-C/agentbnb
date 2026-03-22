import type { AVOverview } from '../api/types.js';
import { scoreMetric, scoreMetricInverse, weightedAvg, sp } from './utils.js';

export interface ValuationScore {
  pe_score: number;
  ps_score: number;
  peg_score: number;
  fcf_yield_score: number;
  ev_ebitda_score: number;
  composite: number;
  verdict: 'undervalued' | 'fair' | 'overvalued' | 'expensive';
  raw: {
    pe: number;
    forwardPE: number;
    peg: number;
    ps: number;
    evEbitda: number;
    fcfYieldPct: number;
  };
}

export function calculateValuation(overview: AVOverview): ValuationScore {
  const pe = sp(overview.PERatio);
  const forwardPE = sp(overview.ForwardPE);
  const peg = sp(overview.PEGRatio);
  const ps = sp(overview.PriceToSalesRatioTTM);
  const evEbitda = sp(overview.EVToEBITDA);
  const marketCap = sp(overview.MarketCapitalization);
  const ocf = sp(overview.OperatingCashflowTTM);

  // FCF Yield = Operating Cash Flow / Market Cap (as percentage)
  const fcfYieldPct = marketCap > 0 ? (ocf / marketCap) * 100 : 0;

  // Score each metric: 100 = very cheap, 0 = very expensive
  // Thresholds calibrated to S&P 500 historical medians
  const pe_score = scoreMetric(pe > 0 ? pe : forwardPE, {
    excellent: 12,
    good: 18,
    fair: 25,
    poor: 40,
  });

  const peg_score = scoreMetric(peg, {
    excellent: 0.5,
    good: 1.0,
    fair: 1.5,
    poor: 2.5,
  });

  const fcf_yield_score = scoreMetricInverse(fcfYieldPct, {
    excellent: 8,
    good: 5,
    fair: 3,
    poor: 1,
  });

  const ev_ebitda_score = scoreMetric(evEbitda, {
    excellent: 8,
    good: 12,
    fair: 18,
    poor: 30,
  });

  const ps_score = scoreMetric(ps, {
    excellent: 1,
    good: 3,
    fair: 6,
    poor: 12,
  });

  const composite = weightedAvg([
    [pe_score, 0.25],
    [peg_score, 0.20],
    [fcf_yield_score, 0.25],
    [ev_ebitda_score, 0.15],
    [ps_score, 0.15],
  ]);

  const verdict: ValuationScore['verdict'] =
    composite > 70 ? 'undervalued'
      : composite > 50 ? 'fair'
        : composite > 30 ? 'overvalued'
          : 'expensive';

  return {
    pe_score,
    ps_score,
    peg_score,
    fcf_yield_score,
    ev_ebitda_score,
    composite,
    verdict,
    raw: { pe, forwardPE, peg, ps, evEbitda, fcfYieldPct },
  };
}
