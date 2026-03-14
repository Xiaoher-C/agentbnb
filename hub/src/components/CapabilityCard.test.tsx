/**
 * CapabilityCard component tests.
 * Covers compact view, expand-in-place behavior, and category overflow.
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
      <CapabilityCard card={baseCard} expanded={false} onToggle={() => {}} />,
    );
    expect(screen.getByText('Text Summarizer')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    // Status dot via aria-label
    expect(screen.getByLabelText('Online')).toBeInTheDocument();
  });

  it('calls onToggle when the card is clicked', () => {
    const onToggle = vi.fn();
    render(
      <CapabilityCard card={baseCard} expanded={false} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('article'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows description and I/O schema section when expanded', () => {
    render(
      <CapabilityCard card={baseCard} expanded={true} onToggle={() => {}} />,
    );
    expect(
      screen.getByText('Summarizes long documents using OpenAI GPT-4.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Inputs')).toBeInTheDocument();
    expect(screen.getByText('Outputs')).toBeInTheDocument();
  });

  it('shows "+2 more" overflow chip when card has 6 inferable categories', () => {
    render(
      <CapabilityCard card={cardWith6Categories} expanded={false} onToggle={() => {}} />,
    );
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });
});
