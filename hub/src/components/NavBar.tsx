/**
 * NavBar — Top navigation bar for the AgentBnB Hub SPA.
 *
 * Public (unauthenticated): Discover | Docs | For Providers | Sign in | Get Started
 * Authenticated: Discover | My Sessions | My Outcomes | Docs | My Agent [dropdown]
 *                | Fleet | Credit Policy | Activity
 *
 * v10 Agent Maturity Rental: "My Sessions" (`/sessions`) and "My Outcomes"
 * (`/outcomes`) are the rental-side primary nav entries. The dropdown entry
 * "Publish Agent" (formerly "Publish Skills" pre-v10) — keeps the underlying
 * `/share` route for backward compatibility.
 *
 * Mobile: Hamburger button opens a vertical drawer with all nav items flat.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { ChevronDown, Menu, X } from 'lucide-react';
import GetStartedCTA from './GetStartedCTA.js';

/** Scroll to an element on the Discover page. Navigates to / first if needed. */
function useScrollTo() {
  const navigate = useNavigate();
  return useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      // Not on Discover page — navigate there, then scroll after render
      navigate('/');
      requestAnimationFrame(() => {
        setTimeout(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      });
    }
  }, [navigate]);
}

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

/** My Agent dropdown — shows the currently live authenticated work surfaces (desktop only). */
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
            to="/dashboard"
            onClick={() => { setOpen(false); }}
            className="block px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.04] transition-colors"
          >
            Provider Dashboard
          </NavLink>
          <NavLink
            to="/myagent"
            onClick={() => { setOpen(false); }}
            className="block px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.04] transition-colors"
          >
            Agent Workspace
          </NavLink>
          <NavLink
            to="/share"
            onClick={() => { setOpen(false); }}
            className="block px-3 py-2 text-sm text-hub-text-secondary hover:text-hub-text-primary hover:bg-white/[0.04] transition-colors"
          >
            Publish Agent
          </NavLink>
        </div>
      )}
    </div>
  );
}

/**
 * Top navigation bar with public/auth split.
 * Collapses to hamburger menu on mobile (< 768px / md breakpoint).
 */
