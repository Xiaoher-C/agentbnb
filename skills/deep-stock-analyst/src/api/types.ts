/** Alpha Vantage API response types */

export interface AVOverview {
  Symbol: string;
  Name: string;
  Description: string;
  Sector: string;
  Industry: string;
  MarketCapitalization: string;
  PERatio: string;
  ForwardPE: string;
  PEGRatio: string;
  PriceToSalesRatioTTM: string;
  PriceToBookRatio: string;
  EVToEBITDA: string;
  EVToRevenue: string;
  GrossProfitTTM: string;
  RevenueTTM: string;
  OperatingMarginTTM: string;
  ProfitMargin: string;
  ReturnOnEquityTTM: string;
  ReturnOnAssetsTTM: string;
  DebtToEquity: string;
  CurrentRatio: string;
  QuickRatio: string;
  OperatingCashflowTTM: string;
  RevenuePerShareTTM: string;
  EPS: string;
  DilutedEPSTTM: string;
  Beta: string;
  '52WeekHigh': string;
  '52WeekLow': string;
  '50DayMovingAverage': string;
  '200DayMovingAverage': string;
  SharesOutstanding: string;
  DividendYield: string;
  ExDividendDate: string;
  AnalystTargetPrice: string;
  AnalystRatingStrongBuy: string;
  AnalystRatingBuy: string;
  AnalystRatingHold: string;
  AnalystRatingSell: string;
  AnalystRatingStrongSell: string;
}

export interface AVQuarterlyReport {
  fiscalDateEnding: string;
  reportedCurrency: string;
  totalRevenue: string;
  netIncome: string;
  grossProfit: string;
  ebit: string;
  ebitda: string;
  operatingIncome: string;
  interestExpense: string;
  researchAndDevelopment: string;
  sellingGeneralAndAdministrative: string;
}

export interface AVAnnualReport {
  fiscalDateEnding: string;
  reportedCurrency: string;
  totalRevenue: string;
  netIncome: string;
  grossProfit: string;
  ebit: string;
  ebitda: string;
  operatingIncome: string;
  interestExpense: string;
  researchAndDevelopment: string;
  sellingGeneralAndAdministrative: string;
}

export interface AVIncomeStatement {
  symbol: string;
  annualReports: AVAnnualReport[];
  quarterlyReports: AVQuarterlyReport[];
}

export interface AVBalanceSheetReport {
  fiscalDateEnding: string;
  reportedCurrency: string;
  totalAssets: string;
  totalCurrentAssets: string;
  totalNonCurrentAssets: string;
  totalLiabilities: string;
  totalCurrentLiabilities: string;
  totalNonCurrentLiabilities: string;
  totalShareholderEquity: string;
  longTermDebt: string;
  shortTermDebt: string;
  cashAndCashEquivalentsAtCarryingValue: string;
  currentNetReceivables: string;
  inventory: string;
}

export interface AVBalanceSheet {
  symbol: string;
  annualReports: AVBalanceSheetReport[];
  quarterlyReports: AVBalanceSheetReport[];
}

export interface AVCashFlowReport {
  fiscalDateEnding: string;
  reportedCurrency: string;
  operatingCashflow: string;
  capitalExpenditures: string;
  cashflowFromInvestment: string;
  cashflowFromFinancing: string;
  netIncome: string;
  dividendPayout: string;
  changeInOperatingAssets: string;
  changeInOperatingLiabilities: string;
}

export interface AVCashFlow {
  symbol: string;
  annualReports: AVCashFlowReport[];
  quarterlyReports: AVCashFlowReport[];
}

export interface AVQuarterlyEarning {
  fiscalDateEnding: string;
  reportedDate: string;
  reportedEPS: string;
  estimatedEPS: string;
  surprise: string;
  surprisePercentage: string;
}

export interface AVEarnings {
  symbol: string;
  quarterlyEarnings: AVQuarterlyEarning[];
  annualEarnings: Array<{ fiscalDateEnding: string; reportedEPS: string }>;
}

export interface AVDailyPrice {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  adjustedClose: string;
  volume: string;
  dividendAmount: string;
  splitCoefficient: string;
}

export interface AVDailyTimeSeries {
  'Meta Data': {
    '1. Information': string;
    '2. Symbol': string;
    '3. Last Refreshed': string;
    '4. Output Size': string;
    '5. Time Zone': string;
  };
  'Time Series (Daily)': Record<string, {
    '1. open': string;
    '2. high': string;
    '3. low': string;
    '4. close': string;
    '5. adjusted close': string;
    '6. volume': string;
    '7. dividend amount': string;
    '8. split coefficient': string;
  }>;
}

export interface AVRSIEntry {
  RSI: string;
}

export interface AVMACDEntry {
  MACD: string;
  MACD_Hist: string;
  MACD_Signal: string;
}

export interface AVBBandsEntry {
  'Real Upper Band': string;
  'Real Middle Band': string;
  'Real Lower Band': string;
}

export interface AVStochEntry {
  SlowK: string;
  SlowD: string;
}

export interface AVADXEntry {
  ADX: string;
}

export interface AVIndicatorResponse<T> {
  'Meta Data': Record<string, string>;
  'Technical Analysis: RSI'?: Record<string, T>;
  'Technical Analysis: MACD'?: Record<string, T>;
  'Technical Analysis: BBANDS'?: Record<string, T>;
  'Technical Analysis: STOCH'?: Record<string, T>;
  'Technical Analysis: ADX'?: Record<string, T>;
}

export interface AVNewsTickerSentiment {
  ticker: string;
  relevance_score: string;
  ticker_sentiment_score: string;
  ticker_sentiment_label: string;
}

export interface AVNewsArticle {
  title: string;
  url: string;
  time_published: string;
  summary: string;
  overall_sentiment_score: string;
  overall_sentiment_label: string;
  ticker_sentiment: AVNewsTickerSentiment[];
  topics: Array<{ topic: string; relevance_score: string }>;
}

export interface AVNewsSentiment {
  feed: AVNewsArticle[];
}

export interface AllAVData {
  overview: AVOverview;
  income: AVIncomeStatement;
  balance: AVBalanceSheet;
  cashflow: AVCashFlow;
  earnings: AVEarnings;
  daily: AVDailyPrice[];
  rsi: AVRSIEntry[];
  macd: AVMACDEntry[];
  bbands: AVBBandsEntry[];
  stoch: AVStochEntry[];
  adx: AVADXEntry[];
  news: AVNewsSentiment;
}
