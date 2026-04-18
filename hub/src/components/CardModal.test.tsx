/**
 * CardModal component tests.
 * Covers all 5 requirements: MODAL-01 (request button), MODAL-02 (availability),
 * MODAL-03 (owner profile link), POLISH-02 (44px tap targets), POLISH-05 (iOS scroll lock).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import CardModal from './CardModal.js';
import type { HubCard } from '../types.js';

// Mock react-router useNavigate so we can track calls
const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

/** Factory for a minimal valid HubCard */
function makeCard(overrides: Partial<HubCard> = {}): HubCard {
  return {
    id: 'card-test-001',
    owner: 'alice',
    name: 'Text Summarizer',
    description: 'Summarizes long documents.',
    level: 1,
    inputs: [{ name: 'text', type: 'string', required: true }],
    outputs: [{ name: 'summary', type: 'string' }],
    pricing: { credits_per_call: 5 },
    availability: { online: true },
    metadata: {
      success_rate: 0.95,
      avg_latency_ms: 800,
    },
    ...overrides,
  };
}

afterEach(() => {
  mockNavigate.mockClear();
  // Restore body styles between tests
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  delete document.body.dataset.scrollY;
});

describe('CardModal — MODAL-01: Request this skill button', () => {
  it('renders "Request this skill" section with CopyButton containing exact CLI command', () => {
    const card = makeCard();
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Request this skill')).toBeInTheDocument();

    // The visible code pill shows exactly the CLI command — no trailing
    // bash comment. The slug is shown separately (see next test).
    const commandEl = screen.getByText(
      new RegExp(`^agentbnb request ${card.id}$`),
    );
    expect(commandEl).toBeInTheDocument();
    const rendered = commandEl.textContent ?? '';
    expect(rendered).toBe(`agentbnb request ${card.id}`);
    expect(rendered).not.toContain('#');
    expect(rendered).not.toContain('text-summarizer');
  });

  it('renders the human-readable slug + short id label separately, above the copy pill', () => {
    const card = makeCard();
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    // Visible slug + short id label — this is decoration, not clipboard content.
    // The label paragraph contains "<slug> · <shortId>". Scope the query to
    // that paragraph so we don't match the full id inside the copy pill.
    const shortId = card.id.slice(0, 8);
    const labelEl = screen.getByText((_, node) => {
      const text = node?.textContent ?? '';
      return text === `text-summarizer · ${shortId}`;
    });
    expect(labelEl).toBeInTheDocument();
    expect(within(labelEl).getByText(shortId)).toBeInTheDocument();
  });
});

describe('CardModal — MODAL-01 (regression): clipboard payload vs visible label', () => {
  it('writes the exact CLI command to the clipboard, not the visible slug label', async () => {
    const card = makeCard();

    // userEvent.setup() installs its own clipboard stub; install ours AFTER
    // so it wins, and keep it configurable for cleanup.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );

    // Visible slug label is present (proof the label can change without
    // affecting clipboard payload).
    expect(screen.getByText(/text-summarizer/)).toBeInTheDocument();

    // Click the copy icon button. CopyButton fires handleCopy() via `void`,
    // so we wait for the microtask to flush before asserting.
    const copyBtn = screen.getByTitle('Copy to clipboard');
    await user.click(copyBtn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    // Clipboard received the exact CLI command — no comment, no slug.
    expect(writeText).toHaveBeenCalledWith(`agentbnb request ${card.id}`);
  });
});

describe('CardModal — MODAL-02: Availability indicator with idle rate', () => {
  it('shows idle rate percentage when metadata.idle_rate is present', () => {
    const card = makeCard({ metadata: { idle_rate: 0.75 } });
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Idle 75%/)).toBeInTheDocument();
  });

  it('does not show idle rate when metadata.idle_rate is absent', () => {
    const card = makeCard({ metadata: {} });
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Idle \d+%/)).not.toBeInTheDocument();
  });

  it('shows Online when availability.online is true', () => {
    const card = makeCard({ availability: { online: true } });
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('shows Offline when availability.online is false', () => {
    const card = makeCard({ availability: { online: false } });
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});

describe('CardModal — MODAL-03: Owner profile link', () => {
  it('renders owner name as a clickable button', () => {
    const card = makeCard({ owner: 'alice' });
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    const ownerBtn = screen.getByRole('button', { name: '@alice' });
    expect(ownerBtn).toBeInTheDocument();
  });
});

describe('CardModal — POLISH-05: iOS-safe scroll lock', () => {
  it('uses position-fixed (not overflow:hidden) to lock scroll when modal opens', () => {
    const card = makeCard();
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(document.body.style.position).toBe('fixed');
    // Must NOT use the old overflow:hidden approach
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('restores body position when modal unmounts', () => {
    const card = makeCard();
    const { unmount } = render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    unmount();
    expect(document.body.style.position).toBe('');
  });
});

describe('CardModal — POLISH-02: Mobile tap targets', () => {
  it('close button has min-h-[44px] class for mobile tap target', () => {
    const card = makeCard();
    render(
      <MemoryRouter>
        <CardModal card={card} onClose={() => {}} />
      </MemoryRouter>,
    );
    const closeBtn = screen.getByLabelText('Close modal');
    expect(closeBtn.className).toMatch(/min-h-\[44px\]/);
  });
});

describe('CardModal — null guard', () => {
  it('renders nothing when card is null', () => {
    const { container } = render(
      <MemoryRouter>
        <CardModal card={null} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });
});
