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
 *   /activity    → placeholder (Phase 13)
 *   /docs        → placeholder (Phase 13)
 *   /share       → SharePage (existing component)
 *   /myagent     → OwnerDashboard behind AuthGate (existing component)
 *   /settings    → placeholder
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider, useOutletContext } from 'react-router';
import './index.css';
import App from './App.js';
import DiscoverPage from './pages/DiscoverPage.js';
import SharePage from './components/SharePage.js';
import AuthGate from './components/AuthGate.js';
import OwnerDashboard from './components/OwnerDashboard.js';
import AgentList from './components/AgentList.js';
import ProfilePage from './components/ProfilePage.js';
import ActivityFeed from './components/ActivityFeed.js';
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
      {
        path: 'agents',
        element: <AgentList />,
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
        element: (
          <div className="text-hub-text-muted py-12 text-center">
            Docs — Phase 13
          </div>
        ),
      },
      { path: 'share', element: <SharePageWrapper /> },
      { path: 'myagent', element: <MyAgentWrapper /> },
      {
        path: 'settings',
        element: (
          <div className="text-hub-text-muted py-12 text-center">
            Settings — coming soon
          </div>
        ),
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
