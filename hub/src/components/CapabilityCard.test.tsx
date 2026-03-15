/**
 * CapabilityCard component tests.
 * Covers compact-only view and category overflow.
 * Note: expanded/onToggle props removed — modal overlay added in plan 02.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CapabilityCard from './CapabilityCard.js';
import type { HubCard } from '../types.js';

const baseCard: HubCard = {
  id: 'card-abc-123',
  owner: 'alice',
  name: 'Text Summarizer',
  description: 'Summarizes long documents using OpenAI GPT-4.',
  level: 1,
  inputs: [
    { name: 'text', type: 'string', description: 'Input text', required: true },
  ],
  outputs: [
    { name: 'summary', type: 'string', description: 'Summarized text' },
  ],
  pricing: { credits_per_call: 5 },
  availability: { online: true },
  metadata: {
    apis_used: ['openai'],
    avg_latency_ms: 1200,
    success_rate: 0.91,
  },
};

const cardWith6Categories: HubCard = {
  ...baseCard,
  id: 'card-overflow',
  metadata: {
    apis_used: ['openai', 'elevenlabs', 'stability', 'kling', 'replicate'],
    tags: ['code'],
  },
};

describe('CapabilityCard', () => {
  it('renders card name, owner, and status dot in compact view', () => {
    render(
      <CapabilityCard card={baseCard} onClick={() => {}} />,
    );
    expect(screen.getByText('Text Summarizer')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    // Status dot via aria-label
    expect(screen.getByLabelText('Online')).toBeInTheDocument();
  });

  it('calls onClick when the card is clicked', () => {
    const onClick = vi.fn();
    render(
      <CapabilityCard card={baseCard} onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole('article'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render description or I/O schema (compact-only, no expand)', () => {
    render(
      <CapabilityCard card={baseCard} onClick={() => {}} />,
    );
    expect(screen.queryByText('Summarizes long documents using OpenAI GPT-4.')).not.toBeInTheDocument();
    expect(screen.queryByText('Inputs')).not.toBeInTheDocument();
    expect(screen.queryByText('Outputs')).not.toBeInTheDocument();
  });

  it('shows "+2 more" overflow chip when card has 6 inferable categories', () => {
    render(
      <CapabilityCard card={cardWith6Categories} onClick={() => {}} />,
    );
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('renders free-tier badge when free_tier > 0', () => {
    const cardWithFreeTier: HubCard = {
      ...baseCard,
      pricing: { credits_per_call: 5, free_tier: 50 },
    };
    render(
      <CapabilityCard card={cardWithFreeTier} onClick={() => {}} />,
    );
    expect(screen.getByText('50 free/mo')).toBeInTheDocument();
  });

  it('does not render free-tier badge when free_tier absent', () => {
    // baseCard has no free_tier field
    render(
      <CapabilityCard card={baseCard} onClick={() => {}} />,
    );
    expect(screen.queryByText(/free\/mo/)).not.toBeInTheDocument();
  });
});
