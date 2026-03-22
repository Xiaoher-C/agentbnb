import type {
  AVDailyPrice,
  AVRSIEntry,
  AVMACDEntry,
  AVBBandsEntry,
  AVStochEntry,
  AVADXEntry,
} from '../api/types.js';
import { calcSMA, calcAvgVolume, formatNumber, mapRange, weightedAvg, sp } from './utils.js';

export interface TechnicalSignal {
  type: 'bullish' | 'bearish' | 'neutral';
  name: string;
  strength: number; // 1–5
  description: string;
  detected_at: string;
}

export interface TechnicalScore {
  trend_score: number;
  momentum_score: number;
  volatility_score: number;
  strength_score: number;
  composite: number;
  regime: 'strong_uptrend' | 'uptrend' | 'consolidation' | 'downtrend' | 'strong_downtrend';
  signals: TechnicalSignal[];
  raw: {
    rsi: number;
    macdHist: number;
    adx: number;
    bbPosition: number;
    bandWidth: number;
    price: number;
    sma20: number;
    sma50: number;
    sma200: number;
  };
}

function calcSMAAlignment(
  price: number,
  sma20: number,
  sma50: number,
  sma100: number,
  sma200: number,
): number {
  let score = 0;
  // Perfect bull: price > SMA20 > SMA50 > SMA100 > SMA200 = 100
  if (price > sma20) score += 25;
  if (sma20 > sma50) score += 25;
  if (sma50 > sma100) score += 25;
  if (sma100 > sma200) score += 25;
  return score;
}

function detectRSIDivergence(
  daily: AVDailyPrice[],
  rsi: AVRSIEntry[],
  lookback: number,
): TechnicalSignal | null {
  if (daily.length < lookback || rsi.length < lookback) return null;

  // Check last `lookback` bars for price making new high but RSI declining (bearish divergence)
  // or price making new low but RSI rising (bullish divergence)
  const prices = daily.slice(0, lookback).map((d) => sp(d.close));
  const rsiVals = rsi.slice(0, lookback).map((r) => sp(r.RSI));

  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const rsiMin = Math.min(...rsiVals);
  const rsiMax = Math.max(...rsiVals);

  const latestPrice = prices[0] ?? 0;
  const latestRSI = rsiVals[0] ?? 50;

  // Bullish divergence: price near low but RSI well above its low
  if (
    latestPrice <= priceMin * 1.02 &&
    latestRSI >= rsiMin * 1.15 &&
    latestRSI < 50
  ) {
    return {
      type: 'bullish',
      name: 'RSI Bullish Divergence',
      strength: 4,
      description: `Price near ${lookback}-day low but RSI (${latestRSI.toFixed(1)}) is diverging upward`,
      detected_at: daily[0]?.date ?? '',
    };
  }

  // Bearish divergence: price near high but RSI well below its high
  if (
    latestPrice >= priceMax * 0.98 &&
    latestRSI <= rsiMax * 0.85 &&
    latestRSI > 50
  ) {
    return {
      type: 'bearish',
      name: 'RSI Bearish Divergence',
      strength: 4,
      description: `Price near ${lookback}-day high but RSI (${latestRSI.toFixed(1)}) is diverging downward`,
      detected_at: daily[0]?.date ?? '',
    };
  }

  return null;
}

function crossedAbove(
  daily: AVDailyPrice[],
  fastPeriod: number,
  slowPeriod: number,
  withinDays: number,
): boolean {
  for (let i = 0; i < withinDays; i++) {
    const slice = daily.slice(i);
    const fastNow = calcSMA(slice, fastPeriod);
    const slowNow = calcSMA(slice, slowPeriod);
    const fastPrev = calcSMA(daily.slice(i + 1), fastPeriod);
    const slowPrev = calcSMA(daily.slice(i + 1), slowPeriod);
    if (fastNow > slowNow && fastPrev <= slowPrev) return true;
  }
  return false;
}

