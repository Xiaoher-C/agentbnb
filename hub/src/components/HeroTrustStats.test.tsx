/**
 * HeroTrustStats component tests.
 * Covers the three render states: loading skeleton, populated chips, silent error.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroTrustStats from './HeroTrustStats.js';

const originalFetch = globalThis.fetch;

describe('HeroTrustStats', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders three skeleton chips while /api/stats is pending', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(<HeroTrustStats />);
    const skeletons = screen.getAllByTestId('hero-trust-skeleton');
    expect(skeletons).toHaveLength(3);
  });

  it('renders live chips once /api/stats resolves', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents_online: 12,
        total_capabilities: 34,
        total_exchanges: 0,
        executions_7d: 57,
        verified_providers_count: 5,
      }),
    }) as unknown as typeof fetch;

    render(<HeroTrustStats />);
    await waitFor(() => {
      expect(screen.getAllByTestId('hero-trust-value')).toHaveLength(3);
    });
    expect(screen.getByText('agents online')).toBeInTheDocument();
    expect(screen.getByText('executions this week')).toBeInTheDocument();
    expect(screen.getByText('verified providers')).toBeInTheDocument();
  });

  it('falls back to "skills available" when executions_7d is 0', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents_online: 3,
        total_capabilities: 9,
        total_exchanges: 0,
        executions_7d: 0,
        verified_providers_count: 1,
      }),
    }) as unknown as typeof fetch;

    render(<HeroTrustStats />);
    await waitFor(() => {
      expect(screen.getByText('skills available')).toBeInTheDocument();
    });
    expect(screen.queryByText('executions this week')).not.toBeInTheDocument();
  });

  it('hides silently when /api/stats errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { container } = render(<HeroTrustStats />);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
