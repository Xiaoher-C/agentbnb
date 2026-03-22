import type { AVNewsSentiment } from '../api/types.js';
import { mapRange, sp } from './utils.js';

export interface SentimentScore {
  news_sentiment: number;   // -1 to +1
  news_volume: number;      // relevant articles in feed
  bullish_ratio: number;    // 0–1
  topic_breakdown: Record<string, number>; // topic → avg relevance
  key_headlines: string[];  // top 5 by sentiment magnitude
  composite: number;        // 0–100
}

export function analyzeSentiment(newsData: AVNewsSentiment, ticker: string): SentimentScore {
  const articles = newsData.feed ?? [];
  const t = ticker.toUpperCase();

  // Filter to articles where this ticker has relevance_score > 0.5
  const relevant = articles.filter((a) => {
    const ts = a.ticker_sentiment?.find(
      (s) => s.ticker === t && sp(s.relevance_score) > 0.5,
    );
    return !!ts;
  });

  let totalSentiment = 0;
  let bullishCount = 0;

  for (const article of relevant) {
    const ts = article.ticker_sentiment.find((s) => s.ticker === t);
    if (!ts) continue;
    const score = sp(ts.ticker_sentiment_score);
    totalSentiment += score;
    if (score > 0.15) bullishCount++;
  }

  const news_sentiment = relevant.length > 0 ? totalSentiment / relevant.length : 0;
  const bullish_ratio = relevant.length > 0 ? bullishCount / relevant.length : 0.5;

  // Topic breakdown: topic → avg relevance across articles
  const topicMap: Record<string, number[]> = {};
  for (const article of relevant) {
    for (const topic of article.topics ?? []) {
      if (!topicMap[topic.topic]) topicMap[topic.topic] = [];
      topicMap[topic.topic]!.push(sp(topic.relevance_score));
    }
  }
  const topic_breakdown: Record<string, number> = {};
  for (const [topic, scores] of Object.entries(topicMap)) {
    topic_breakdown[topic] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Top 5 headlines sorted by overall sentiment magnitude
  const key_headlines = relevant
    .sort((a, b) =>
      Math.abs(sp(b.overall_sentiment_score)) - Math.abs(sp(a.overall_sentiment_score)),
    )
    .slice(0, 5)
    .map((a) => `[${a.overall_sentiment_label}] ${a.title}`);

  return {
    news_sentiment,
    news_volume: relevant.length,
    bullish_ratio,
    topic_breakdown,
    key_headlines,
    composite: mapRange(news_sentiment, -1, 1, 0, 100),
  };
}