export default function NavBar({ apiKey, balance, onLogout }: NavBarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthed = !!apiKey;
  const scrollTo = useScrollTo();

  // iOS-safe scroll lock when mobile drawer is open (position-fixed technique)
  useEffect(() => {
    if (menuOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.dataset.scrollY = String(scrollY);
    } else {
      const scrollY = parseInt(document.body.dataset.scrollY ?? '0', 10);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      delete document.body.dataset.scrollY;
      window.scrollTo(0, scrollY);
    }
    return () => {
      const scrollY = parseInt(document.body.dataset.scrollY ?? '0', 10);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      delete document.body.dataset.scrollY;
      window.scrollTo(0, scrollY);
    };
  }, [menuOpen]);

  return (
    <header className="max-w-7xl mx-auto px-4 pt-8 pb-0">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-hub-text-primary flex items-center gap-2">
          <svg width="56" height="56" viewBox="60 30 290 290" xmlns="http://www.w3.org/2000/svg" className="shrink-0 -my-2">
            {/* Doodle creature body */}
            <path d="M198,80 Q140,83 120,120 Q102,160 108,210 Q115,258 140,285 Q165,308 195,315 Q225,320 255,300 Q282,278 290,240 Q298,200 292,160 Q285,118 260,95 Q235,78 198,80Z" fill="currentColor" opacity="0.06" />
            <path d="M198,80 Q140,83 120,120 Q102,160 108,210 Q115,258 140,285 Q165,308 195,315 Q225,320 255,300 Q282,278 290,240 Q298,200 292,160 Q285,118 260,95 Q235,78 198,80Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {/* Left eye */}
            <path d="M155,155 Q155,135 172,135 Q189,135 189,155 Q189,175 172,175 Q155,175 155,155Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="172" cy="156" r="7" fill="currentColor" />
            <circle cx="176" cy="152" r="2.2" fill="#08080C" />
            {/* Right eye */}
            <path d="M210,148 Q210,126 230,126 Q250,126 250,148 Q250,170 230,170 Q210,170 210,148Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="230" cy="150" r="8" fill="currentColor" />
            <circle cx="235" cy="145" r="2.2" fill="#08080C" />
            {/* Smile */}
            <path d="M168,200 Q180,220 195,212 Q210,220 222,200" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            {/* Left arm waving */}
            <line x1="120" y1="180" x2="72" y2="135" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="72" y1="135" x2="60" y2="112" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="72" y1="135" x2="78" y2="108" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            {/* Right arm holding star */}
            <line x1="282" y1="180" x2="320" y2="138" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M320,128 L323,112 L330,122 L342,118 L334,128 L346,136 L332,136 L328,148 L322,138 L310,142 L318,132Z" fill="#EF9F27" stroke="#EF9F27" strokeWidth="0.8" />
            {/* Antennae */}
            <line x1="185" y1="80" x2="170" y2="42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="170" cy="36" r="6" fill="#7F77DD" />
            <line x1="205" y1="78" x2="222" y2="38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="222" cy="32" r="6" fill="#10B981" />
          </svg>
          AgentBnB
        </h1>
        <div className="flex items-center gap-3">
          {/* GitHub link */}
          <a
            href="https://github.com/Xiaoher-C/agentbnb"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="text-white/50 hover:text-white/90 transition-colors flex items-center"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>

          {/* Hamburger button — visible on mobile only */}
          <button
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center text-hub-text-secondary hover:text-hub-text-primary transition-colors"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {isAuthed ? (
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
            <>
              <a
                href="#/signup"
                className="hidden sm:inline-flex px-3 py-1.5 rounded-lg border border-white/[0.10] text-hub-text-secondary text-sm font-medium hover:text-hub-text-primary hover:border-white/[0.18] transition-colors"
              >
                Sign in
              </a>
              <GetStartedCTA />
            </>
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

        {isAuthed ? (
          <>
            <NavLink
              to="/sessions"
              className={({ isActive }) => navTabClass(isActive)}
            >
              My Sessions
            </NavLink>
            <NavLink
              to="/outcomes"
              className={({ isActive }) => navTabClass(isActive)}
            >
              My Outcomes
            </NavLink>
            <NavLink
              to="/docs"
              className={({ isActive }) => navTabClass(isActive)}
            >
              Docs
            </NavLink>
            <MyAgentDropdown />
            <NavLink
              to="/fleet"
              className={({ isActive }) => navTabClass(isActive)}
            >
              Fleet Console
            </NavLink>
            <NavLink
              to="/credit-policy"
              className={({ isActive }) => navTabClass(isActive)}
            >
              Credit Policy
            </NavLink>
            <NavLink
              to="/activity"
              className={({ isActive }) => navTabClass(isActive)}
            >
              Activity
            </NavLink>
          </>
        ) : (
          <>
            <NavLink
              to="/docs"
              className={({ isActive }) => navTabClass(isActive)}
            >
              Docs
            </NavLink>
            <button
              onClick={() => scrollTo('for-providers')}
              className={navTabClass(false)}
            >
              For Providers
            </button>
          </>
        )}
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

          {isAuthed ? (
            <>
              <NavLink
                to="/sessions"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                My Sessions
              </NavLink>
              <NavLink
                to="/outcomes"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                My Outcomes
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
                Agent Workspace
              </NavLink>
              <NavLink
                to="/share"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                Publish Agent
              </NavLink>
              <NavLink
                to="/fleet"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                Fleet Console
              </NavLink>
              <NavLink
                to="/credit-policy"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                Credit Policy
              </NavLink>
              <NavLink
                to="/activity"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                Activity
              </NavLink>
            </>
          ) : (
            <>
              <NavLink
                to="/docs"
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `${navTabClass(isActive)} block`}
              >
                Docs
              </NavLink>
              <button
                onClick={() => { setMenuOpen(false); scrollTo('for-providers'); }}
                className={`${navTabClass(false)} block text-left w-full`}
              >
                For Providers
              </button>
              <a
                href="#/signup"
                onClick={() => setMenuOpen(false)}
                className={`${navTabClass(false)} block`}
              >
                Sign in
              </a>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
