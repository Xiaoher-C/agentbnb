/**
 * Tests for App tab navigation.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import App from './App.js';

// Mock all hooks to avoid real network calls
vi.mock('./hooks/useCards.js', () => ({
  useCards: vi.fn().mockReturnValue({
    cards: [],
    loading: false,
    error: null,
    query: '',
    setQuery: vi.fn(),
    level: null,
    setLevel: vi.fn(),
    category: null,
    setCategory: vi.fn(),
    onlineOnly: false,
    setOnlineOnly: vi.fn(),
    availableCategories: [],
    retry: vi.fn(),
    agentsOnline: 0,
    totalCapabilities: 0,
    totalExchanges: 0,
  }),
}));

vi.mock('./hooks/useAuth.js', () => ({
  useAuth: vi.fn().mockReturnValue({
    apiKey: null,
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: false,
  }),
}));

vi.mock('./hooks/useOwnerCards.js', () => ({
  useOwnerCards: vi.fn().mockReturnValue({
    ownerName: null,
    cards: [],
    balance: null,
    loading: false,
    error: null,
  }),
}));

vi.mock('./hooks/useRequests.js', () => ({
  useRequests: vi.fn().mockReturnValue({
    requests: [],
    loading: false,
    error: null,
  }),
}));

describe('App tab navigation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders tab navigation with Discover, Share, My Agent tabs', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Discover/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Agent/i })).toBeInTheDocument();
  });

  it('clicking "My Agent" tab shows AuthGate (LoginForm when not authenticated)', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /My Agent/i }));
    // AuthGate renders LoginForm when apiKey is null
    expect(screen.getByPlaceholderText(/api.key/i)).toBeInTheDocument();
  });
});
