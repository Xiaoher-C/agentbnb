import type {
  AVOverview,
  AVIncomeStatement,
  AVBalanceSheet,
  AVCashFlow,
  AVEarnings,
} from '../api/types.js';
import {
  scoreMetric,
  scoreMetricInverse,
  weightedAvg,
  calcYoYGrowth,
  scoreGrowth,
  scoreSurprise,
  countConsecutiveBeats,
  sp,
} from './utils.js';

export interface FinancialHealth {
  profitability_score: number;
  growth_score: number;
  leverage_score: number;
  efficiency_score: number;
  composite: number;
  red_flags: string[];
  green_flags: string[];
  raw: {
    grossMarginPct: number;
    operatingMarginPct: number;
    netMarginPct: number;
    roe: number;
    debtToEquity: number;
    currentRatio: number;
    revenueGrowthPct: number;
    earningsGrowthPct: number;
    lastSurpisePct: number;
    consecutiveBeats: number;
  };
}

function calcInterestCoverage(report: AVIncomeStatement['annualReports'][number] | undefined): number {
  if (!report) return 5;
  const ebit = sp(report.ebit);
  const interest = sp(report.interestExpense);
  if (interest === 0) return 10; // no debt
  return Math.abs(ebit / interest);
}

function calcROIC(
  income: AVIncomeStatement['annualReports'][number] | undefined,
  balance: AVBalanceSheet['annualReports'][number] | undefined,
): number {
  if (!income || !balance) return 0;
  const nopat = sp(income.ebit) * 0.79; // rough 21% tax
  const investedCapital =
    sp(balance.totalShareholderEquity) + sp(balance.longTermDebt) + sp(balance.shortTermDebt);
  if (investedCapital === 0) return 0;
  return nopat / investedCapital;
}

