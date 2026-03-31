import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CredentialBadge from './CredentialBadge.js';

describe('CredentialBadge', () => {
  /* ---- reputation ---- */

  it('renders reputation badge with correct percentage text', () => {
    render(<CredentialBadge type="reputation" successRate={0.92} totalTransactions={150} />);
    expect(screen.getByTestId('reputation-pct')).toHaveTextContent('92%');
    expect(screen.getByText('150 txns verified')).toBeInTheDocument();
  });

  it('applies emerald color for success rate >= 95%', () => {
    const { container } = render(<CredentialBadge type="reputation" successRate={0.97} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-emerald-400');
    expect(badge.className).toContain('border-emerald-400/25');
  });

  it('applies blue color for success rate >= 85% and < 95%', () => {
    const { container } = render(<CredentialBadge type="reputation" successRate={0.90} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-blue-400');
    expect(badge.className).toContain('border-blue-400/25');
  });

  it('applies amber color for success rate < 85%', () => {
    const { container } = render(<CredentialBadge type="reputation" successRate={0.70} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-amber-400');
    expect(badge.className).toContain('border-amber-400/25');
  });

  /* ---- skill ---- */

  it('renders skill badge with name and milestone label', () => {
    render(<CredentialBadge type="skill" skillName="code-review" milestone={500} />);
    expect(screen.getByText('code-review')).toBeInTheDocument();
    expect(screen.getByText('500+ uses')).toBeInTheDocument();
  });

  it('defaults to 100+ uses when no milestone given', () => {
    render(<CredentialBadge type="skill" skillName="translate" />);
    expect(screen.getByText('100+ uses')).toBeInTheDocument();
  });

  /* ---- team ---- */

  it('renders team badge with role and team size', () => {
    render(<CredentialBadge type="team" teamRole="Coordinator" teamSize={5} />);
    expect(screen.getByText('Coordinator')).toBeInTheDocument();
    expect(screen.getByText('Team of 5')).toBeInTheDocument();
  });

  /* ---- verified ---- */

  it('shows verified checkmark when verified is true', () => {
    const { container } = render(<CredentialBadge type="reputation" successRate={0.99} verified />);
    const svgs = container.querySelectorAll('svg');
    // Reputation badge has no icon of its own, so the only SVG is the check
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show extra icon when verified is false or absent', () => {
    const { container } = render(<CredentialBadge type="reputation" successRate={0.99} />);
    const svgs = container.querySelectorAll('svg');
    // Reputation badge with no verified flag should have zero SVGs
    expect(svgs.length).toBe(0);
  });

  /* ---- missing optional props ---- */

  it('handles missing optional props gracefully for reputation', () => {
    const { container } = render(<CredentialBadge type="reputation" />);
    expect(screen.getByTestId('reputation-pct')).toHaveTextContent('0%');
    expect(container.firstChild).toBeTruthy();
  });

  it('handles missing optional props gracefully for team', () => {
    const { container } = render(<CredentialBadge type="team" />);
    expect(container.firstChild).toBeTruthy();
  });
});
