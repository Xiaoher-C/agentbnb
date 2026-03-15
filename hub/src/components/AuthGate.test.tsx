/**
 * AuthGate component tests.
 * Covers conditional rendering based on auth state.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuthGate from './AuthGate.js';

describe('AuthGate', () => {
  it('renders children when apiKey is present', () => {
    render(
      <AuthGate apiKey="my-api-key" onLogin={() => {}}>
        <div>Dashboard Content</div>
      </AuthGate>,
    );
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
  });

  it('renders LoginForm when apiKey is null', () => {
    render(
      <AuthGate apiKey={null} onLogin={() => {}}>
        <div>Dashboard Content</div>
      </AuthGate>,
    );
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paste your API key')).toBeInTheDocument();
  });

  it('renders LoginForm when apiKey is undefined', () => {
    render(
      <AuthGate apiKey={undefined} onLogin={() => {}}>
        <div>Dashboard Content</div>
      </AuthGate>,
    );
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });
});
