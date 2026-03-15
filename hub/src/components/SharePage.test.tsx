/**
 * Tests for SharePage component.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SharePage from './SharePage.js';

describe('SharePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('shows "Run agentbnb serve first" when local server unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    render(<SharePage apiKey="test-key" />);

    await waitFor(() => {
      // The "Server Not Running" heading appears when unreachable
      expect(screen.getByText(/Server Not Running/i)).toBeInTheDocument();
      // The command block contains "agentbnb serve" text
      expect(screen.getAllByText(/agentbnb serve/i).length).toBeGreaterThan(0);
    });
  });

  it('fetches /draft on mount and shows editable card preview', async () => {
    const draftCard = {
      id: 'draft-1',
      owner: 'alice',
      name: 'My GPT Tool',
      description: 'A great tool',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: false },
      metadata: {},
    };

    const fetchMock = vi.fn();
    // /health check succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    // /draft returns draft card
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cards: [draftCard] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SharePage apiKey="test-key" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('My GPT Tool')).toBeInTheDocument();
    });

    // Verify /draft was called with auth header
    const draftCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes('draft'));
    expect(draftCall).toBeDefined();
    expect((draftCall?.[1] as RequestInit)?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });
  });

  it('shows publish button that calls POST /cards with edited card data', async () => {
    const draftCard = {
      id: 'draft-1',
      owner: 'alice',
      name: 'My GPT Tool',
      description: 'A great tool',
      level: 1,
      inputs: [],
      outputs: [],
      pricing: { credits_per_call: 5 },
      availability: { online: false },
      metadata: {},
    };

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ cards: [draftCard] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'published-1' }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<SharePage apiKey="test-key" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Publish$/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^Publish$/i }));

    await waitFor(() => {
      const publishCall = fetchMock.mock.calls.find((c) => {
        const url = c[0] as string;
        const opts = c[1] as RequestInit;
        return url === '/cards' && opts?.method === 'POST';
      });
      expect(publishCall).toBeDefined();
    });
  });

  it('shows server running status when health check succeeds but no draft cards', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ cards: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<SharePage apiKey="test-key" />);

    await waitFor(() => {
      expect(screen.getByText(/No draft cards detected/i)).toBeInTheDocument();
    });
  });
});
