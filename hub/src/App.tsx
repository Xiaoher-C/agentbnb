/**
 * AgentBnB Hub — Layout Shell.
 *
 * App is now a layout-only component: NavBar + Outlet + CardModal.
 * All page-specific content is rendered by child route components via <Outlet>.
 *
 * Context passed to child routes via Outlet context:
 * - apiKey: current auth state
 * - login: auth login callback
 * - setSelectedCard: opens the card detail modal
 *
 * Tab-state-based navigation (useState<ActiveTab>) has been replaced by
 * react-router hash routing (plan 12-01).
 */
import { useState, useEffect } from 'react';
import { Outlet } from 'react-router';
import { useAuth } from './hooks/useAuth.js';
import type { HubCard, AppOutletContext } from './types.js';
import NavBar from './components/NavBar.js';
import CardModal from './components/CardModal.js';

/**
 * Hub layout shell. Renders NavBar, the matched child route via Outlet,
 * and the card detail modal overlay.
 *
 * All discover/share/myagent content lives in their respective page components.
 */
export default function App(): JSX.Element {
  const { apiKey, login, logout } = useAuth();
  const [selectedCard, setSelectedCard] = useState<HubCard | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  // Fetch credit balance when authenticated
  useEffect(() => {
    if (!apiKey) {
      setBalance(null);
      return;
    }

    fetch('/me', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as { credits?: number };
        if (typeof data.credits === 'number') {
          setBalance(data.credits);
        }
      })
      .catch(() => {
        // Balance fetch failed — leave as null
      });
  }, [apiKey]);

  return (
    <div className="min-h-screen bg-hub-bg text-hub-text-primary">
      <NavBar apiKey={apiKey} balance={balance} onLogout={logout} />
      <main className="max-w-7xl mx-auto px-4 py-8 pb-12">
        <Outlet context={{ apiKey, login, setSelectedCard } satisfies AppOutletContext} />
      </main>
      <CardModal card={selectedCard} onClose={() => { setSelectedCard(null); }} />
    </div>
  );
}
