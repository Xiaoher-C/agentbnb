/**
 * Tests for EarningsChart component.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EarningsChart, { aggregateByDay } from './EarningsChart.js';

// recharts does not render in jsdom — mock all chart components as simple passthrough divs
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

import type { RequestLogEntry } from '../hooks/useRequests.js';

const sampleRequests: RequestLogEntry[] = [
  {
    id: 'req-1',
    card_id: 'card-1',
    card_name: 'GPT Summarizer',
    requester: 'bob',
    status: 'success',
    latency_ms: 200,
    credits_charged: 5,
    created_at: new Date().toISOString(),
  },
  {
    id: 'req-2',
    card_id: 'card-1',
    card_name: 'GPT Summarizer',
    requester: 'charlie',
    status: 'success',
    latency_ms: 150,
    credits_charged: 5,
    created_at: new Date().toISOString(),
  },
];

describe('EarningsChart', () => {
  it('renders without crashing when given an empty array', () => {
    render(<EarningsChart requests={[]} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders with sample RequestLogEntry data', () => {
    render(<EarningsChart requests={sampleRequests} />);
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });

  it('renders the chart wrapper', () => {
    render(<EarningsChart requests={sampleRequests} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });
});

describe('aggregateByDay', () => {
  it('produces exactly 30 data points for an empty array', () => {
    const result = aggregateByDay([]);
    expect(result).toHaveLength(30);
  });

  it('produces exactly 30 data points with sample data', () => {
    const result = aggregateByDay(sampleRequests);
    expect(result).toHaveLength(30);
  });

  it('aggregates credits for today into the last bucket', () => {
    const result = aggregateByDay(sampleRequests);
    const lastBucket = result[result.length - 1];
    // Both sample requests are from today — total should be 10
    expect(lastBucket.credits).toBe(10);
  });

  it('fills zero-credit days for past days without requests', () => {
    const result = aggregateByDay(sampleRequests);
    // All days except today should have 0 credits (no historical data)
    const pastDays = result.slice(0, 29);
    expect(pastDays.every((b) => b.credits === 0)).toBe(true);
  });

  it('returns buckets with MM-DD labels', () => {
    const result = aggregateByDay([]);
    for (const bucket of result) {
      expect(bucket.label).toMatch(/^\d{2}-\d{2}$/);
    }
  });
});