function crossedBelow(
  daily: AVDailyPrice[],
  fastPeriod: number,
  slowPeriod: number,
  withinDays: number,
): boolean {
  for (let i = 0; i < withinDays; i++) {
    const slice = daily.slice(i);
    const fastNow = calcSMA(slice, fastPeriod);
    const slowNow = calcSMA(slice, slowPeriod);
    const fastPrev = calcSMA(daily.slice(i + 1), fastPeriod);
    const slowPrev = calcSMA(daily.slice(i + 1), slowPeriod);
    if (fastNow < slowNow && fastPrev >= slowPrev) return true;
  }
  return false;
}

function determineRegime(
  composite: number,
  trendScore: number,
  strengthScore: number,
): TechnicalScore['regime'] {
  if (composite > 80 && strengthScore > 70) return 'strong_uptrend';
  if (composite > 60) return 'uptrend';
  if (composite > 40) return 'consolidation';
  if (composite > 20 && strengthScore > 70) return 'strong_downtrend';
  return 'downtrend';
}

export function analyzeTechnicals(
  daily: AVDailyPrice[],
  rsi: AVRSIEntry[],
  macd: AVMACDEntry[],
  bbands: AVBBandsEntry[],
  stoch: AVStochEntry[],
  adx: AVADXEntry[],
): TechnicalScore {
  if (daily.length === 0) {
    return {
      trend_score: 50, momentum_score: 50, volatility_score: 50, strength_score: 50,
      composite: 50, regime: 'consolidation', signals: [],
      raw: { rsi: 50, macdHist: 0, adx: 20, bbPosition: 0.5, bandWidth: 0.05, price: 0, sma20: 0, sma50: 0, sma200: 0 },
    };
  }

  const price = sp(daily[0]?.close);

  // === Trend Score: SMA alignment ===
  const sma20 = calcSMA(daily, 20);
  const sma50 = calcSMA(daily, 50);
  const sma100 = calcSMA(daily, 100);
  const sma200 = calcSMA(daily, 200);
  const trend_score = calcSMAAlignment(price, sma20, sma50, sma100, sma200);

  // === Momentum Score: RSI + MACD ===
  const latestRSI = sp(rsi[0]?.RSI ?? '50');
  const macdHist = sp(macd[0]?.MACD_Hist ?? '0');

  // RSI: oversold (<30) = bullish setup; overbought (>70) = bearish
  const rsi_component =
    latestRSI < 30 ? 80
      : latestRSI > 70 ? 30
        : mapRange(latestRSI, 30, 70, 40, 70);

  // MACD histogram positive and growing = bullish momentum
  const macd_component =
    macdHist > 0
      ? mapRange(macdHist, 0, 2, 50, 90)
      : mapRange(macdHist, -2, 0, 10, 50);

  const momentum_score = rsi_component * 0.5 + macd_component * 0.5;

  // === Volatility Score: Bollinger position ===
  const upperBand = sp(bbands[0]?.['Real Upper Band'] ?? '0');
  const lowerBand = sp(bbands[0]?.['Real Lower Band'] ?? '0');
  const middleBand = sp(bbands[0]?.['Real Middle Band'] ?? '0');
  const bandRange = upperBand - lowerBand;
  const bandWidth = middleBand > 0 ? bandRange / middleBand : 0;
  const bbPosition = bandRange > 0 ? (price - lowerBand) / bandRange : 0.5;
  const volatility_score = bbPosition * 100;

  // === Strength Score: ADX ===
  const latestADX = sp(adx[0]?.ADX ?? '20');
  const strength_score = mapRange(latestADX, 10, 50, 0, 100);

  // === Signal Detection ===
  const signals: TechnicalSignal[] = [];
  const today = daily[0]?.date ?? '';

  // Golden Cross / Death Cross (SMA50 vs SMA200)
  if (crossedAbove(daily, 50, 200, 5)) {
    signals.push({
      type: 'bullish', name: 'Golden Cross', strength: 5,
      description: 'SMA50 crossed above SMA200 within last 5 trading days',
      detected_at: today,
    });
  }
  if (crossedBelow(daily, 50, 200, 5)) {
    signals.push({
      type: 'bearish', name: 'Death Cross', strength: 5,
      description: 'SMA50 crossed below SMA200 within last 5 trading days',
      detected_at: today,
    });
  }

  // RSI Divergence
  const rsiDiv = detectRSIDivergence(daily, rsi, 20);
  if (rsiDiv) signals.push(rsiDiv);

  // MACD Bullish Crossover (hist went positive)
  const prevMacdHist = sp(macd[1]?.MACD_Hist ?? '0');
  if (macdHist > 0 && prevMacdHist < 0) {
    signals.push({
      type: 'bullish', name: 'MACD Bullish Crossover', strength: 3,
      description: 'MACD crossed above signal line',
      detected_at: today,
    });
  }
  if (macdHist < 0 && prevMacdHist > 0) {
    signals.push({
      type: 'bearish', name: 'MACD Bearish Crossover', strength: 3,
      description: 'MACD crossed below signal line',
      detected_at: today,
    });
  }

  // Bollinger Squeeze (very narrow band → major move incoming)
  if (bandWidth < 0.05) {
    signals.push({
      type: 'neutral', name: 'Bollinger Squeeze', strength: 4,
      description: `Band width at ${(bandWidth * 100).toFixed(1)}% — extremely compressed. Major move incoming.`,
      detected_at: today,
    });
  }

  // Stochastic oversold reversal
  const stochK = sp(stoch[0]?.SlowK ?? '50');
  const stochD = sp(stoch[0]?.SlowD ?? '50');
  const prevStochK = sp(stoch[1]?.SlowK ?? '50');
  if (stochK < 20 && stochK > stochD && prevStochK <= stochD) {
    signals.push({
      type: 'bullish', name: 'Stochastic Oversold Reversal', strength: 3,
      description: `Stoch K(${stochK.toFixed(1)}) crossing above D(${stochD.toFixed(1)}) in oversold territory`,
      detected_at: today,
    });
  }

  // Volume Spike (2x 20-day average)
  const avgVol20 = calcAvgVolume(daily, 20);
  const todayVol = sp(daily[0]?.volume ?? '0');
  if (avgVol20 > 0 && todayVol > avgVol20 * 2) {
    signals.push({
      type: 'neutral', name: 'Volume Spike', strength: 4,
      description: `Volume ${formatNumber(todayVol)} is ${(todayVol / avgVol20).toFixed(1)}x the 20-day average`,
      detected_at: today,
    });
  }

  // Price above/below 200 SMA
  if (sma200 > 0) {
    if (price > sma200 * 1.10) {
      signals.push({
        type: 'bullish', name: 'Strong Uptrend', strength: 2,
        description: `Price is ${(((price / sma200) - 1) * 100).toFixed(1)}% above 200-day SMA`,
        detected_at: today,
      });
    } else if (price < sma200 * 0.90) {
      signals.push({
        type: 'bearish', name: 'Strong Downtrend', strength: 2,
        description: `Price is ${(((sma200 / price) - 1) * 100).toFixed(1)}% below 200-day SMA`,
        detected_at: today,
      });
    }
  }

  const composite = weightedAvg([
    [trend_score, 0.30],
    [momentum_score, 0.30],
    [volatility_score, 0.15],
    [strength_score, 0.25],
  ]);

  return {
    trend_score,
    momentum_score,
    volatility_score,
    strength_score,
    composite,
    regime: determineRegime(composite, trend_score, strength_score),
    signals,
    raw: { rsi: latestRSI, macdHist, adx: latestADX, bbPosition, bandWidth, price, sma20, sma50, sma200 },
  };
}
