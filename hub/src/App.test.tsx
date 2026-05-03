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

  /**
   * Scope queries to the desktop nav so we don't collide with the v10 footer,
   * which deliberately re-exposes Discover / Docs as quick links.
   */
  function within() {
    const nav = screen.getByRole('navigation', { name: /desktop nav/i });
    return {
      getLink: (name: RegExp) =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        Array.from(nav.querySelectorAll('a')).find((a) => name.test(a.textContent ?? ''))!,
      getButton: (name: RegExp) =>
        Array.from(nav.querySelectorAll('button')).find((b) => name.test(b.textContent ?? '')),
    };
  }

  it('renders AgentBnB title', () => {
    renderApp();
    expect(screen.getByText('AgentBnB')).toBeInTheDocument();
  });

  it('renders Discover tab in nav', () => {
    renderApp();
    expect(within().getLink(/Discover/i)).toBeDefined();
  });

  it('renders Network tab in nav', () => {
    renderApp();
    expect(within().getLink(/Network/i)).toBeDefined();
  });

  it('renders Skill Inspector tab in nav', () => {
    renderApp();
    expect(within().getLink(/Skill Inspector/i)).toBeDefined();
  });

  it('renders Docs tab in nav', () => {
    renderApp();
    expect(within().getLink(/Docs/i)).toBeDefined();
  });

  it('renders For Providers button in nav', () => {
    renderApp();
    expect(within().getButton(/For Providers/i)).toBeDefined();
  });

  it('shows "Get Started" CTA link when not authenticated', () => {
    renderApp();
    // GetStartedCTA renders as an <a> tag, not a <button>
    expect(screen.getByRole('link', { name: /Get Started/i })).toBeInTheDocument();
  });
});
