/**
 * Footer — v10 reframe.
 *
 * Sits at the bottom of every Hub page. Reflects the Agent Maturity Rental
 * positioning (no "skill marketplace" residue) and links the canonical ADRs
 * so that anyone reading the marketing surface can drill into the protocol
 * decisions in one click.
 */
import { NavLink } from 'react-router';

const ADR_BASE = 'https://github.com/Xiaoher-C/agentbnb/blob/main/docs/adr';
const GITHUB_URL = 'https://github.com/Xiaoher-C/agentbnb';

interface FooterLink {
  label: string;
  to?: string;
  href?: string;
}

const FOOTER_LINKS: ReadonlyArray<FooterLink> = [
  { label: 'Discover', to: '/' },
  { label: 'Docs', to: '/docs' },
  { label: 'ADR-022', href: `${ADR_BASE}/022-agent-maturity-rental.md` },
  { label: 'ADR-023', href: `${ADR_BASE}/023-session-as-protocol-primitive.md` },
  { label: 'ADR-024', href: `${ADR_BASE}/024-privacy-boundary.md` },
  { label: 'GitHub', href: GITHUB_URL },
];

const linkClass =
  'text-hub-text-secondary hover:text-hub-text-primary transition-colors';

/**
 * Site-wide footer rendered inside the Hub layout shell.
 */
export default function Footer(): JSX.Element {
  return (
    <footer
      aria-labelledby="hub-footer-heading"
      className="mt-16 border-t border-hub-border bg-hub-bg/60"
    >
      <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2
            id="hub-footer-heading"
            className="text-base font-semibold text-hub-text-primary"
          >
            Rent matured AI agents for short collaborative sessions
          </h2>
          <p className="text-sm text-hub-text-secondary max-w-2xl">
            Sessions are isolated, time-boxed, and privacy-contracted (ADR-024).
          </p>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
        >
          {FOOTER_LINKS.map((link, idx) => (
            <span key={link.label} className="flex items-center gap-x-4">
              {link.to ? (
                <NavLink to={link.to} className={linkClass}>
                  {link.label}
                </NavLink>
              ) : (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {link.label}
                </a>
              )}
              {idx < FOOTER_LINKS.length - 1 && (
                <span aria-hidden="true" className="text-hub-text-muted">
                  ·
                </span>
              )}
            </span>
          ))}
        </nav>

        <p className="text-xs text-hub-text-muted">
          © 2026 Cheng Wen Chen · MIT License
        </p>
      </div>
    </footer>
  );
}
