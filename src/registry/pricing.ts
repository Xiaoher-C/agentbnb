import type Database from 'better-sqlite3';
import { searchCards } from './matcher.js';
import type { CapabilityCardV2, Skill } from '../types/index.js';

/**
 * Aggregate pricing statistics for skills matching a search query.
 */
export interface PricingStats {
  min: number;
  max: number;
  median: number;
  mean: number;
  count: number;
}

/**
 * Searches the registry for skills matching the given query and computes
 * aggregate pricing statistics (min, max, median, mean, count).
 *
 * For v2.0 cards, extracts credits_per_call from each skill whose name or
 * description matches the query terms. For v1.0 cards, uses the card-level
 * pricing.credits_per_call.
 *
 * @param db - Open registry database instance.
 * @param query - Search query string to match skills against.
 * @returns PricingStats with computed aggregates, or all zeros if no matches.
 */
export function getPricingStats(db: Database.Database, query: string): PricingStats {
  const cards = searchCards(db, query);
  const prices: number[] = [];

  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

  for (const card of cards) {
    const v2 = card as unknown as CapabilityCardV2;
    if (v2.skills && v2.skills.length > 0) {
      // v2.0 card: extract pricing from matching skills only
      for (const skill of v2.skills) {
        const nameMatch = skillMatchesQuery(skill, queryWords);
        if (nameMatch) {
          prices.push(skill.pricing.credits_per_call);
        }
      }
    } else {
      // v1.0 card: use card-level pricing
      prices.push(card.pricing.credits_per_call);
    }
  }

  if (prices.length === 0) {
    return { min: 0, max: 0, median: 0, mean: 0, count: 0 };
  }

  prices.sort((a, b) => a - b);

  const min = prices[0]!;
  const max = prices[prices.length - 1]!;
  const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const median = computeMedian(prices);

  return { min, max, median, mean, count: prices.length };
}

/**
 * Checks if a skill's name or description contains any of the query words.
 */
function skillMatchesQuery(skill: Skill, queryWords: string[]): boolean {
  const text = `${skill.name} ${skill.description}`.toLowerCase();
  return queryWords.some((word) => text.includes(word));
}

/**
 * Computes the median of a sorted array of numbers.
 * For even-length arrays, returns the average of the two middle values.
 */
function computeMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}
