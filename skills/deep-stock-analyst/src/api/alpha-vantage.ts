/**
 * Alpha Vantage API client.
 * Free key: 25 req/day, 5 req/min → serialize calls with 200ms gap.
 * Standard analysis = 12 calls.
 */

import type {
  AllAVData,
  AVDailyPrice,
  AVRSIEntry,
  AVMACDEntry,
  AVBBandsEntry,
  AVStochEntry,
  AVADXEntry,
  AVOverview,
  AVIncomeStatement,
  AVBalanceSheet,
  AVCashFlow,
  AVEarnings,
  AVNewsSentiment,
} from './types.js';

const BASE_URL = 'https://www.alphavantage.co/query';
// Free key: 5 req/min → 13s between calls (safe)
// Premium (75 req/min): set AV_RATE_DELAY_MS=800
const RATE_DELAY_MS = parseInt(process.env['AV_RATE_DELAY_MS'] ?? '13000', 10);

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function avFetch(params: Record<string, string>, apiKey: string): Promise<unknown> {
  const url = new URL(BASE_URL);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status}: ${url.searchParams.get('function')}`);
  }
  const data = await res.json() as Record<string, unknown>;

  // AV returns error messages as JSON object with "Information" or "Note" keys
  if (typeof data['Information'] === 'string' && data['Information'].includes('rate limit')) {
    throw new Error(`Alpha Vantage rate limit hit: ${data['Information']}`);
  }
  if (typeof data['Note'] === 'string') {
    throw new Error(`Alpha Vantage note (likely rate limited): ${data['Note']}`);
  }

  return data;
}

/** Parse TIME_SERIES_DAILY_ADJUSTED into flat array sorted newest-first */
function parseDailySeries(raw: unknown): AVDailyPrice[] {
  const data = raw as Record<string, unknown>;
  const series = data['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
  if (!series) return [];

  return Object.entries(series)
    .map(([date, v]) => ({
      date,
      open: v['1. open'] ?? '0',
      high: v['2. high'] ?? '0',
      low: v['3. low'] ?? '0',
      close: v['4. close'] ?? '0',
      adjustedClose: v['5. adjusted close'] ?? '0',
      volume: v['6. volume'] ?? '0',
      dividendAmount: v['7. dividend amount'] ?? '0',
      splitCoefficient: v['8. split coefficient'] ?? '1',
    }))
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

/** Parse a technical indicator response into flat array sorted newest-first */
function parseIndicator<T>(raw: unknown, key: string): T[] {
  const data = raw as Record<string, unknown>;
  const series = data[key] as Record<string, T> | undefined;
  if (!series) return [];
  return Object.entries(series)
    .sort(([a], [b]) => b.localeCompare(a)) // newest first
    .map(([, v]) => v);
}

/**
 * Fetch all 12 Alpha Vantage endpoints for a standard analysis.
 * Calls are serialized with a short delay to avoid rate limits.
 */
export async function fetchAllData(ticker: string, apiKey: string): Promise<AllAVData> {
  const t = ticker.toUpperCase();
  const results: unknown[] = [];

  const calls: Array<Record<string, string>> = [
    { function: 'OVERVIEW', symbol: t },
    { function: 'INCOME_STATEMENT', symbol: t },
    { function: 'BALANCE_SHEET', symbol: t },
    { function: 'CASH_FLOW', symbol: t },
    { function: 'EARNINGS', symbol: t },
    { function: 'TIME_SERIES_DAILY_ADJUSTED', symbol: t, outputsize: 'full' },
    { function: 'RSI', symbol: t, interval: 'daily', time_period: '14', series_type: 'close' },
    { function: 'MACD', symbol: t, interval: 'daily', series_type: 'close' },
    { function: 'BBANDS', symbol: t, interval: 'daily', time_period: '20', series_type: 'close' },
    { function: 'STOCH', symbol: t, interval: 'daily' },
    { function: 'ADX', symbol: t, interval: 'daily', time_period: '14' },
    { function: 'NEWS_SENTIMENT', tickers: t, limit: '50', sort: 'LATEST' },
  ];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (i > 0) await sleep(RATE_DELAY_MS);
    results.push(await avFetch(call!, apiKey));
  }

  const [
    overview, income, balance, cashflow, earnings,
    dailyRaw, rsiRaw, macdRaw, bbandsRaw, stochRaw, adxRaw, newsRaw,
  ] = results;

  return {
    overview: overview as AVOverview,
    income: income as AVIncomeStatement,
    balance: balance as AVBalanceSheet,
    cashflow: cashflow as AVCashFlow,
    earnings: earnings as AVEarnings,
    daily: parseDailySeries(dailyRaw),
    rsi: parseIndicator<AVRSIEntry>(rsiRaw, 'Technical Analysis: RSI'),
    macd: parseIndicator<AVMACDEntry>(macdRaw, 'Technical Analysis: MACD'),
    bbands: parseIndicator<AVBBandsEntry>(bbandsRaw, 'Technical Analysis: BBANDS'),
    stoch: parseIndicator<AVStochEntry>(stochRaw, 'Technical Analysis: STOCH'),
    adx: parseIndicator<AVADXEntry>(adxRaw, 'Technical Analysis: ADX'),
    news: newsRaw as AVNewsSentiment,
  };
}
