import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CredentialBadge from './CredentialBadge.js';

describe('CredentialBadge', () => {
  // --- Reputation ---
  it('renders reputation badge with success rate', () => {
    render(
      <CredentialBadge
        type="reputation"
        successRate={0.97}
        totalTransactions={847}
        verified
      />,
    );
    expect(screen.getByText('97%')).toBeDefined();
    expect(screen.getByText('847 txns verified')).toBeDefined();
    expect(screen.getByTestId('verified-check')).toBeDefined();
  });

  it('applies emerald color for ≥95% success rate', () => {
    const { container } = render(
      <CredentialBadge type="reputation" successRate={0.96} />,
    );
    const circle = container.querySelector('.rounded-full');
    expect(circle?.className).toContain('text-emerald-400');
  });

  it('applies blue color for ≥85% success rate', () => {
    const { container } = render(
      <CredentialBadge type="reputation" successRate={0.90} />,
    );
    const circle = container.querySelector('.rounded-full');
    expect(circle?.className).toContain('text-blue-400');
  });

  it('applies amber color for <85% success rate', () => {
    const { container } = render(
      <CredentialBadge type="reputation" successRate={0.70} />,
    );
    const circle = container.querySelector('.rounded-full');
    expect(circle?.className).toContain('text-amber-400');
  });

  // --- Skill ---
  it('renders skill badge with name and milestone medal', () => {
    render(
      <CredentialBadge
        type="skill"
        skillName="Text Summarizer"
        milestone={500}
        verified
      />,
    );
    expect(screen.getByText('Text Summarizer')).toBeDefined();
    expect(screen.getByText('🥈')).toBeDefined();
    expect(screen.getByTestId('verified-check')).toBeDefined();
  });

  it('renders skill badge with 1000 milestone gold medal', () => {
    render(
      <CredentialBadge type="skill" skillName="Translator" milestone={1000} />,
    );
    expect(screen.getByText('🥇')).toBeDefined();
  });

  it('renders skill badge with 100 milestone bronze medal', () => {
    render(
      <CredentialBadge type="skill" skillName="OCR" milestone={100} />,
    );
    expect(screen.getByText('🥉')).toBeDefined();
  });

  // --- Team ---
  it('renders team badge with role and team size', () => {
    render(
      <CredentialBadge
        type="team"
        teamRole="Lead Coordinator"
        teamSize={5}
        verified
      />,
    );
    expect(screen.getByText('Lead Coordinator')).toBeDefined();
    expect(screen.getByText('Team of 5')).toBeDefined();
    expect(screen.getByTestId('verified-check')).toBeDefined();
  });

  // --- Verified ---
  it('does not show verified check when verified is false', () => {
    render(
      <CredentialBadge type="reputation" successRate={0.99} verified={false} />,
    );
    expect(screen.queryByTestId('verified-check')).toBeNull();
  });

  it('does not show verified check when verified is undefined', () => {
    render(<CredentialBadge type="team" teamRole="Worker" teamSize={3} />);
    expect(screen.queryByTestId('verified-check')).toBeNull();
  });
});
