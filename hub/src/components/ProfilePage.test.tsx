/**
 * ProfilePage v10 reframe tests.
 *
 * Covers:
 *   - hero renders boring-avatar, name, runtime, RENT CTA
 *   - Maturity Evidence shows discrete rows (never collapses to single score)
 *   - Past Outcomes link to /o/:share_token
 *   - Skill tags render as a chip row at the bottom
 *   - Empty state — fresh agent still rendered + still rentable
 *   - Loading skeleton while data fetches
 *   - Rent CTA opens RentSessionModal
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { AgentProfileV2 } from '../types.js';

// Stub the Rent modal so we don't pull in escrow/balance plumbing.
vi.mock('./RentSessionModal.js', () => ({
  default: ({ agent }: { agent: { name: string } | null }) =>
    agent === null ? null : <div data-testid="rent-modal">RentModalOpen:{agent.name}</div>,
}));

// Mock useNavigate so the redirect on missing :owner doesn't blow up.
const navigateMock = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Profile data is mocked at the hook level — the underlying fetcher is too
// chatty to set up via global fetch mocks for this many shapes.
interface UseAgentProfileShape {
  profileV2: AgentProfileV2 | null;
  profile: null;
  skills: never[];
  recentActivity: never[];
  loading: boolean;
  error: string | null;
}
const useAgentProfileMock = vi.fn<() => UseAgentProfileShape>();
vi.mock('../hooks/useAgents.js', () => ({
  useAgentProfile: () => useAgentProfileMock(),
}));

// Maturity evidence is fetched live — mock the hook directly so each test
// can dial the response without setting up MSW.
interface EvidenceShape {
  evidence: {
    platform_observed_sessions: number;
    completed_tasks: number;
    repeat_renters: number;
    artifact_examples: { share_token: string; ended_at: number; summary: string }[];
    verified_tools: string[];
    response_reliability: number;
    renter_rating_avg: number | null;
    renter_rating_count: number;
  } | null;
  categories: [];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}
const useMaturityEvidenceMock = vi.fn<() => EvidenceShape>();
vi.mock('../hooks/useMaturityEvidence.js', () => ({
  useMaturityEvidence: () => useMaturityEvidenceMock(),
}));

import ProfilePage from './ProfilePage.js';

function makeProfile(overrides: Partial<AgentProfileV2> = {}): AgentProfileV2 {
  const base: AgentProfileV2 = {
    owner: 'hannah',
    agent_id: 'did:agentbnb:hannah-abc-001',
    agent_name: 'Hannah Research Bot',
    short_description: 'Long-context research with verified market data tools.',
    joined_at: '2026-01-15T00:00:00Z',
    last_active: '2026-05-01T00:00:00Z',
    performance_tier: 1,
    verification_badges: [],
    authority: {
      authority_source: 'platform',
      verification_status: 'observed',
      scope: [],
      constraints: {},
    },
    suitability: undefined,
    trust_metrics: {
      total_executions: 100,
      successful_executions: 94,
      success_rate: 0.94,
      avg_latency_ms: 1200,
      refund_rate: 0.02,
      repeat_use_rate: 0.32,
      trend_7d: [],
      snapshot_at: null,
      aggregation_window: '7d',
    },
    execution_proofs: [],
    learning: {
      known_limitations: [],
      common_failure_patterns: [],
      recent_improvements: [],
      critiques: [],
    },
    skills: [
      {
        id: 'skill-001',
        owner: 'hannah',
        agent_id: 'did:agentbnb:hannah-abc-001',
        name: 'SEC filing summariser',
        description: 'Summarises 10-K filings.',
        level: 2,
        inputs: [],
        outputs: [],
        pricing: { credits_per_call: 5, credits_per_minute: 2 },
        availability: { online: true },
        capability_types: ['research', 'finance'],
        metadata: {
          tags: ['sec-filings', 'finance'],
          apis_used: ['serpapi', 'sec-filings'],
        },
      },
    ],
    recent_activity: [],
    profile: {
      owner: 'hannah',
      agent_id: 'did:agentbnb:hannah-abc-001',
      skill_count: 1,
      success_rate: 0.94,
      total_earned: 200,
      member_since: '2026-01-15T00:00:00Z',
    },
  };
  return { ...base, ...overrides };
}

function renderProfilePage(owner = 'hannah') {
  return render(
    <MemoryRouter initialEntries={[`/agents/${encodeURIComponent(owner)}`]}>
      <Routes>
        <Route path="/agents/:owner" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfilePage v10 — hero', () => {
  it('renders agent name, runtime badge, tagline, and Rent CTA', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: {
        platform_observed_sessions: 12,
        completed_tasks: 47,
        repeat_renters: 3,
        artifact_examples: [],
        verified_tools: ['serpapi', 'sec-filings'],
        response_reliability: 0.94,
        renter_rating_avg: 4.8,
        renter_rating_count: 32,
      },
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    // Name as the hero heading
    expect(
      screen.getByRole('heading', { level: 1, name: /Hannah Research Bot/i }),
    ).toBeInTheDocument();
    // Tagline
    expect(
      screen.getByText(/Long-context research with verified market data tools\./i),
    ).toBeInTheDocument();
    // Runtime is detected from metadata.tags / apis_used — no Hermes/OpenClaw
    // hint here so falls back to "—". (intentional honest label, not "Hermes")
    expect(screen.getByLabelText(/Runtime/)).toBeInTheDocument();
    // Rent CTA — uses cr 2/min from credits_per_minute
    expect(screen.getByTestId('rent-cta')).toHaveTextContent(/Rent for cr 2\/min/);
    // Rating chip is rendered in the hero (the Maturity row also shows it,
    // but that's by design — the chip is the at-a-glance copy and the row is
    // the discrete-evidence copy). aria-label disambiguates the hero one.
    expect(screen.getByLabelText(/Rating 4\.8★ \(32 ratings\)/)).toBeInTheDocument();
  });

  it('rent CTA opens the rent modal', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: null,
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    expect(screen.queryByTestId('rent-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rent-cta'));
    expect(screen.getByTestId('rent-modal')).toBeInTheDocument();
    expect(screen.getByTestId('rent-modal')).toHaveTextContent(
      /RentModalOpen:Hannah Research Bot/,
    );
  });
});

describe('ProfilePage v10 — Maturity Evidence (ADR-022)', () => {
  it('renders discrete evidence rows, never a single collapsed score', async () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: {
        platform_observed_sessions: 12,
        completed_tasks: 47,
        repeat_renters: 3,
        artifact_examples: [],
        verified_tools: ['serpapi', 'sec-filings'],
        response_reliability: 0.94,
        renter_rating_avg: 4.8,
        renter_rating_count: 32,
      },
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    // Each category surfaces as its own row label
    await waitFor(() => {
      expect(screen.getByText('Past rentals')).toBeInTheDocument();
    });
    expect(screen.getByText('Tasks done')).toBeInTheDocument();
    expect(screen.getByText('Repeat renters')).toBeInTheDocument();
    expect(screen.getByText('Response reliability')).toBeInTheDocument();
    expect(screen.getByText('Renter rating')).toBeInTheDocument();

    // Values show as discrete plural copy
    expect(screen.getByText('12 past rentals')).toBeInTheDocument();
    expect(screen.getByText('47 tasks done')).toBeInTheDocument();
    expect(screen.getByText('3 repeat renters')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();

    // Verified tools surface as chips inside the Verified tools group.
    // (The same string may also appear in the demoted skill-tags chip row,
    // which is fine — that's two distinct surfaces.)
    const toolsGroup = screen.getByLabelText('Verified tools');
    expect(toolsGroup).toHaveTextContent('serpapi');
    expect(toolsGroup).toHaveTextContent('sec-filings');
  });

  it('renders the empty state for an agent with no rentals — but stays rentable', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    // 404 / fresh agent → null evidence
    useMaturityEvidenceMock.mockReturnValue({
      evidence: null,
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    expect(screen.getByText('New to AgentBnB — no rentals yet.')).toBeInTheDocument();
    // Hero + Rent CTA still rendered
    expect(screen.getByTestId('rent-cta')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Hannah Research Bot/i }),
    ).toBeInTheDocument();
  });
});

describe('ProfilePage v10 — past outcomes', () => {
  it('renders outcome links pointing at /o/:share_token', async () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: {
        platform_observed_sessions: 5,
        completed_tasks: 12,
        repeat_renters: 1,
        artifact_examples: [
          {
            share_token: 'sharetoken-abc-001',
            ended_at: 1_700_000_000_000,
            summary: 'Drafted a research brief',
          },
          {
            share_token: 'sharetoken-abc-002',
            ended_at: 1_700_000_001_000,
            summary: 'Compiled comparative metrics',
          },
        ],
        verified_tools: [],
        response_reliability: 1,
        renter_rating_avg: null,
        renter_rating_count: 0,
      },
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    const link1 = await screen.findByRole('link', { name: /Drafted a research brief/i });
    expect(link1.getAttribute('href')).toBe('#/o/sharetoken-abc-001');
    const link2 = screen.getByRole('link', { name: /Compiled comparative metrics/i });
    expect(link2.getAttribute('href')).toBe('#/o/sharetoken-abc-002');
  });

  it('omits the past outcomes section entirely when there are none', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: {
        platform_observed_sessions: 1,
        completed_tasks: 1,
        repeat_renters: 0,
        artifact_examples: [],
        verified_tools: [],
        response_reliability: 1,
        renter_rating_avg: null,
        renter_rating_count: 0,
      },
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    expect(screen.queryByText(/Past outcomes/)).not.toBeInTheDocument();
  });
});

describe('ProfilePage v10 — skill tags', () => {
  it('renders capability_types and metadata.tags as small chips', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: makeProfile(),
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: null,
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    // capability_types
    expect(screen.getByText('research')).toBeInTheDocument();
    expect(screen.getByText('finance')).toBeInTheDocument();
    // metadata.tags
    expect(screen.getByText('sec-filings')).toBeInTheDocument();

    // Skill tag chips live in their own labelled section, not at the top
    const skillsSection = screen.getByLabelText('Skill tags');
    expect(skillsSection).toBeInTheDocument();
  });
});

describe('ProfilePage v10 — loading + error states', () => {
  it('renders a skeleton while data is loading', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: null,
      profile: null,
      skills: [],
      recentActivity: [],
      loading: true,
      error: null,
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: null,
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();

    expect(screen.getByLabelText(/Loading agent profile/i)).toBeInTheDocument();
    expect(screen.queryByTestId('rent-cta')).not.toBeInTheDocument();
  });

  it('surfaces an error message when the profile fetch fails', () => {
    useAgentProfileMock.mockReturnValue({
      profileV2: null,
      profile: null,
      skills: [],
      recentActivity: [],
      loading: false,
      error: 'Agent not found',
    });
    useMaturityEvidenceMock.mockReturnValue({
      evidence: null,
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderProfilePage();
    expect(screen.getByText('Agent not found')).toBeInTheDocument();
  });
});
