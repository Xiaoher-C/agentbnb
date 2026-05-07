/**
 * AgentProfileCard component tests.
 *
 * Covers:
 *   - empty state (fresh agent, 404 evidence)
 *   - happy-path evidence rendering after the live fetch resolves
 *   - rating "X.Y★ (N ratings)" formatting
 *   - outcome links use share_token from live evidence
 *   - rent CTA fires onRent without bubbling onView
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import AgentProfileCard from './AgentProfileCard.js';
import type { RentableAgent } from '../hooks/useRentableAgents.js';

const baseAgent: RentableAgent = {
  agent_id: 'did:agentbnb:abc',
  name: 'Hannah Research Bot',
  owner_did: 'did:agentbnb:abc',
  tagline: 'Long-context investment research with verified market data tools.',
  rating: null,
  runtime: 'hermes',
  member_since: '2026-04-12T00:00:00Z',
  evidence: {
    platform_sessions: null,
    completed_tasks: null,
    repeat_renters: null,
    artifact_examples: [],
    verified_tools: [],
    response_reliability: null,
    renter_rating: null,
  },
  recent_outcomes: [],
  availability: [],
  pricing: { per_minute: 2 },
  tags: ['research', 'finance'],
};

const happyEvidence = {
  agent_id: 'did:agentbnb:abc',
  evidence: {
    platform_observed_sessions: 12,
    completed_tasks: 47,
    repeat_renters: 3,
    artifact_examples: [
      { share_token: 'abcdef0123456789', ended_at: 1_700_000_000_000, summary: 'completed' },
    ],
    verified_tools: ['serpapi', 'sec-filings'],
    response_reliability: 0.94,
    renter_rating_avg: 4.8,
    renter_rating_count: 32,
  },
  evidence_categories: [],
};

describe('AgentProfileCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the empty state when the evidence endpoint returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Agent not found' }),
      }),
    );

    render(<AgentProfileCard agent={baseAgent} onRent={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('New to AgentBnB — no rentals yet.')).toBeInTheDocument();
    });
  });

  it('renders live evidence rows after the endpoint resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => happyEvidence,
      }),
    );

    render(<AgentProfileCard agent={baseAgent} onRent={() => {}} />);

    // Counts surface as plural copy
    await waitFor(() => {
      expect(screen.getByText('12 past rentals')).toBeInTheDocument();
    });
    expect(screen.getByText('47 tasks done')).toBeInTheDocument();
    expect(screen.getByText('3 repeat renters')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('4.8★ (32 ratings)')).toBeInTheDocument();
    // Verified tools chips
    expect(screen.getByText('serpapi')).toBeInTheDocument();
    expect(screen.getByText('sec-filings')).toBeInTheDocument();
  });

  it('renders the outcome share token as a link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => happyEvidence,
      }),
    );

    render(<AgentProfileCard agent={baseAgent} onRent={() => {}} />);

    const link = await screen.findByRole('link', { name: /Outcome abcdef01/ });
    expect(link.getAttribute('href')).toBe('#/o/abcdef0123456789');
  });

  it('rent CTA fires onRent and does not trigger onView (stopPropagation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Agent not found' }),
      }),
    );

    const onRent = vi.fn();
    const onView = vi.fn();
    render(<AgentProfileCard agent={baseAgent} onRent={onRent} onView={onView} />);

    await waitFor(() =>
      expect(screen.getByText('New to AgentBnB — no rentals yet.')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /租用/ }));
    expect(onRent).toHaveBeenCalledTimes(1);
    expect(onView).not.toHaveBeenCalled();
  });

  it('does not collapse maturity into a single score (ADR-022)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => happyEvidence,
      }),
    );

    render(<AgentProfileCard agent={baseAgent} onRent={() => {}} />);

    // Multiple discrete evidence rows must be present — never one summary number
    await waitFor(() => {
      expect(screen.getByText('Past rentals')).toBeInTheDocument();
    });
    expect(screen.getByText('Tasks done')).toBeInTheDocument();
    expect(screen.getByText('Repeat renters')).toBeInTheDocument();
    expect(screen.getByText('Response reliability')).toBeInTheDocument();
    expect(screen.getByText('Renter rating')).toBeInTheDocument();
  });
});
