/**
 * Tests for OwnerDashboard component.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import OwnerDashboard from './OwnerDashboard.js';

// Mock hooks
vi.mock('../hooks/useOwnerCards.js', () => ({
  useOwnerCards: vi.fn(),
}));
vi.mock('../hooks/useRequests.js', () => ({
  useRequests: vi.fn(),
}));

import { useOwnerCards } from '../hooks/useOwnerCards.js';
import { useRequests } from '../hooks/useRequests.js';

const defaultCards = [
  {
    id: 'card-1',
    owner: 'alice',
    name: 'GPT Summarizer',
    description: 'Summarizes text',
    level: 1 as const,
    inputs: [],
    outputs: [],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: { success_rate: 0.95, avg_latency_ms: 200 },
  },
];

const defaultRequests = [
  {
    id: 'req-1',
    card_id: 'card-1',
    card_name: 'GPT Summarizer',
    requester: 'bob',
    status: 'success' as const,
    latency_ms: 200,
    credits_charged: 5,
    created_at: '2026-03-15T06:00:00.000Z',
  },
];

describe('OwnerDashboard', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('shows owner name and published cards count', () => {
    vi.mocked(useOwnerCards).mockReturnValue({
      ownerName: 'alice',
      cards: defaultCards,
      balance: 50,
      loading: false,
      error: null,
    });
    vi.mocked(useRequests).mockReturnValue({
      requests: defaultRequests,
      loading: false,
      error: null,
    });

    render(<OwnerDashboard apiKey="test-key" />);
    // Owner name may be in a span with "— " prefix; use getByText with exact:false
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    // Published cards count shows as "1" in the Published stat
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('shows "Low credits" badge when balance < 10', () => {
    vi.mocked(useOwnerCards).mockReturnValue({
      ownerName: 'alice',
      cards: [],
      balance: 5,
      loading: false,
      error: null,
    });
    vi.mocked(useRequests).mockReturnValue({
      requests: [],
      loading: false,
      error: null,
    });

    render(<OwnerDashboard apiKey="test-key" />);
    expect(screen.getByText(/Low credits/i)).toBeInTheDocument();
    expect(screen.getByText(/5 remaining/i)).toBeInTheDocument();
  });

  it('does not show credit badge when balance >= 10', () => {
    vi.mocked(useOwnerCards).mockReturnValue({
      ownerName: 'alice',
      cards: [],
      balance: 100,
      loading: false,
      error: null,
    });
    vi.mocked(useRequests).mockReturnValue({
      requests: [],
      loading: false,
      error: null,
    });

    render(<OwnerDashboard apiKey="test-key" />);
    expect(screen.queryByText(/Low credits/i)).not.toBeInTheDocument();
  });

  it('shows per-period request counts (24h/7d/30d)', () => {
    vi.mocked(useOwnerCards).mockReturnValue({
      ownerName: 'alice',
      cards: [],
      balance: 50,
      loading: false,
      error: null,
    });
    vi.mocked(useRequests).mockReturnValue({
      requests: defaultRequests,
      loading: false,
      error: null,
    });

    render(<OwnerDashboard apiKey="test-key" />);
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
  });

  it('shows request history section with requests', () => {
    vi.mocked(useOwnerCards).mockReturnValue({
      ownerName: 'alice',
      cards: defaultCards,
      balance: 50,
      loading: false,
      error: null,
    });
    vi.mocked(useRequests).mockReturnValue({
      requests: defaultRequests,
      loading: false,
      error: null,
    });

    render(<OwnerDashboard apiKey="test-key" />);
    // "GPT Summarizer" appears in both cards list and request history table
    expect(screen.getAllByText('GPT Summarizer').length).toBeGreaterThan(0);
  });
});
