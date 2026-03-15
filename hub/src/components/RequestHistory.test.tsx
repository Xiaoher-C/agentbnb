/**
 * Tests for RequestHistory component.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RequestHistory from './RequestHistory.js';
import type { RequestLogEntry } from '../hooks/useRequests.js';

const makeEntry = (overrides: Partial<RequestLogEntry> = {}): RequestLogEntry => ({
  id: 'req-1',
  card_id: 'card-abc',
  card_name: 'My GPT Tool',
  requester: 'agent-bob',
  status: 'success',
  latency_ms: 230,
  credits_charged: 5,
  created_at: '2026-03-15T06:00:00.000Z',
  ...overrides,
});

describe('RequestHistory', () => {
  it('renders table rows with card name, status, latency, credits, time', () => {
    const requests = [makeEntry()];
    render(<RequestHistory requests={requests} />);
    expect(screen.getByText('My GPT Tool')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('230 ms')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows empty state when no requests', () => {
    render(<RequestHistory requests={[]} />);
    expect(screen.getByText('No requests yet')).toBeInTheDocument();
  });

  it('shows failure status with appropriate styling', () => {
    const requests = [makeEntry({ status: 'failure' })];
    render(<RequestHistory requests={requests} />);
    const badge = screen.getByText('failure');
    expect(badge).toBeInTheDocument();
    // Red badge class
    expect(badge.className).toMatch(/red/);
  });

  it('shows timeout status', () => {
    const requests = [makeEntry({ status: 'timeout' })];
    render(<RequestHistory requests={requests} />);
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('renders multiple rows', () => {
    const requests = [
      makeEntry({ id: 'r1', card_name: 'Card Alpha' }),
      makeEntry({ id: 'r2', card_name: 'Card Beta' }),
    ];
    render(<RequestHistory requests={requests} />);
    expect(screen.getByText('Card Alpha')).toBeInTheDocument();
    expect(screen.getByText('Card Beta')).toBeInTheDocument();
  });
});
