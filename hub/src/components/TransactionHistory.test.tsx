/**
 * Tests for TransactionHistory component.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TransactionHistory from './TransactionHistory.js';
import type { CreditTransaction } from '../types.js';

const sampleTransactions: CreditTransaction[] = [
  {
    id: 'tx-1',
    owner: 'alice',
    amount: 50,
    reason: 'bootstrap',
    reference_id: null,
    created_at: '2026-03-15T08:00:00.000Z',
  },
  {
    id: 'tx-2',
    owner: 'alice',
    amount: 10,
    reason: 'settlement',
    reference_id: 'req-abc',
    created_at: '2026-03-15T09:00:00.000Z',
  },
  {
    id: 'tx-3',
    owner: 'alice',
    amount: -5,
    reason: 'escrow_hold',
    reference_id: null,
    created_at: '2026-03-15T10:00:00.000Z',
  },
];

describe('TransactionHistory', () => {
  it('renders loading skeletons when loading=true', () => {
    const { container } = render(<TransactionHistory transactions={[]} loading={true} />);
    // Skeletons are divs with animate-pulse class
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBe(3);
  });

  it('renders empty state when transactions=[]', () => {
    render(<TransactionHistory transactions={[]} loading={false} />);
    expect(screen.getByText(/No transactions yet/i)).toBeInTheDocument();
  });

  it('renders transaction items with cr prefix', () => {
    render(<TransactionHistory transactions={sampleTransactions} loading={false} />);
    expect(screen.getByText('cr +50')).toBeInTheDocument();
    expect(screen.getByText('cr +10')).toBeInTheDocument();
    expect(screen.getByText('cr -5')).toBeInTheDocument();
  });

  it('shows settlement badge in emerald', () => {
    render(<TransactionHistory transactions={sampleTransactions} loading={false} />);
    const settlementBadge = screen.getByText('settlement');
    expect(settlementBadge).toHaveClass('text-emerald-300');
  });

  it('shows escrow_hold badge in yellow', () => {
    render(<TransactionHistory transactions={sampleTransactions} loading={false} />);
    const escrowBadge = screen.getByText('escrow hold');
    expect(escrowBadge).toHaveClass('text-yellow-300');
  });

  it('shows bootstrap badge in blue', () => {
    render(<TransactionHistory transactions={sampleTransactions} loading={false} />);
    const bootstrapBadge = screen.getByText('bootstrap');
    expect(bootstrapBadge).toHaveClass('text-blue-300');
  });

  it('shows positive amounts in emerald color', () => {
    render(<TransactionHistory transactions={sampleTransactions} loading={false} />);
    const positiveAmount = screen.getByText('cr +50');
    expect(positiveAmount).toHaveClass('text-emerald-400');
  });

  it('shows negative amounts in red color', () => {
    render(<TransactionHistory transactions={sampleTransactions} loading={false} />);
    const negativeAmount = screen.getByText('cr -5');
    expect(negativeAmount).toHaveClass('text-red-400');
  });
});
