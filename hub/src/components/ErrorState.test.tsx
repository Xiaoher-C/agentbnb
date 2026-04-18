/**
 * ErrorState + InlineErrorBanner tests.
 *
 * ErrorState is the fallback surface shown when the registry is unreachable
 * and no cached cards are available. InlineErrorBanner is the compact banner
 * shown above retained stale cards.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ErrorState, { InlineErrorBanner } from './ErrorState.js';

describe('ErrorState (empty-grid fallback)', () => {
  it('renders the friendlier empty-grid copy and a working retry', () => {
    const onRetry = vi.fn();
    render(
      <ErrorState onRetry={onRetry} message="Registry unreachable: fetch failed" />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/We can't reach the registry right now/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Showing what AgentBnB does in the meantime/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Registry unreachable: fetch failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the raw error line when no message is provided', () => {
    render(<ErrorState onRetry={() => {}} />);

    expect(screen.queryByText(/fetch failed/i)).not.toBeInTheDocument();
  });
});

describe('InlineErrorBanner (stale-data banner)', () => {
  it('renders a compact alert with the raw error and a working retry', () => {
    const onRetry = vi.fn();
    render(<InlineErrorBanner onRetry={onRetry} message="Registry unreachable: fetch failed" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Registry unreachable — results may be stale/i)).toBeInTheDocument();
    expect(screen.getByText('Registry unreachable: fetch failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
