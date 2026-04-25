/**
 * AgentBnB Hub — SPA entry point.
 *
 * Uses react-router createHashRouter for hash-based client-side routing.
 * Hash mode ("#/...") requires no Fastify fallback config change — the server
 * always serves the same HTML file and the router handles the rest.
 *
 * Route tree:
 *   /            → DiscoverPage (index)
 *   /agents      → placeholder (Phase 13 Plan 03)
 *   /agents/:owner → placeholder (Phase 13 Plan 03)
 *   /activity    → ActivityFeed (Phase 13 Plan 01)
 *   /docs        → DocsPage (Phase 13 Plan 02)
 *   /share       → SharePage (existing component)
 *   /myagent     → OwnerDashboard behind AuthGate (existing component)
 *   /settings    → placeholder
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Navigate, createHashRouter, RouterProvider, useOutletContext } from 'react-router';
import './index.css';
import App from './App.js';
import DiscoverPage from './pages/DiscoverPage.js';
import SharePage from './components/SharePage.js';
import AuthGate from './components/AuthGate.js';
import OwnerDashboard from './components/OwnerDashboard.js';
import AgentList from './components/AgentList.js';
import ProfilePage from './components/ProfilePage.js';
import ActivityFeed from './components/ActivityFeed.js';
import DocsPage from './components/DocsPage.js';
import EvolutionPage from './pages/EvolutionPage.js';
import CreditPolicyPage from './pages/CreditPolicyPage.js';
import FleetConsolePage from './pages/FleetConsolePage.js';
import ProviderDashboardPage from './pages/ProviderDashboardPage.js';
import SignupPage from './pages/SignupPage.js';
import SkillsInspectorRoute from './routes/SkillsInspector.js';
import WorkNetworkRoute from './routes/WorkNetwork.js';
import type { AppOutletContext } from './types.js';

/** Wrapper: reads apiKey from outlet context and passes it to SharePage */
function SharePageWrapper(): JSX.Element {
  const { apiKey } = useOutletContext<AppOutletContext>();
  return <SharePage apiKey={apiKey} />;
}

/** Wrapper: reads apiKey + login from outlet context, gates OwnerDashboard behind AuthGate */
function MyAgentWrapper(): JSX.Element {
  const { apiKey, login } = useOutletContext<AppOutletContext>();
  return (
    <AuthGate apiKey={apiKey} onLogin={login}>
      {apiKey && <OwnerDashboard apiKey={apiKey} />}
    </AuthGate>
  );
}

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DiscoverPage /> },
      { path: 'signup', element: <SignupPage /> },
      {
        path: 'agents',
        element: <AgentList />,
      },
      {
        path: 'agents/hub',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'agents/hub/new',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'agents/hub/:agentId',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'agents/:owner',
        element: <ProfilePage />,
      },
      {
        path: 'activity',
        element: <ActivityFeed />,
      },
      {
        path: 'docs',
        element: <DocsPage />,
      },
      { path: 'evolution', element: <EvolutionPage /> },
      { path: 'genesis', element: <Navigate to="/evolution" replace /> },
      { path: 'credit-policy', element: <CreditPolicyPage /> },
      { path: 'fleet', element: <FleetConsolePage /> },
      { path: 'dashboard', element: <ProviderDashboardPage /> },
      { path: 'share', element: <SharePageWrapper /> },
      { path: 'myagent', element: <MyAgentWrapper /> },
      { path: 'skills-inspector', element: <SkillsInspectorRoute /> },
      { path: 'work-network', element: <WorkNetworkRoute /> },
      {
        path: 'settings',
        element: <Navigate to="/dashboard" replace />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
