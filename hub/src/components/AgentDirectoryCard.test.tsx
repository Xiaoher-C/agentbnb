/**
 * AgentDirectoryCard component tests.
 * Covers rendering of name/owner, success rate, skill count, earned,
 * optional categories and performance tier, and click behavior.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AgentDirectoryCard from './AgentDirectoryCard.js';
import type { AgentProfile, Category } from '../types.js';

const baseAgent: AgentProfile = {
  owner: 'alice',
  skill_count: 3,
  success_rate: 0.91,
  total_earned: 1250,
  member_since: '2026-01-15T00:00:00Z',
};

const sampleCategories: Category[] = [
  { id: 'text_gen', label: 'Text Gen', iconName: 'FileText' },
  { id: 'tts', label: 'TTS', iconName: 'Volume2' },
];

describe('AgentDirectoryCard', () => {
  it('renders owner name, success rate, skill count, and earned credits', () => {
    render(<AgentDirectoryCard agent={baseAgent} onClick={() => {}} />);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('91% success')).toBeInTheDocument();
    expect(screen.getByText('3 skills')).toBeInTheDocument();
    expect(screen.getByText('cr 1250')).toBeInTheDocument();
  });

  it('renders "1 skill" (singular) when skill_count is 1', () => {
    render(
      <AgentDirectoryCard
        agent={{ ...baseAgent, skill_count: 1 }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('1 skill')).toBeInTheDocument();
  });

  it('renders "no runs yet" when success_rate is null', () => {
    render(
      <AgentDirectoryCard
        agent={{ ...baseAgent, success_rate: null }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('no runs yet')).toBeInTheDocument();
  });

  it('renders category chips when categories are provided', () => {
    render(
      <AgentDirectoryCard
        agent={baseAgent}
        categories={sampleCategories}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('Text Gen')).toBeInTheDocument();
    expect(screen.getByText('TTS')).toBeInTheDocument();
  });

  it('does not render chips when categories are omitted (graceful fallback)', () => {
    render(<AgentDirectoryCard agent={baseAgent} onClick={() => {}} />);
    expect(screen.queryByText('Text Gen')).not.toBeInTheDocument();
  });

  it('renders performance tier badge when provided', () => {
    render(
      <AgentDirectoryCard
        agent={baseAgent}
        performanceTier={2}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('Trusted')).toBeInTheDocument();
  });

  it('does not render a tier badge when performanceTier is omitted', () => {
    render(<AgentDirectoryCard agent={baseAgent} onClick={() => {}} />);
    expect(screen.queryByText('Listed')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('Trusted')).not.toBeInTheDocument();
  });

  it('calls onClick when the tile is clicked', () => {
    const onClick = vi.fn();
    render(<AgentDirectoryCard agent={baseAgent} onClick={onClick} />);
    fireEvent.click(screen.getByRole('article'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
