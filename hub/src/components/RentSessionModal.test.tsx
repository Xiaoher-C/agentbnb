/**
 * RentSessionModal — E4 escrow balance gate tests.
 *
 * Covers:
 *   - cost breakdown shows base + 10% buffer = total
 *   - sufficient balance enables Confirm + renders the green confirmation
 *   - insufficient balance disables Confirm + renders the red warning
 *   - 0 balance renders the empty-pocket state with an Earn-credits CTA
 *   - loading state renders a skeleton on the balance row
 *   - on confirm the modal POSTs `/api/sessions` with `session_mode: true`
 *   - a 402 from the backend surfaces an inline insufficient-balance error
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const navigateMock = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const authedFetchMock = vi.fn();
const loadSessionMock = vi.fn();
vi.mock('../lib/authHeaders.js', () => ({
  authedFetch: (...args: unknown[]) => authedFetchMock(...args),
  loadSession: () => loadSessionMock(),
}));

interface BalanceShape {
  balance: number | null;
  currency: 'credits';
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const useEscrowBalanceMock = vi.fn<() => BalanceShape>();
vi.mock('../hooks/useEscrowBalance.js', () => ({
  BALANCE_CHANGED_EVENT: 'agentbnb:balance-changed',
  useEscrowBalance: () => useEscrowBalanceMock(),
}));

function setBalance(balance: number | null, loading = false, error: string | null = null): void {
  useEscrowBalanceMock.mockReturnValue({
    balance,
    currency: 'credits',
    loading,
    error,
    refetch: vi.fn().mockResolvedValue(undefined),
  });
}

import RentSessionModal from './RentSessionModal.js';
import type { RentableAgent } from '../hooks/useRentableAgents.js';

function makeAgent(overrides: Partial<RentableAgent> = {}): RentableAgent {
  return {
    agent_id: 'agent-001',
    name: 'Hannah Editor',
    owner_did: 'did:key:z6Mk-hannah',
    tagline: 'Long-form editor.',
    rating: null,
    runtime: 'hermes',
    member_since: '2026-01-01T00:00:00Z',
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
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  navigateMock.mockReset();
  authedFetchMock.mockReset();
  loadSessionMock.mockReset();
  useEscrowBalanceMock.mockReset();
  loadSessionMock.mockReturnValue({
    agentId: 'aaaaaaaaaaaaaaaa',
    publicKeyHex: 'pk',
    createdAt: '2026-05-04T00:00:00.000Z',
  });
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('RentSessionModal — E4 cost breakdown', () => {
  it('renders base cost, 10% buffer, and escrow-hold total', () => {
    setBalance(1000);
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    // 60 min × 2 = 120 base, ceil(120 × 0.1) = 12 buffer, total = 132
    const breakdown = screen.getByTestId('rent-cost-breakdown');
    expect(breakdown).toHaveTextContent('credits 2 / min');
    expect(breakdown).toHaveTextContent('60 min × rate');
    expect(breakdown).toHaveTextContent('credits 120');
    expect(breakdown).toHaveTextContent('Buffer (10%)');
    expect(breakdown).toHaveTextContent('credits 12');
    expect(breakdown).toHaveTextContent('Escrow hold');
    expect(breakdown).toHaveTextContent('credits 132');
  });

  it('recomputes cost when duration changes', async () => {
    setBalance(1000);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('radio', { name: '120 min' }));

    // 120 × 2 = 240 + ceil(24) = 264
    const confirm = screen.getByTestId('rent-confirm-button');
    expect(confirm).toHaveTextContent('credits 264');
  });
});

describe('RentSessionModal — E4 balance gate states', () => {
  it('enables Confirm and shows green confirmation when balance is sufficient', () => {
    setBalance(500);
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    const confirm = screen.getByTestId('rent-confirm-button');
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveTextContent('Confirm · credits 132');
    expect(screen.getByTestId('sufficient-balance')).toBeInTheDocument();
    expect(screen.getByTestId('sufficient-balance')).toHaveTextContent(
      /Will hold 132 credits in escrow/,
    );
    expect(screen.queryByTestId('insufficient-balance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-pocket')).not.toBeInTheDocument();
  });

  it('disables Confirm and shows red warning when balance is insufficient', () => {
    setBalance(50);
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    const confirm = screen.getByTestId('rent-confirm-button');
    expect(confirm).toBeDisabled();
    // Confirm is shown disabled, not hidden.
    expect(confirm).toBeVisible();

    const warn = screen.getByTestId('insufficient-balance');
    expect(warn).toBeInTheDocument();
    expect(warn).toHaveTextContent(/You need 82 more credits/);

    const topup = screen.getByRole('link', { name: /How to top up/i });
    expect(topup).toHaveAttribute('href', '#/credit-policy');
  });

  it('renders the empty-pocket state when balance is 0', () => {
    setBalance(0);
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('empty-pocket')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Earn credits/i })).toHaveAttribute(
      'href',
      '#/credit-policy',
    );
    expect(screen.getByTestId('rent-confirm-button')).toBeDisabled();
    // Empty-pocket and insufficient should be mutually exclusive.
    expect(screen.queryByTestId('insufficient-balance')).not.toBeInTheDocument();
  });

  it('renders a skeleton on the balance row while loading', () => {
    setBalance(null, true);
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('balance-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('rent-confirm-button')).toBeDisabled();
    expect(screen.queryByTestId('sufficient-balance')).not.toBeInTheDocument();
  });
});

describe('RentSessionModal — E4 confirm flow', () => {
  it('POSTs /api/sessions with session_mode: true and the buffered budget', async () => {
    setBalance(500);
    const user = userEvent.setup();
    authedFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: 'sess-1',
          share_token: 'tok-1',
          relay_url: 'wss://relay/r/sess-1',
          status: 'active',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={onClose} />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('rent-confirm-button'));

    await waitFor(() => {
      expect(authedFetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = authedFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.session_mode).toBe(true);
    expect(body.duration_min).toBe(60);
    expect(body.budget_credits).toBe(132); // 60 × 2 + 12
    expect(body.owner_did).toBe('did:key:z6Mk-hannah');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/s/sess-1');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 402 from the backend as an inline insufficient-balance error', async () => {
    setBalance(500);
    const user = userEvent.setup();
    authedFetchMock.mockResolvedValue(
      new Response('insufficient balance', { status: 402 }),
    );

    render(
      <MemoryRouter>
        <RentSessionModal agent={makeAgent({ pricing: { per_minute: 2 } })} onClose={() => {}} />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('rent-confirm-button'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/餘額不足/);
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
