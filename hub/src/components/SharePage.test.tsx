/**
 * Tests for SharePage component.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SharePage from './SharePage.js';

vi.mock('../lib/authHeaders.js', () => ({
  authedFetch: vi.fn(),
}));

describe('SharePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('shows "Local agent runtime not detected" when local server unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    render(<SharePage apiKey="test-key" />);

    await waitFor(() => {
      // v10 reframe: heading no longer says "Server Not Running"
      expect(
        screen.getByText(/Local agent runtime not detected/i),
      ).toBeInTheDocument();
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

    // v10 reframe: publish CTA is "Make my agent rentable"
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Make my agent rentable/i }),
      ).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole('button', { name: /Make my agent rentable/i }),
    );

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

  it('renders the v10 rental framing — heading, privacy contract, RENTAL.md link', async () => {
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

    vi.stubGlobal('fetch', fetchMock);

    render(<SharePage apiKey="test-key" />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Publish your rentable agent/i }),
      ).toBeInTheDocument();
    });

    // Privacy contract callout
    expect(screen.getByText(/租用執行能力，不租用 agent 的腦與鑰匙/)).toBeInTheDocument();
    expect(screen.getByText(/Tools execute on your machine/i)).toBeInTheDocument();

    // RENTAL.md reference
    const rentalLink = screen.getByRole('link', { name: /see the example/i });
    expect(rentalLink).toHaveAttribute(
      'href',
      expect.stringContaining('hermes-plugin/examples/RENTAL.md'),
    );

    // Per-session pricing copy
    expect(screen.getByText(/Credits per 60-min session/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Price per rental session, not per call/i),
    ).toBeInTheDocument();
  });

  it('uses DID auth flow for draft fetches', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);

    const { authedFetch } = await import('../lib/authHeaders.js');
    vi.mocked(authedFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ cards: [] }),
    } as Response);

    render(<SharePage apiKey="__did__" />);

    await waitFor(() => {
      expect(screen.getByText(/No draft cards detected/i)).toBeInTheDocument();
    });

    expect(authedFetch).toHaveBeenCalledWith('/draft');
  });
});
