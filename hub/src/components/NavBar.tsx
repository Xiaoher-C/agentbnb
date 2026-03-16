/**
 * NavBar — Top navigation bar for the AgentBnB Hub SPA.
 *
 * Left: "AgentBnB" title
 * Right: if authenticated — credit balance badge + Disconnect button
 *        if not authenticated — GetStartedCTA button
 * Desktop tabs: Discover | Agents | Activity | Docs | My Agent (dropdown)
 * Mobile: Hamburger button opens a vertical drawer with all nav items flat
 *
 * Uses react-router NavLink for active-state styling on all link tabs.
 * My Agent is a custom dropdown on desktop (Dashboard / Share / Settings),
 * expanded inline in the mobile drawer for better UX.
 */
import { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router';
import { ChevronDown, Menu, X } from 'lucide-react';
import GetStartedCTA from './GetStartedCTA.js';

export interface NavBarProps {
  apiKey: string | null;
  balance: number | null;
  onLogout: () => void;
}

/** Monospace credit balance pill shown when authenticated. */
function NavCreditBadge({ balance }: { balance: number | null }): JSX.Element {
  return (
    <span className="bg-white/[0.06] border border-white/[0.08] rounded-full px-3 py-1 text-sm font-mono text-emerald-400">
      cr {balance ?? '—'}
    </span>
  );
}

/** Shared className for individual nav tab items. */
function navTabClass(isActive: boolean): string {
  const base = 'px-4 py-1.5 rounded-md text-sm font-medium transition-colors';
  const active = 'bg-white/[0.08] text-hub-text-primary';
  const inactive = 'bg-transparent text-hub-text-muted hover:text-hub-text-secondary';
  return `${base} ${isActive ? active : inactive}`;
}

/** My Agent dropdown — shows Dashboard, Share, Settings sub-items (desktop only). */
function MyAgentDropdown(): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen((prev) => !prev); }}
        className={[
          navTabClass(open),
          'flex items-center gap-1',
        ].join(' ')}
      >
        My Agent
        <ChevronDown className="w-3 h-3 ml-1" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 bg-hub-surface border border-white/[0.08] rounded-lg py-1 z-50 min-w-[140px] shadow-lg">
          <NavLink
            to="/myagent"
            onClick={() => { setOpen(false); }}
            className="block px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.04] transition-colors"
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/share"
            onClick={() => { setOpen(false); }}
            className="block px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.04] transition-colors"
          >
            Share
          </NavLink>
          <NavLink
            to="/settings"
            onClick={() => { setOpen(false); }}
            className="block px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.04] transition-colors"
          >
            Settings
          </NavLink>
        </div>
      )}
    </div>
  );
}

/**
 * Top navigation bar with title, 5 tabs, credit badge or CTA, and My Agent dropdown.
 * Collapses to hamburger menu on mobile (< 768px / md breakpoint).
 */
export default function NavBar({ apiKey, balance, onLogout }: NavBarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  // iOS-safe scroll lock when mobile drawer is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <header className="max-w-7xl mx-auto px-4 pt-8 pb-0">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-hub-text-primary">AgentBnB</h1>
        <div className="flex items-center gap-3">
          {/* Hamburger button — visible on mobile only */}
          <button
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center text-hub-text-secondary hover:text-hub-text-primary transition-colors"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {apiKey ? (
            <>
              <NavCreditBadge balance={balance} />
              <button
                onClick={onLogout}
                className="text-xs text-hub-text-tertiary hover:text-hub-text-secondary transition-colors"
              >
                Disconnect
              </button>
            </>
          ) : (
            <GetStartedCTA />
          )}
        </div>
      </div>

      {/* Desktop tab navigation — pill switcher, hidden on mobile */}
      <nav
        aria-label="Desktop nav"
        className="mt-6 hidden md:flex gap-1 bg-white/[0.04] rounded-lg p-1 w-fit"
      >
        <NavLink
          to="/"
          end
          className={({ isActive }) => navTabClass(isActive)}
        >
          Discover
        </NavLink>
        <NavLink
          to="/agents"
          className={({ isActive }) => navTabClass(isActive)}
        >
          Agents
        </NavLink>
        <NavLink
          to="/activity"
          className={({ isActive }) => navTabClass(isActive)}
        >
          Activity
        </NavLink>
        <NavLink
          to="/docs"
          className={({ isActive }) => navTabClass(isActive)}
        >
          Docs
        </NavLink>
        <MyAgentDropdown />
      </nav>

      {/* Mobile drawer — full-width vertical nav, shown only when menuOpen */}
      {menuOpen && (
        <nav
          aria-label="Mobile nav"
          className="md:hidden mt-2 border-t border-hub-border pt-2 pb-1 flex flex-col gap-1"
        >
          <NavLink
            to="/"
            end
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Discover
          </NavLink>
          <NavLink
            to="/agents"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Agents
          </NavLink>
          <NavLink
            to="/activity"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Activity
          </NavLink>
          <NavLink
            to="/docs"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Docs
          </NavLink>
          <NavLink
            to="/myagent"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/share"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Share
          </NavLink>
          <NavLink
            to="/settings"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `${navTabClass(isActive)} block`}
          >
            Settings
          </NavLink>
        </nav>
      )}
    </header>
  );
}
