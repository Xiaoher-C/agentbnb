/**
 * Tests for App layout shell — react-router integration.
 *
 * App is now a layout shell that requires a Router context (NavBar uses NavLink).
 * We use MemoryRouter to provide routing context in tests.
 * Tab-state-based navigation tests replaced by NavLink-based routing tests.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
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

/** Renders App inside MemoryRouter (required since App uses NavLink) */
function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('App layout shell', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders AgentBnB title', () => {
    renderApp();
    expect(screen.getByText('AgentBnB')).toBeInTheDocument();
  });

  it('renders Discover tab in nav', () => {
    renderApp();
    expect(screen.getByRole('link', { name: /Discover/i })).toBeInTheDocument();
  });

  it('renders Agents tab in nav', () => {
    renderApp();
    expect(screen.getByRole('link', { name: /Agents/i })).toBeInTheDocument();
  });

  it('renders Activity tab in nav', () => {
    renderApp();
    expect(screen.getByRole('link', { name: /Activity/i })).toBeInTheDocument();
  });

  it('renders Docs tab in nav', () => {
    renderApp();
    expect(screen.getByRole('link', { name: /Docs/i })).toBeInTheDocument();
  });

  it('renders My Agent dropdown button in nav', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /My Agent/i })).toBeInTheDocument();
  });

  it('shows "Get Started" CTA button when not authenticated', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
  });
});