export function analyzeFinancialHealth(
  overview: AVOverview,
  income: AVIncomeStatement,
  balance: AVBalanceSheet,
  cashflow: AVCashFlow,
  earnings: AVEarnings,
): FinancialHealth {
  const red_flags: string[] = [];
  const green_flags: string[] = [];

  // === Profitability ===
  const grossProfit = sp(overview.GrossProfitTTM);
  const revenue = sp(overview.RevenueTTM);
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const operatingMarginPct = sp(overview.OperatingMarginTTM) * 100;
  const netMarginPct = sp(overview.ProfitMargin) * 100;
  const roe = sp(overview.ReturnOnEquityTTM) * 100;

  if (grossMarginPct > 60) green_flags.push(`Gross margin ${grossMarginPct.toFixed(1)}% — strong pricing power`);
  if (netMarginPct < 0) red_flags.push(`Net margin negative at ${netMarginPct.toFixed(1)}%`);
  if (roe > 20) green_flags.push(`ROE ${roe.toFixed(1)}% — excellent capital efficiency`);
  if (roe < 0) red_flags.push(`ROE negative at ${roe.toFixed(1)}% — destroying shareholder value`);

  const profitability_score = weightedAvg([
    [scoreMetricInverse(grossMarginPct, { excellent: 60, good: 40, fair: 25, poor: 10 }), 0.30],
    [scoreMetricInverse(operatingMarginPct, { excellent: 25, good: 15, fair: 8, poor: 0 }), 0.35],
    [scoreMetricInverse(roe, { excellent: 25, good: 15, fair: 8, poor: 0 }), 0.35],
  ]);

  // === Growth ===
  const revenueGrowthPct = calcYoYGrowth(income.quarterlyReports as unknown as Record<string, unknown>[], 'totalRevenue');
  const earningsGrowthPct = calcYoYGrowth(income.quarterlyReports as unknown as Record<string, unknown>[], 'netIncome');
  const fcfGrowthPct = calcYoYGrowth(cashflow.quarterlyReports as unknown as Record<string, unknown>[], 'operatingCashflow');

  const quarterlyEarnings = earnings.quarterlyEarnings ?? [];
  const lastEarnings = quarterlyEarnings[0];
  const lastSurpisePct = sp(lastEarnings?.surprisePercentage);
  if (lastSurpisePct > 10) green_flags.push(`Last earnings beat estimates by ${lastSurpisePct.toFixed(1)}%`);
  if (lastSurpisePct < -10) red_flags.push(`Last earnings missed estimates by ${Math.abs(lastSurpisePct).toFixed(1)}%`);

  const consecutiveBeats = countConsecutiveBeats(quarterlyEarnings);
  if (consecutiveBeats >= 4) green_flags.push(`${consecutiveBeats} consecutive quarters of earnings beats`);
  if (revenueGrowthPct > 20) green_flags.push(`Revenue growing ${revenueGrowthPct.toFixed(1)}% YoY`);
  if (revenueGrowthPct < -10) red_flags.push(`Revenue declining ${Math.abs(revenueGrowthPct).toFixed(1)}% YoY`);

  const growth_score = weightedAvg([
    [scoreGrowth(revenueGrowthPct), 0.35],
    [scoreGrowth(earningsGrowthPct), 0.35],
    [scoreGrowth(fcfGrowthPct), 0.20],
    [scoreSurprise(lastSurpisePct), 0.10],
  ]);

  // === Leverage ===
  const debtToEquity = sp(overview.DebtToEquity);
  const currentRatio = sp(overview.CurrentRatio);
  const interestCoverage = calcInterestCoverage(income.annualReports?.[0]);

  if (debtToEquity > 2.0) red_flags.push(`Debt/Equity ${debtToEquity.toFixed(2)} — heavily leveraged`);
  if (currentRatio < 1.0) red_flags.push(`Current ratio ${currentRatio.toFixed(2)} — potential liquidity risk`);
  if (currentRatio > 2.0) green_flags.push(`Current ratio ${currentRatio.toFixed(2)} — strong liquidity`);
  if (interestCoverage < 2.0) red_flags.push(`Interest coverage ${interestCoverage.toFixed(1)}x — thin margin`);
  if (debtToEquity < 0.3) green_flags.push(`Low leverage: Debt/Equity ${debtToEquity.toFixed(2)}`);

  const leverage_score = weightedAvg([
    [scoreMetric(debtToEquity, { excellent: 0.3, good: 0.8, fair: 1.5, poor: 3.0 }), 0.40],
    [scoreMetricInverse(currentRatio, { excellent: 2.5, good: 1.5, fair: 1.0, poor: 0.5 }), 0.30],
    [scoreMetricInverse(interestCoverage, { excellent: 10, good: 5, fair: 2, poor: 1 }), 0.30],
  ]);

  // === Efficiency ===
  const totalAssets = sp(balance.annualReports?.[0]?.totalAssets);
  const assetTurnover = totalAssets > 0 ? revenue / totalAssets : 0;
  const roic = calcROIC(income.annualReports?.[0], balance.annualReports?.[0]);

  const efficiency_score = weightedAvg([
    [scoreMetricInverse(assetTurnover, { excellent: 1.5, good: 1.0, fair: 0.5, poor: 0.2 }), 0.50],
    [scoreMetricInverse(roic * 100, { excellent: 20, good: 12, fair: 7, poor: 0 }), 0.50],
  ]);

  const composite = weightedAvg([
    [profitability_score, 0.30],
    [growth_score, 0.30],
    [leverage_score, 0.20],
    [efficiency_score, 0.20],
  ]);

  return {
    profitability_score,
    growth_score,
    leverage_score,
    efficiency_score,
    composite,
    red_flags,
    green_flags,
    raw: {
      grossMarginPct,
      operatingMarginPct,
      netMarginPct,
      roe,
      debtToEquity,
      currentRatio,
      revenueGrowthPct,
      earningsGrowthPct,
      lastSurpisePct,
      consecutiveBeats,
    },
  };
}
